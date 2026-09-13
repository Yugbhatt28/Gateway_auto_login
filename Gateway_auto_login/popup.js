const el = (id) => document.getElementById(id);

/** state -> [label, tone] */
const LABELS = {
  DISABLED: ["Not configured", "warn"],
  IDLE: ["Waiting", "muted"],
  CHECKING_CONNECTIVITY: ["Checking connection…", "busy"],
  INTERNET_OK: ["Internet connected", "ok"],
  OFFLINE: ["No network connection", "err"],
  AUTH_REQUIRED: ["Authentication required", "warn"],
  OPENING_GATEWAY: ["Opening gateway…", "busy"],
  LOGIN_IN_PROGRESS: ["Logging in…", "busy"],
  LOGIN_SUBMITTED: ["Login submitted", "busy"],
  VERIFYING: ["Verifying login…", "busy"],
  LOGIN_SUCCESS: ["Login successful", "ok"],
  LOGIN_FAILED: ["Login failed", "err"],
  BACKOFF: ["Login failed", "err"],
};

const clock = (ts) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

function countdown(machine) {
  if (machine.state !== "BACKOFF" || !machine.nextRetryAt) return "";
  const seconds = Math.max(0, Math.round((machine.nextRetryAt - Date.now()) / 1000));
  return seconds ? `Retrying in ${seconds} seconds.` : "Retrying now…";
}

async function render() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!state) return;
  const machine = state.machine || { state: "IDLE" };

  el("gateway").textContent = state.gatewayOrigin || "No gateway configured";

  let key = machine.state || "IDLE";
  if (!state.configured) key = "DISABLED";
  const [label, tone] = LABELS[key] || LABELS.IDLE;
  el("state").textContent = label;

  let detail = countdown(machine) || machine.detail || "";
  if (!state.configured) detail = "Open Settings to add your gateway and college ID.";
  else if (!state.granted) detail = "Site access for the gateway is not granted — open Settings.";
  el("detail").textContent = detail;
  el("dot").className = `dot ${tone === "muted" ? "" : tone}`;

  el("lastSuccess").textContent = clock(machine.lastSuccess);
  el("lastAttempt").textContent = clock(machine.lastAttempt);
  el("attempts").textContent = String(machine.failureCount || 0);

  const s = state.settings || {};
  el("mode").textContent = s.autoLogin
    ? s.autoOpenTab
      ? "Automatic login is on."
      : "Automatic login is on, but the gateway tab is not opened automatically."
    : "Automatic login is off — use Login Now.";

  el("loginNow").disabled = !state.configured || !state.granted;
  el("checkNow").disabled = !state.configured;
}

el("loginNow").addEventListener("click", async () => {
  el("loginNow").disabled = true;
  const res = await chrome.runtime.sendMessage({ type: "LOGIN_NOW" });
  if (!res?.ok) {
    el("state").textContent = "Login failed";
    el("detail").textContent = res?.error || "Could not start login.";
    el("dot").className = "dot err";
    el("loginNow").disabled = false;
    return;
  }
  window.close();
});

el("checkNow").addEventListener("click", async () => {
  el("checkNow").disabled = true;
  await chrome.runtime.sendMessage({ type: "CHECK_NOW" });
  await render();
});

el("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

el("clear").addEventListener("click", async () => {
  if (!confirm("Delete the stored college ID and password from this device?")) return;
  await chrome.storage.local.remove("credentials");
  await chrome.runtime.sendMessage({ type: "CREDENTIALS_CLEARED" });
  render();
});

render();
setInterval(render, 1000);
