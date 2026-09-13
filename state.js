/**
 * Pure login/connectivity state machine. No Chrome APIs here, so it can be
 * unit-tested in plain JavaScript.
 */

export const STATES = {
  IDLE: "IDLE",
  CHECKING_CONNECTIVITY: "CHECKING_CONNECTIVITY",
  INTERNET_OK: "INTERNET_OK",
  OFFLINE: "OFFLINE",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  OPENING_GATEWAY: "OPENING_GATEWAY",
  LOGIN_IN_PROGRESS: "LOGIN_IN_PROGRESS",
  LOGIN_SUBMITTED: "LOGIN_SUBMITTED",
  VERIFYING: "VERIFYING",
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  BACKOFF: "BACKOFF",
  DISABLED: "DISABLED",
};

const T = {
  IDLE: ["CHECKING_CONNECTIVITY", "DISABLED"],
  DISABLED: ["IDLE", "CHECKING_CONNECTIVITY"],
  CHECKING_CONNECTIVITY: ["INTERNET_OK", "OFFLINE", "AUTH_REQUIRED", "IDLE", "DISABLED"],
  INTERNET_OK: ["CHECKING_CONNECTIVITY", "IDLE", "DISABLED"],
  OFFLINE: ["CHECKING_CONNECTIVITY", "AUTH_REQUIRED", "IDLE", "DISABLED"],
  AUTH_REQUIRED: ["OPENING_GATEWAY", "BACKOFF", "CHECKING_CONNECTIVITY", "IDLE", "DISABLED"],
  OPENING_GATEWAY: ["LOGIN_IN_PROGRESS", "LOGIN_FAILED", "CHECKING_CONNECTIVITY", "IDLE"],
  LOGIN_IN_PROGRESS: ["LOGIN_SUBMITTED", "LOGIN_FAILED", "LOGIN_SUCCESS", "IDLE"],
  LOGIN_SUBMITTED: ["VERIFYING", "LOGIN_SUCCESS", "LOGIN_FAILED", "IDLE"],
  VERIFYING: ["LOGIN_SUCCESS", "LOGIN_FAILED", "IDLE"],
  LOGIN_SUCCESS: ["CHECKING_CONNECTIVITY", "INTERNET_OK", "AUTH_REQUIRED", "IDLE", "DISABLED"],
  LOGIN_FAILED: ["BACKOFF", "CHECKING_CONNECTIVITY", "OPENING_GATEWAY", "IDLE", "DISABLED"],
  BACKOFF: ["CHECKING_CONNECTIVITY", "OPENING_GATEWAY", "IDLE", "DISABLED"],
};

export function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(T[from]?.includes(to));
}

/** Seconds between connectivity probes for the current state. */
export const INTERVALS = {
  normal: 5 * 60, // internet is fine — check occasionally
  degraded: 60, // something is wrong — look more often
  postLogin: 2 * 60, // just signed in — confirm it held
};

export function probeIntervalSeconds(state) {
  switch (state) {
    case STATES.INTERNET_OK:
      return INTERVALS.normal;
    case STATES.LOGIN_SUCCESS:
      return INTERVALS.postLogin;
    case STATES.OFFLINE:
    case STATES.AUTH_REQUIRED:
    case STATES.LOGIN_FAILED:
    case STATES.BACKOFF:
      return INTERVALS.degraded;
    default:
      return INTERVALS.degraded;
  }
}

/** Exponential backoff after failed login attempts: 30s, 60s, 120s … max 15m. */
export function backoffMs(failureCount) {
  const n = Math.max(0, Number(failureCount) || 0);
  return Math.min(30_000 * 2 ** Math.max(0, n - 1), 15 * 60_000);
}

/** Max automatic attempts before waiting for the user (Login Now always works). */
export function shouldGiveUp(failureCount, maxRetries = 3) {
  return (Number(failureCount) || 0) >= Math.max(1, Number(maxRetries) || 3);
}

/** Single-flight guard: a login is "in progress" for at most 90s. */
export const LOGIN_LOCK_MS = 90_000;

export function loginLocked(machine, now = Date.now()) {
  return Boolean(machine?.loginLock) && now - machine.loginLock < LOGIN_LOCK_MS;
}

/** Do not re-enter automatic login right after a success. */
export const SUCCESS_COOLDOWN_MS = 60_000;

export function inSuccessCooldown(machine, now = Date.now()) {
  return Boolean(machine?.lastSuccess) && now - machine.lastSuccess < SUCCESS_COOLDOWN_MS;
}

/** Interpret a connectivity probe result. */
export function classifyProbe({ status = 0, redirected = false, type = "", error = false }) {
  if (error) return "UNREACHABLE";
  if (type === "opaqueredirect" || redirected) return "CAPTIVE";
  if (status === 204 || status === 200) return status === 204 ? "ONLINE" : "CAPTIVE";
  if (status >= 300 && status < 400) return "CAPTIVE";
  return "UNREACHABLE";
}

/** Pick one gateway tab out of possibly many. Lowest id wins, oldest window. */
export function pickGatewayTab(tabs, preferredId) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  const preferred = tabs.find((t) => t.id === preferredId);
  if (preferred) return preferred;
  return [...tabs].sort((a, b) => a.id - b.id)[0];
}

export const NOTIFICATION_COOLDOWN_MS = 60_000;

export function canNotify(lastAt, now = Date.now()) {
  return !lastAt || now - lastAt >= NOTIFICATION_COOLDOWN_MS;
}
