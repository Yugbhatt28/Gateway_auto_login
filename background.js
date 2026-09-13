/**
 * Service worker: connectivity monitoring, captive-portal detection, gateway
 * tab management, login state machine, retry/backoff and notifications.
 *
 * MV3 note: this worker can be suspended at any time. Nothing important is kept
 * in memory — all state lives in chrome.storage.session and every timer is a
 * chrome.alarms alarm.
 */
import {
  CONTENT_SCRIPT_ID,
  CREDENTIALS_KEY,
  PROBE_ENDPOINTS,
  PROBE_PATTERNS,
  SETTINGS_KEY,
  getMachine,
  getSettings,
  hasCredentials,
  isGatewayOrigin,
  originPattern,
  parseGatewayUrl,
  setMachine,
} from "./config.js";
import {
  STATES,
  backoffMs,
  canNotify,
  canTransition,
  classifyProbe,
  inSuccessCooldown,
  loginLocked,
  pickGatewayTab,
  probeIntervalSeconds,
  shouldGiveUp,
} from "./state.js";

const PROBE_ALARM = "connectivity-probe";
const RETRY_ALARM = "login-retry";
const PROBE_TIMEOUT_MS = 4000;
const NOTIFY_KEY = "lastNotification";

/* ---------------------------- state helpers ---------------------------- */

async function transition(to, detail = "", patch = {}) {
  const machine = await getMachine();
  if (!canTransition(machine.state, to)) return machine;
  return setMachine({ ...patch, state: to, detail, since: Date.now() });
}

async function getStatus() {
  return getMachine();
}

/* ------------------------------ scheduling ----------------------------- */

async function scheduleProbe(seconds) {
  const minutes = Math.max(0.5, seconds / 60);
  await chrome.alarms.create(PROBE_ALARM, {
    delayInMinutes: minutes,
    periodInMinutes: minutes,
  });
}

async function rescheduleForState(state) {
  await scheduleProbe(probeIntervalSeconds(state));
}

async function scheduleRetry(ms) {
  await chrome.alarms.clear(RETRY_ALARM);
  await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: Math.max(0.5, ms / 60000) });
}

/* ---------------------- dynamic content script wiring ------------------ */
// The gateway address is chosen by the user at runtime, so the content script
// cannot be declared statically in the manifest. It is registered only for the
// single origin the user configured and only after permission is granted.

async function unregisterScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {
    /* not registered */
  }
}

export async function syncContentScript() {
  await unregisterScript();
  const settings = await getSettings();
  const parsed = parseGatewayUrl(settings.gatewayUrl);
  if (!parsed.ok || !settings.autoLogin) return false;

  const pattern = originPattern(parsed.origin);
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) return false;

  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      js: ["content.js"],
      matches: [pattern],
      runAt: "document_idle",
      allFrames: false,
    },
  ]);
  return true;
}

/* ---------------------------- notifications ---------------------------- */

async function notify(title, message) {
  const settings = await getSettings();
  if (!settings.notifications) return;
  if (!chrome.notifications) return;
  const granted = await chrome.permissions.contains({ permissions: ["notifications"] });
  if (!granted) return;
  const stored = await chrome.storage.session.get(NOTIFY_KEY);
  if (!canNotify(stored[NOTIFY_KEY])) return;
  await chrome.storage.session.set({ [NOTIFY_KEY]: Date.now() });
  // Message text never contains credentials.
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
  });
}

/* ------------------------- connectivity probing ------------------------ */

