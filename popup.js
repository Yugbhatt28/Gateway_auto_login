const el = (id) => document.getElementById(id);

const LABELS = {
  "not-configured": ["Credentials not configured", "warn"],
  idle: ["Gateway not detected", "muted"],
  detected: ["Gateway detected", "ok"],
  "logging-in": ["Logging in…", "busy"],
  submitted: ["Login submitted", "busy"],
  success: ["Login successful", "ok"],
  failed: ["Login failed", "err"],
};

async function render() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  el("gateway").textContent = state.gatewayOrigin || "No gateway configured";

  let key = state.status?.state || "idle";
  if (!state.configured) key = "not-configured";
  const [label, tone] = LABELS[key] || LABELS.idle;

  el("state").textContent = label;
  let detail = state.status?.detail || "";
  if (!state.configured) detail = "Open Settings to add your gateway and college ID.";
  else if (!state.granted) detail = "Site access for the gateway is not granted yet — open Settings.";
  else if (!state.autoLogin && !detail) detail = "Automatic login is turned off.";
  el("detail").textContent = detail;

  el("dot").className = `dot ${tone === "muted" ? "" : tone}`;
  el("loginNow").disabled = !state.configured || !state.granted;
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
setInterval(render, 1500);
