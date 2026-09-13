import {
  CREDENTIALS_KEY,
  PROBE_PATTERNS,
  SETTINGS_KEY,
  getSettings,
  isValidSelector,
  originPattern,
  parseGatewayUrl,
} from "./config.js";

const el = (id) => document.getElementById(id);
const MASK = "\u2022".repeat(10);
let passwordDirty = false;
let hasStoredPassword = false;

function say(text, tone = "info") {
  const node = el("message");
  node.textContent = text;
  node.className = `message ${tone}`;
}

const SELECTOR_IDS = [
  "usernameSelector",
  "passwordSelector",
  "loginSelector",
  "successSelector",
];

/* ------------------------------- load -------------------------------- */

async function load() {
  const settings = await getSettings();
  el("gatewayUrl").value = settings.gatewayUrl;
  for (const id of SELECTOR_IDS) el(id).value = settings[id] || "";
  el("successText").value = settings.successText || "";
  el("autoLogin").checked = settings.autoLogin !== false;
  el("autoDetect").checked = settings.autoDetect !== false;
  el("autoOpenTab").checked = settings.autoOpenTab !== false;
  el("notifications").checked = Boolean(settings.notifications);
  el("maxRetries").value = String(settings.maxRetries || 3);

  const stored = await chrome.storage.local.get(CREDENTIALS_KEY);
  const creds = stored[CREDENTIALS_KEY];
  el("username").value = creds?.username || "";
  hasStoredPassword = Boolean(creds?.password);
  if (hasStoredPassword) {
    // The saved password is never rendered; a placeholder mask is shown until
    // the user chooses to replace it.
    el("password").value = MASK;
    el("password").dataset.masked = "true";
    setFieldsLocked(true);
    el("credHint").textContent =
      "Credentials are saved on this device. Choose “Edit Credentials” to change them.";
  }
}

function setFieldsLocked(locked) {
  el("username").readOnly = locked;
  el("password").readOnly = locked;
}

/* ------------------------------- save -------------------------------- */

async function save(event) {
  event.preventDefault();

  const parsed = parseGatewayUrl(el("gatewayUrl").value);
  if (!parsed.ok) return say(parsed.error, "err");

  for (const id of SELECTOR_IDS) {
    if (!isValidSelector(el(id).value)) return say("One of the CSS selectors is not valid.", "err");
  }

  const username = el("username").value.trim();
  const rawPassword = el("password").value;
  const passwordProvided = passwordDirty || el("password").dataset.masked !== "true";

  if (!username) return say("Enter your college ID / username.", "err");
  if (!hasStoredPassword && !rawPassword) return say("Enter your gateway password.", "err");

  const pattern = originPattern(parsed.origin);
  let granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      return say(`Chrome access to ${parsed.origin} is required for automatic login.`, "err");
    }
  }

  // Connectivity probing needs read access to the status endpoint only.
  if (el("autoDetect").checked) {
    const probeGranted = await chrome.permissions.contains({ origins: PROBE_PATTERNS });
    if (!probeGranted) await chrome.permissions.request({ origins: PROBE_PATTERNS });
  }

  if (el("notifications").checked) {
    const ok = await chrome.permissions.request({ permissions: ["notifications"] });
    if (!ok) el("notifications").checked = false;
  } else {
    await chrome.permissions.remove({ permissions: ["notifications"] }).catch(() => {});
  }

  const maxRetries = Math.min(10, Math.max(1, Number(el("maxRetries").value) || 3));

  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      gatewayUrl: parsed.href,
      usernameSelector: el("usernameSelector").value.trim(),
      passwordSelector: el("passwordSelector").value.trim(),
      loginSelector: el("loginSelector").value.trim(),
      successSelector: el("successSelector").value.trim(),
      successText: el("successText").value.trim(),
      autoLogin: el("autoLogin").checked,
      autoDetect: el("autoDetect").checked,
      autoOpenTab: el("autoOpenTab").checked,
      notifications: el("notifications").checked,
      maxRetries,
    },
  });

  const creds = { username };
  if (passwordProvided && rawPassword) creds.password = rawPassword;
  else {
    const stored = await chrome.storage.local.get(CREDENTIALS_KEY);
    creds.password = stored[CREDENTIALS_KEY]?.password || "";
  }
  await chrome.storage.local.set({ [CREDENTIALS_KEY]: creds });

  hasStoredPassword = Boolean(creds.password);
  passwordDirty = false;
  el("password").value = MASK;
  el("password").dataset.masked = "true";
  el("password").type = "password";
  el("reveal").textContent = "Show";
  setFieldsLocked(true);

  await chrome.runtime.sendMessage({ type: "RESET_ATTEMPTS" });
  await chrome.runtime.sendMessage({ type: "SYNC_SCRIPT" });
  say("Settings saved on this device.", "ok");
}

/* ------------------------------ actions ------------------------------ */

el("form").addEventListener("submit", save);

el("password").addEventListener("input", () => {
  passwordDirty = true;
  delete el("password").dataset.masked;
});

el("reveal").addEventListener("click", () => {
  const field = el("password");
  if (field.dataset.masked === "true") {
    say("The saved password is hidden. Choose “Edit Credentials” to enter a new one.", "info");
    return;
  }
  const show = field.type === "password";
  field.type = show ? "text" : "password";
  el("reveal").textContent = show ? "Hide" : "Show";
  el("reveal").setAttribute("aria-pressed", String(show));
});

el("edit").addEventListener("click", () => {
  setFieldsLocked(false);
  const field = el("password");
  field.value = "";
  delete field.dataset.masked;
  passwordDirty = true;
  el("username").focus();
  say("Enter the updated credentials, then choose Save Settings.", "info");
});

el("clear").addEventListener("click", async () => {
  if (!confirm("Delete your stored college ID and password from this device? This cannot be undone."))
    return;
  await chrome.storage.local.remove(CREDENTIALS_KEY);
  await chrome.runtime.sendMessage({ type: "CREDENTIALS_CLEARED" });
  hasStoredPassword = false;
  passwordDirty = false;
  el("username").value = "";
  el("password").value = "";
  delete el("password").dataset.masked;
  setFieldsLocked(false);
  el("credHint").textContent = "Stored only on this device and sent only to the gateway above.";
  say("Credentials deleted from extension storage.", "ok");
});

el("test").addEventListener("click", async () => {
  const parsed = parseGatewayUrl(el("gatewayUrl").value);
  if (!parsed.ok) return say(parsed.error, "err");

  const pattern = originPattern(parsed.origin);
  let granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return say("Access to the gateway was not granted, so it cannot be tested.", "err");

  say("Contacting the gateway…", "info");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // No credentials are sent by this check.
    await fetch(parsed.href, { method: "GET", mode: "no-cors", signal: controller.signal, cache: "no-store" });
    say(`Reached ${parsed.origin}. Automatic login will run on this gateway.`, "ok");
  } catch {
    say(`Could not reach ${parsed.origin}. Check the URL and that you are on the college network.`, "err");
  } finally {
    clearTimeout(timer);
  }
});

load();
