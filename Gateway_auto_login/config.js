// Shared, dependency-free helpers. No network access, no logging of secrets.

export const SETTINGS_KEY = "settings";
export const CREDENTIALS_KEY = "credentials";
export const CONTENT_SCRIPT_ID = "gateway-auto-login";
export const MACHINE_KEY = "machine";
export const STATS_KEY = "stats";

/** Connectivity probe endpoints. Plain HTTP status probes, no analytics. */
export const PROBE_ENDPOINTS = [
  "https://connectivitycheck.gstatic.com/generate_204",
  "https://www.gstatic.com/generate_204",
];
export const PROBE_PATTERNS = [
  "https://connectivitycheck.gstatic.com/*",
  "https://www.gstatic.com/*",
];

export const DEFAULT_SETTINGS = {
  gatewayUrl: "",
  usernameSelector: "",
  passwordSelector: "",
  loginSelector: "",
  successSelector: "",
  successText: "",
  autoLogin: true,
  autoDetect: true,
  autoOpenTab: true,
  notifications: false,
  maxRetries: 3,
};

/** Parse a gateway URL and reject anything that is not http/https. */
export function parseGatewayUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, error: "Gateway URL is required." };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full URL, e.g. http://10.20.30.40/login" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// gateways are supported." };
  }
  if (!url.hostname) return { ok: false, error: "Gateway URL has no host." };
  url.hash = "";
  return { ok: true, url, origin: url.origin, href: url.href };
}

/** Host permission pattern limited to the single configured gateway origin. */
export function originPattern(origin) {
  return `${origin}/*`;
}

/** A CSS selector is only accepted if the browser itself can parse it. */
export function isValidSelector(selector) {
  const value = String(selector || "").trim();
  if (!value) return true; // optional
  try {
    document.createDocumentFragment().querySelector(value);
    return true;
  } catch {
    return false;
  }
}

/** Strict match: same origin as the configured gateway. */
export function isGatewayOrigin(pageOrigin, gatewayOrigin) {
  return Boolean(pageOrigin) && pageOrigin === gatewayOrigin;
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function hasCredentials() {
  const stored = await chrome.storage.local.get(CREDENTIALS_KEY);
  const c = stored[CREDENTIALS_KEY];
  return Boolean(c && c.username && c.password);
}

/** Transient machine state lives in session storage so it survives SW suspension
 *  but never outlives the browser session. */
export async function getMachine() {
  const stored = await chrome.storage.session.get(MACHINE_KEY);
  return {
    state: "IDLE",
    detail: "",
    since: 0,
    failureCount: 0,
    gatewayTabId: null,
    lastAttempt: 0,
    lastSuccess: 0,
    nextRetryAt: 0,
    loginLock: 0,
    ...(stored[MACHINE_KEY] || {}),
  };
}

export async function setMachine(patch) {
  const current = await getMachine();
  const next = { ...current, ...patch };
  await chrome.storage.session.set({ [MACHINE_KEY]: next });
  return next;
}