async function fetchProbe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
    });
    return classifyProbe({
      status: response.status,
      redirected: response.redirected,
      type: response.type,
    });
  } catch {
    return classifyProbe({ error: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Can the configured gateway itself be reached? (No credentials are sent.) */
async function gatewayReachable(href) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(href, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      mode: "no-cors",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns "ONLINE" | "CAPTIVE" | "OFFLINE".
 * navigator.onLine alone is never trusted: it stays true behind a portal.
 */
async function checkConnectivity(parsed) {
  const probeGranted = await chrome.permissions.contains({ origins: PROBE_PATTERNS });

  if (probeGranted) {
    for (const endpoint of PROBE_ENDPOINTS) {
      const verdict = await fetchProbe(endpoint);
      if (verdict === "ONLINE") return "ONLINE";
      if (verdict === "CAPTIVE") return "CAPTIVE";
    }
    // Every probe was unreachable. If the gateway answers, we are on the
    // college network behind the portal; otherwise the link is really down.
    if (parsed?.ok && (await gatewayReachable(parsed.href))) return "CAPTIVE";
    return "OFFLINE";
  }

  // Fallback without probe permission: gateway reachability + navigator.onLine.
  if (!navigator.onLine) return "OFFLINE";
  if (parsed?.ok && (await gatewayReachable(parsed.href))) return "CAPTIVE";
  return "ONLINE";
}

/* --------------------------- gateway tab flow -------------------------- */

async function openGateway(parsed, { focus }) {
  const pattern = originPattern(parsed.origin);
  const machine = await getMachine();
  const tabs = await chrome.tabs.query({ url: pattern });
  const existing = pickGatewayTab(tabs, machine.gatewayTabId);

  if (existing) {
    // Never create a second tab for the same gateway.
    const update = { url: parsed.href };
    if (focus) update.active = true;
    const tab = await chrome.tabs.update(existing.id, update);
    if (focus && tab?.windowId != null) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        /* window may be gone */
      }
    }
    return tab?.id ?? existing.id;
  }

  const tab = await chrome.tabs.create({ url: parsed.href, active: Boolean(focus) });
  return tab.id;
}

/* ---------------------------- the main cycle --------------------------- */

async function runCycle({ manual = false } = {}) {
  const settings = await getSettings();
  const parsed = parseGatewayUrl(settings.gatewayUrl);
  const configured = parsed.ok && (await hasCredentials());

  if (!configured) {
    await transition(STATES.DISABLED, "Add your gateway and college ID in Settings.");
    await chrome.alarms.clear(PROBE_ALARM);
    return;
  }
  if (!settings.autoDetect && !manual) {
    await transition(STATES.DISABLED, "Automatic monitoring is turned off.");
    return;
  }

  const before = await getMachine();
  if (!manual && loginLocked(before)) return; // a login is already running

  await transition(STATES.CHECKING_CONNECTIVITY, "Checking the connection…");
  const verdict = await checkConnectivity(parsed);

  if (verdict === "ONLINE") {
    await transition(STATES.INTERNET_OK, "Internet is working.", {
      failureCount: 0,
      loginLock: 0,
      nextRetryAt: 0,
    });
    await rescheduleForState(STATES.INTERNET_OK);
    return;
  }

  if (verdict === "OFFLINE") {
    await transition(STATES.OFFLINE, "No network connection detected.");
    await rescheduleForState(STATES.OFFLINE);
    return;
  }

  // CAPTIVE: the gateway wants us to authenticate.
  await transition(STATES.AUTH_REQUIRED, "Gateway authentication required.");
  await rescheduleForState(STATES.AUTH_REQUIRED);
  await startLogin({ manual });
}

async function startLogin({ manual = false } = {}) {
  const settings = await getSettings();
  const parsed = parseGatewayUrl(settings.gatewayUrl);
  if (!parsed.ok) return { ok: false, error: "Configure a gateway URL first." };
  if (!(await hasCredentials())) return { ok: false, error: "Credentials not configured." };

  const pattern = originPattern(parsed.origin);
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
    await transition(STATES.LOGIN_FAILED, "Site access for the gateway is not granted.");
    return { ok: false, error: "Permission for the gateway has not been granted." };
  }

  const machine = await getMachine();
  if (!manual) {
    if (!settings.autoLogin) {
      await transition(STATES.AUTH_REQUIRED, "Automatic login is off — press Login Now.");
      await notify("College gateway detected", "Authentication is required. Open the extension to sign in.");
      return { ok: false, error: "Automatic login disabled." };
    }
    if (loginLocked(machine)) return { ok: false, error: "A login is already running." };
    if (inSuccessCooldown(machine)) return { ok: false, error: "Just signed in." };
    if (machine.nextRetryAt && Date.now() < machine.nextRetryAt) {
      return { ok: false, error: "Waiting before the next attempt." };
    }
    if (shouldGiveUp(machine.failureCount, settings.maxRetries)) {
      await transition(STATES.BACKOFF, "Automatic attempts paused — press Login Now to retry.");
      return { ok: false, error: "Too many failed attempts." };
    }
    if (!settings.autoOpenTab) {
      await transition(STATES.AUTH_REQUIRED, "Gateway needs login — press Login Now to open it.");
      await notify("College gateway detected", "Authentication is required. Open the extension to sign in.");
      return { ok: false, error: "Automatic tab opening disabled." };
    }
  }

  await setMachine({ loginLock: Date.now(), lastAttempt: Date.now() });
  await transition(STATES.OPENING_GATEWAY, "Opening the gateway…");
  await syncContentScript();

  try {
    const focus = manual || machine.failureCount > 0;
    const tabId = await openGateway(parsed, { focus });
    await setMachine({ gatewayTabId: tabId ?? null });
    await notify("College gateway detected", "Signing in…");
    // The content script takes over from here and reports back.
    await scheduleRetry(90_000); // watchdog if nothing reports
    return { ok: true };
  } catch {
    await failLogin("Could not open the gateway page.");
    return { ok: false, error: "Could not open the gateway page." };
  }
}

async function failLogin(detail) {
  const settings = await getSettings();
  const machine = await getMachine();
  const failureCount = (machine.failureCount || 0) + 1;
  const wait = backoffMs(failureCount);
  await transition(STATES.LOGIN_FAILED, detail, { failureCount, loginLock: 0 });
  await notify("College gateway login failed", detail);

  if (shouldGiveUp(failureCount, settings.maxRetries)) {
    await transition(STATES.BACKOFF, "Automatic attempts paused — press Login Now to retry.", {
      nextRetryAt: 0,
    });
    await chrome.alarms.clear(RETRY_ALARM);
    return;
  }
  await transition(STATES.BACKOFF, `Retrying in ${Math.round(wait / 1000)} seconds.`, {
    nextRetryAt: Date.now() + wait,
  });
  await scheduleRetry(wait);
}

async function succeedLogin(detail) {
  await chrome.alarms.clear(RETRY_ALARM);
  await transition(STATES.LOGIN_SUCCESS, detail || "You are signed in.", {
    failureCount: 0,
    loginLock: 0,
    nextRetryAt: 0,
    lastSuccess: Date.now(),
  });
  await notify("College gateway login successful", "You are connected.");
  await rescheduleForState(STATES.LOGIN_SUCCESS);
}

/* ------------------------------ lifecycle ------------------------------ */

async function bootstrap(reason) {
  await syncContentScript();
  await setMachine({ loginLock: 0 });
  const settings = await getSettings();
  const parsed = parseGatewayUrl(settings.gatewayUrl);
  if (!parsed.ok) {
    await transition(STATES.DISABLED, "Add your gateway and college ID in Settings.");
    return;
  }
  // Never hammer the gateway at startup: first check is delayed.
  await scheduleProbe(reason === "startup" ? 30 : 15);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await bootstrap("install");
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => void bootstrap("startup"));
chrome.permissions.onAdded.addListener(() => void bootstrap("permissions"));
chrome.permissions.onRemoved.addListener(() => void syncContentScript());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SETTINGS_KEY] || changes[CREDENTIALS_KEY])) {
    void bootstrap("settings");
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PROBE_ALARM) void runCycle();
  if (alarm.name === RETRY_ALARM) {
    void (async () => {
      const machine = await getMachine();
      if (loginLocked(machine)) {
        // Nothing reported back within the watchdog window.
        await failLogin("The gateway did not respond to the login attempt.");
        return;
      }
      await runCycle();
    })();
  }
});

