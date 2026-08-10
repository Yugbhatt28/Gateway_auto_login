import {
  CONTENT_SCRIPT_ID,
  SETTINGS_KEY,
  getSettings,
  hasCredentials,
  originPattern,
  parseGatewayUrl,
  isGatewayOrigin,
} from "./config.js";

const STATUS_KEY = "status";
const ATTEMPT_KEY = "attempts";
const COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS_PER_WINDOW = 3;

/* ------------------------------ status ------------------------------ */

async function setStatus(state, detail = "") {
  await chrome.storage.session.set({ [STATUS_KEY]: { state, detail, at: Date.now() } });
}

async function getStatus() {
  const stored = await chrome.storage.session.get(STATUS_KEY);
  return stored[STATUS_KEY] || { state: "idle", detail: "", at: 0 };
}

/* -------------------- dynamic content script wiring ------------------ */
// The gateway address is chosen by the user at runtime, so the content script
// cannot be declared statically in the manifest. It is registered only for the
// single origin the user configured and only after the user grants permission.

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

chrome.runtime.onInstalled.addListener(async (details) => {
  await syncContentScript();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => void syncContentScript());
chrome.permissions.onAdded.addListener(() => void syncContentScript());
chrome.permissions.onRemoved.addListener(() => void syncContentScript());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) void syncContentScript();
});

/* ------------------------------ throttle ----------------------------- */

async function canAttempt(origin) {
  const stored = await chrome.storage.session.get(ATTEMPT_KEY);
  const all = stored[ATTEMPT_KEY] || {};
  const entry = all[origin] || { count: 0, first: 0, success: false };
  if (entry.success) return { allowed: false, reason: "Already signed in this session." };
  const now = Date.now();
  if (now - entry.first > COOLDOWN_MS) return { allowed: true };
  if (entry.count >= MAX_ATTEMPTS_PER_WINDOW) {
    return { allowed: false, reason: "Too many attempts. Waiting before retrying." };
  }
  return { allowed: true };
}

async function recordAttempt(origin) {
  const stored = await chrome.storage.session.get(ATTEMPT_KEY);
  const all = stored[ATTEMPT_KEY] || {};
  const entry = all[origin] || { count: 0, first: 0, success: false };
  const now = Date.now();
  if (now - entry.first > COOLDOWN_MS) {
    all[origin] = { count: 1, first: now, success: false };
  } else {
    all[origin] = { ...entry, count: entry.count + 1 };
  }
  await chrome.storage.session.set({ [ATTEMPT_KEY]: all });
}

async function markSuccess(origin) {
  const stored = await chrome.storage.session.get(ATTEMPT_KEY);
  const all = stored[ATTEMPT_KEY] || {};
  all[origin] = { count: 0, first: Date.now(), success: true };
  await chrome.storage.session.set({ [ATTEMPT_KEY]: all });
}

async function resetAttempts() {
  await chrome.storage.session.remove(ATTEMPT_KEY);
}

/* ------------------------------ messaging ---------------------------- */

async function handleMessage(message, sender) {
  const settings = await getSettings();
  const parsed = parseGatewayUrl(settings.gatewayUrl);

  switch (message?.type) {
    case "GET_STATE": {
      const configured = parsed.ok && (await hasCredentials());
      const granted = parsed.ok
        ? await chrome.permissions.contains({ origins: [originPattern(parsed.origin)] })
        : false;
      return {
        configured,
        granted,
        autoLogin: settings.autoLogin,
        gatewayOrigin: parsed.ok ? parsed.origin : "",
        status: await getStatus(),
      };
    }

    // Content script asks: may I fill and submit on this page?
    case "REQUEST_LOGIN": {
      const pageOrigin = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
      if (!parsed.ok || !isGatewayOrigin(pageOrigin, parsed.origin)) {
        return { allowed: false, reason: "Not the configured gateway." };
      }
      const stored = await chrome.storage.local.get("credentials");
      const creds = stored.credentials;
      if (!creds?.username || !creds?.password) {
        await setStatus("not-configured");
        return { allowed: false, reason: "Credentials not configured." };
      }
      if (!message.manual) {
        const gate = await canAttempt(parsed.origin);
        if (!gate.allowed) return { allowed: false, reason: gate.reason };
      }
      await recordAttempt(parsed.origin);
      await setStatus("logging-in");
      // Credentials are handed only to a content script running on the
      // verified gateway origin. They are never sent anywhere else.
      return {
        allowed: true,
        credentials: { username: creds.username, password: creds.password },
        selectors: {
          username: settings.usernameSelector,
          password: settings.passwordSelector,
          login: settings.loginSelector,
        },
      };
    }

    case "REPORT": {
      const pageOrigin = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
      if (parsed.ok && pageOrigin === parsed.origin) {
        if (message.state === "success") await markSuccess(parsed.origin);
        await setStatus(message.state, message.detail || "");
      }
      return { ok: true };
    }

    case "GATEWAY_DETECTED": {
      await setStatus("detected");
      return { ok: true };
    }

    case "LOGIN_NOW": {
      if (!parsed.ok) return { ok: false, error: "Configure a gateway URL first." };
      if (!(await hasCredentials())) return { ok: false, error: "Credentials not configured." };
      const pattern = originPattern(parsed.origin);
      if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
        return { ok: false, error: "Permission for the gateway has not been granted." };
      }
      await resetAttempts();
      await syncContentScript();
      const tabs = await chrome.tabs.query({ url: pattern });
      if (tabs.length > 0) {
        const tab = tabs[0];
        await chrome.tabs.update(tab.id, { active: true, url: parsed.href });
      } else {
        // Only ever opens the URL the user configured.
        await chrome.tabs.create({ url: parsed.href });
      }
      await setStatus("detected", "Opening gateway…");
      return { ok: true };
    }

    case "RESET_ATTEMPTS": {
      await resetAttempts();
      await setStatus("idle");
      return { ok: true };
    }

    case "CREDENTIALS_CLEARED": {
      await resetAttempts();
      await setStatus("not-configured");
      return { ok: true };
    }

    case "SYNC_SCRIPT": {
      const ok = await syncContentScript();
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
