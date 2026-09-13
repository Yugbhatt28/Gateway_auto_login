/**
 * Runs only on the origin the user configured (registered dynamically by the
 * service worker). It asks the service worker for permission and credentials;
 * it never stores, logs, or transmits them anywhere else. Credentials are held
 * in local variables for the duration of one fill and then dropped.
 */
(() => {
  "use strict";

  const MAX_DETECTION_TRIES = 10;
  const DETECTION_INTERVAL_MS = 600;
  const VERIFY_TIMEOUT_MS = 15000;
  const VERIFY_POLL_MS = 750;

  let busy = false;
  let done = false;

  const USERNAME_CANDIDATES = [
    'input[name="username"]',
    'input[name="user"]',
    'input[name="userid"]',
    'input[name="user_id"]',
    'input[name="login"]',
    'input[id="username"]',
    'input[id="userid"]',
    'input[type="email"]',
    'input[type="text"]',
  ];
  const PASSWORD_CANDIDATES = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
  ];
  const BUTTON_CANDIDATES = [
    'button[type="submit"]',
    'input[type="submit"]',
    'input[type="button"]',
    "button",
  ];
  const BUTTON_TEXTS = ["login", "log in", "sign in", "signin", "authenticate", "submit", "connect"];
  const SUCCESS_TEXT =
    /logged in|log ?out|sign ?out|connected|authentication successful|you are now|login success/;
  const FAILURE_TEXT =
    /invalid|incorrect|wrong (user|password)|failed|denied|not authori[sz]ed|try again/;

  const isVisible = (el) =>
    !!el && !el.disabled && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  function safeQuery(selector, root = document) {
    if (!selector) return null;
    try {
      return root.querySelector(selector);
    } catch {
      return null; // invalid selector supplied by the user
    }
  }

  function findField(customSelector, candidates, scope) {
    const custom = safeQuery(customSelector, scope) || safeQuery(customSelector);
    if (isVisible(custom)) return custom;
    for (const selector of candidates) {
      const matches = [...(scope || document).querySelectorAll(selector)].filter(isVisible);
      if (matches.length) return matches[0];
    }
    return null;
  }

  function findButton(customSelector, scope) {
    const custom = safeQuery(customSelector, scope) || safeQuery(customSelector);
    if (isVisible(custom)) return custom;
    const root = scope || document;
    for (const selector of BUTTON_CANDIDATES) {
      const matches = [...root.querySelectorAll(selector)].filter(isVisible);
      for (const el of matches) {
        const label = (el.value || el.textContent || el.getAttribute("aria-label") || "")
          .trim()
          .toLowerCase();
        if (BUTTON_TEXTS.some((t) => label.includes(t))) return el;
      }
      if (selector !== "button" && matches.length) return matches[0];
    }
    return null;
  }

  /** Set a value in a way React/Angular-style listeners also observe. */
  function setValue(field, value) {
    const proto = Object.getPrototypeOf(field);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    field.focus();
    if (descriptor && descriptor.set) descriptor.set.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    field.blur();
  }

  const send = (type, extra = {}) =>
    chrome.runtime.sendMessage({ type, ...extra }).catch(() => null);

  function pageText() {
    return (document.body?.innerText || "").toLowerCase();
  }

  /** Several independent signals, never "submitted therefore successful". */
  function successSignal(selectors, successText) {
    if (selectors?.success && safeQuery(selectors.success)) return "Success indicator found.";
    if (successText && pageText().includes(String(successText).toLowerCase())) {
      return "Success message found.";
    }
    const stillHasPassword = Boolean(document.querySelector('input[type="password"]'));
    if (!stillHasPassword && SUCCESS_TEXT.test(pageText())) return "Gateway reports you are online.";
    if (!stillHasPassword && document.forms.length === 0) return "Login form is gone.";
    return null;
  }

  function failureSignal() {
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    if (hasPassword && FAILURE_TEXT.test(pageText())) return "The gateway reported an error.";
    return null;
  }

  /** Watch the page after submission instead of assuming a result. */
  function verify(selectors, successText) {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const ok = successSignal(selectors, successText);
        if (ok) return resolve({ ok: true, detail: ok });
        const bad = failureSignal();
        if (bad) return resolve({ ok: false, detail: bad });
        if (Date.now() - started > VERIFY_TIMEOUT_MS) {
          return resolve({ ok: false, detail: "No confirmation from the gateway." });
        }
        setTimeout(tick, VERIFY_POLL_MS);
      };
      tick();
    });
  }

  async function attemptLogin(tries = 0, manual = false) {
    if (busy || done) return;

    // Already authenticated (e.g. the user signed in manually).
    if (!document.querySelector('input[type="password"]') && SUCCESS_TEXT.test(pageText())) {
      done = true;
      send("LOGIN_SUCCESS", { detail: "Already authenticated." });
      return;
    }

    const password = findField(null, PASSWORD_CANDIDATES);
    const scope = password?.closest("form") || document;
    const username = findField(null, USERNAME_CANDIDATES, scope);

    if (!password || !username) {
      if (tries + 1 >= MAX_DETECTION_TRIES) {
        send("LOGIN_FAILED", { detail: "Login fields not found on this page." });
        return;
      }
      setTimeout(() => attemptLogin(tries + 1, manual), DETECTION_INTERVAL_MS);
      return;
    }

    busy = true;
    send("LOGIN_STARTED");
    const response = await chrome.runtime
      .sendMessage({ type: "REQUEST_LOGIN", manual })
      .catch(() => null);

    if (!response?.allowed) {
      busy = false;
      if (response?.reason) send("LOGIN_FAILED", { detail: response.reason });
      return;
    }

    const selectors = response.selectors || {};
    const usernameField = findField(selectors.username, USERNAME_CANDIDATES, scope) || username;
    const passwordField = findField(selectors.password, PASSWORD_CANDIDATES, scope) || password;

    setValue(usernameField, response.credentials.username);
    setValue(passwordField, response.credentials.password);
    // Drop the plaintext reference as soon as it has been used.
    response.credentials.username = "";
    response.credentials.password = "";

    const button = findButton(selectors.login, scope);
    const form = passwordField.closest("form");

    if (button) button.click();
    else if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    else if (form) form.submit();
    else {
      busy = false;
      send("LOGIN_FAILED", { detail: "No login button or form found." });
      return;
    }

    send("LOGIN_SUBMITTED", { detail: "Login submitted." });
    const result = await verify(selectors, response.successText);
    busy = false;
    done = result.ok;
    send(result.ok ? "LOGIN_SUCCESS" : "LOGIN_FAILED", { detail: result.detail });
  }

  // Session expiry / re-authentication: if a password field reappears later on
  // the gateway page, allow another automatic attempt.
  function watchForReauth() {
    const observer = new MutationObserver(() => {
      if (!done || busy) return;
      if (document.querySelector('input[type="password"]')) {
        done = false;
        attemptLogin(0);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "RUN_LOGIN") {
      done = false;
      attemptLogin(0, true);
    }
  });

  function start() {
    send("GATEWAY_DETECTED");
    attemptLogin(0);
    watchForReauth();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