// A gateway tab that goes away must not be reused.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const machine = await getMachine();
  if (machine.gatewayTabId === tabId) await setMachine({ gatewayTabId: null });
});

/* ------------------------------ messaging ------------------------------ */

async function handleMessage(message, sender) {
  const settings = await getSettings();
  const parsed = parseGatewayUrl(settings.gatewayUrl);
  const senderOrigin = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
  const fromGateway = parsed.ok && isGatewayOrigin(senderOrigin, parsed.origin);

  switch (message?.type) {
    case "GET_STATE": {
      const configured = parsed.ok && (await hasCredentials());
      const granted = parsed.ok
        ? await chrome.permissions.contains({ origins: [originPattern(parsed.origin)] })
        : false;
      return {
        configured,
        granted,
        settings: {
          autoLogin: settings.autoLogin,
          autoDetect: settings.autoDetect,
          autoOpenTab: settings.autoOpenTab,
          notifications: settings.notifications,
        },
        gatewayOrigin: parsed.ok ? parsed.origin : "",
        machine: await getStatus(),
      };
    }

    // Content script asks: may I fill and submit on this page?
    case "REQUEST_LOGIN": {
      if (!fromGateway) return { allowed: false, reason: "Not the configured gateway." };
      const stored = await chrome.storage.local.get(CREDENTIALS_KEY);
      const creds = stored[CREDENTIALS_KEY];
      if (!creds?.username || !creds?.password) {
        await transition(STATES.DISABLED, "Credentials not configured.");
        return { allowed: false, reason: "Credentials not configured." };
      }
      const machine = await getMachine();
      if (!message.manual) {
        if (!settings.autoLogin) return { allowed: false, reason: "Automatic login is off." };
        if (inSuccessCooldown(machine)) return { allowed: false, reason: "Just signed in." };
        if (machine.nextRetryAt && Date.now() < machine.nextRetryAt) {
          return { allowed: false, reason: "Waiting before the next attempt." };
        }
        if (shouldGiveUp(machine.failureCount, settings.maxRetries)) {
          return { allowed: false, reason: "Automatic attempts paused." };
        }
      }
      await setMachine({ loginLock: Date.now(), lastAttempt: Date.now() });
      await transition(STATES.LOGIN_IN_PROGRESS, "Logging in…");
      // Credentials are handed only to a content script running on the verified
      // gateway origin, and only for this single attempt.
      return {
        allowed: true,
        credentials: { username: creds.username, password: creds.password },
        selectors: {
          username: settings.usernameSelector,
          password: settings.passwordSelector,
          login: settings.loginSelector,
          success: settings.successSelector,
        },
        successText: settings.successText,
      };
    }

    case "LOGIN_STARTED":
      if (fromGateway) await transition(STATES.LOGIN_IN_PROGRESS, "Logging in…");
      return { ok: true };

    case "LOGIN_SUBMITTED":
      if (fromGateway) {
        await transition(STATES.LOGIN_SUBMITTED, "Login submitted.");
        await transition(STATES.VERIFYING, "Checking whether the login worked…");
        await scheduleRetry(45_000);
      }
      return { ok: true };

    case "LOGIN_SUCCESS":
      if (fromGateway) await succeedLogin(message.detail);
      return { ok: true };

    case "LOGIN_FAILED":
      if (fromGateway) await failLogin(message.detail || "The gateway rejected the login.");
      return { ok: true };

    case "GATEWAY_DETECTED":
      if (fromGateway) await transition(STATES.AUTH_REQUIRED, "Gateway page open.");
      return { ok: true };

    case "LOGIN_NOW": {
      await setMachine({ failureCount: 0, nextRetryAt: 0, loginLock: 0 });
      return startLogin({ manual: true });
    }

    case "CHECK_NOW":
      await runCycle({ manual: true });
      return { ok: true };

    case "RESET_ATTEMPTS":
      await setMachine({ failureCount: 0, nextRetryAt: 0, loginLock: 0, lastSuccess: 0 });
      await transition(STATES.IDLE, "");
      return { ok: true };

    case "CREDENTIALS_CLEARED":
      await chrome.alarms.clear(PROBE_ALARM);
      await chrome.alarms.clear(RETRY_ALARM);
      await setMachine({
        failureCount: 0,
        nextRetryAt: 0,
        loginLock: 0,
        lastSuccess: 0,
        gatewayTabId: null,
      });
      await transition(STATES.DISABLED, "Credentials removed from this device.");
      return { ok: true };

    case "SYNC_SCRIPT": {
      const ok = await syncContentScript();
      await bootstrap("settings");
      return { ok };
    }

    default:
      return { ok: false, error: "Unknown request." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, () =>
    sendResponse({ ok: false, error: "Request failed." }),
  );
  return true; // async response
});
