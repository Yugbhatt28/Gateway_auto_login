// Local simulation only. Accepts any non-empty values and never logs them.
// Scenario is chosen with ?mode=… so one page covers every test case.
const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "success";

const form = document.getElementById("form");
const result = document.getElementById("result");
const box = document.querySelector(".box");
const banner = document.getElementById("mode");
if (banner) banner.textContent = `Scenario: ${mode}`;

// "unavailable" simulates a gateway that renders no login form at all.
if (mode === "unavailable") {
  box.innerHTML = '<h1>Gateway unavailable</h1><p class="sub">Service temporarily unavailable (503).</p>';
}

// "expire" shows a signed-in page that drops back to the login form.
if (mode === "expire" && !sessionStorage.getItem("expired")) {
  sessionStorage.setItem("expired", "1");
  showSuccess();
  setTimeout(() => location.reload(), 5000);
}

function showSuccess() {
  box.innerHTML =
    '<h1>Login successful</h1><p class="sub" id="success">You are now connected. Sign out to end the session.</p>' +
    '<button id="logout" type="button">Log out</button>';
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const filled =
    document.getElementById("username").value.trim() !== "" &&
    document.getElementById("password").value !== "";
  if (!filled) {
    result.textContent = "Please enter a user ID and password.";
    return;
  }

  switch (mode) {
    case "fail":
      result.style.color = "#b3261e";
      result.textContent = "Invalid user ID or password.";
      return;
    case "slow":
      result.textContent = "Authenticating…";
      setTimeout(showSuccess, 8000);
      return;
    case "redirect":
      setTimeout(() => location.replace("test-gateway.html?mode=landed"), 600);
      return;
    case "landed":
      return;
    default:
      showSuccess();
  }
});

if (mode === "landed") showSuccess();
