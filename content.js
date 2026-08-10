/**
 * Runs only on the origin the user configured (registered dynamically by the
 * service worker). It asks the service worker for permission and credentials;
 * it never stores, logs, or transmits them anywhere else.
 */
(() => {
  "use strict";

  const MAX_DETECTION_TRIES = 10;
  const DETECTION_INTERVAL_MS = 600;
  const SUCCESS_CHECK_DELAY_MS = 2500;

  let finished = false;

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

  function looksLoggedIn() {
    if (document.querySelector('input[type="password"]')) return false;
    const text = (document.body?.innerText || "").toLowerCase();
    return /logged in|log ?out|sign ?out|connected|authentication successful|you are now/.test(text);
  }

  const report = (state, detail) =>
    chrome.runtime.sendMessage({ type: "REPORT", state, detail }).catch(() => {});

  async function attemptLogin(tries = 0) {
    if (finished) return;
    if (looksLoggedIn()) {
      finished = true;
      report("success", "Already authenticated.");
      return;
    }

    const passwordField = findField(null, PASSWORD_CANDIDATES);
    const scope = passwordField?.closest("form") || document;
    const password = findField(window.__cgalSelectors?.password, PASSWORD_CANDIDATES, scope);
    const username = findField(window.__cgalSelectors?.username, USERNAME_CANDIDATES, scope);

    if (!password || !username) {
      if (tries + 1 >= MAX_DETECTION_TRIES) {
        report("failed", "Login fields not found on this page.");
        return;
      }
      setTimeout(() => attemptLogin(tries + 1), DETECTION_INTERVAL_MS);
      return;
    }

    const response = await chrome.runtime
      .sendMessage({ type: "REQUEST_LOGIN", manual: false })
      .catch(() => null);

    if (!response?.allowed) {
      if (response?.reason) report("failed", response.reason);
      return;
    }

    window.__cgalSelectors = response.selectors || {};
    const usernameField =
      findField(response.selectors.username, USERNAME_CANDIDATES, scope) || username;
    const passwordFieldFinal =
      findField(response.selectors.password, PASSWORD_CANDIDATES, scope) || password;

    setValue(usernameField, response.credentials.username);
    setValue(passwordFieldFinal, response.credentials.password);
    // Drop the plaintext reference as soon as it has been used.
    response.credentials.username = "";
    response.credentials.password = "";

    const button = findButton(response.selectors.login, scope);
    const form = passwordFieldFinal.closest("form");

    finished = true;
    report("submitted", "Login submitted.");

    if (button) button.click();
    else if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    else if (form) form.submit();
    else {
      finished = false;
      report("failed", "No login button or form found.");
      return;
    }

    setTimeout(() => {
      report(looksLoggedIn() ? "success" : "submitted", "");
    }, SUCCESS_CHECK_DELAY_MS);
  }

  function start() {
    chrome.runtime.sendMessage({ type: "GATEWAY_DETECTED" }).catch(() => {});
    attemptLogin(0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
