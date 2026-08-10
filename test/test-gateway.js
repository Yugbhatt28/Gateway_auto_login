// Local simulation only. Accepts any non-empty values and never logs them.
document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const filled =
    document.getElementById("username").value.trim() !== "" &&
    document.getElementById("password").value !== "";
  const box = document.querySelector(".box");
  if (!filled) {
    document.getElementById("result").textContent = "Please enter a user ID and password.";
    return;
  }
  box.innerHTML =
    '<h1>Login successful</h1><p class="sub">You are now connected. Sign out to end the session.</p>';
});
