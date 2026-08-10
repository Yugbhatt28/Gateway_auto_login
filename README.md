# College Gateway Auto Login

A Manifest V3 Chrome extension that signs a student into **their own** college
Ethernet / captive-portal gateway. The student enters the gateway address and
their college credentials once; the extension fills and submits that gateway's
login form automatically.

There is no developer server, no analytics, no telemetry, and no third-party
library. Everything the extension runs is packaged inside the ZIP.

## Files

```
college-gateway-auto-login/
├── manifest.json        MV3 manifest, strict CSP, minimal permissions
├── config.js            Shared validation/storage helpers (ES module)
├── background.js        Service worker: state, throttling, dynamic script registration
├── content.js           Runs only on the configured gateway origin
├── popup.html/.js/.css  Status + Login Now / Settings / Clear Credentials
├── options.html/.js/.css Onboarding and settings
├── icons/               16, 32, 48, 128 px
├── test/                Local captive-portal simulator for testing
├── PRIVACY.md
├── STORE_LISTING.md
└── README.md
```

## Permissions — line by line

| Permission | Why it is required | Why nothing smaller works |
|---|---|---|
| `storage` | Persists the gateway URL, optional selectors, username and password in `chrome.storage.local` (device-local), plus transient status in `chrome.storage.session`. | The settings must survive browser restarts; there is no smaller persistence API. |
| `scripting` | Registers the content script **at runtime** for the one origin the user configured, using `chrome.scripting.registerContentScripts`. | The gateway address is unknown at packaging time, so it cannot be a static `content_scripts` entry. Without `scripting` the only alternative is a static `<all_urls>` content script, which is far more privileged. |
| `optional_host_permissions: http://*/*, https://*/*` | Nothing is granted at install time. When the user saves a gateway, the extension calls `chrome.permissions.request` for **exactly one origin** (e.g. `http://10.20.30.40/*`). | Chrome cannot express "whatever origin the user will type later" as a narrow install-time pattern; college gateways are private IPs that differ per campus. Declaring them as *optional* keeps the granted set to the single origin the user approves. |

Not requested: `<all_urls>` host permissions at install, `tabs`, `history`,
`bookmarks`, `cookies`, `webRequest`, `webNavigation`, `downloads`,
`nativeMessaging`, `identity`. Tab lookup uses `chrome.tabs.query({url: <granted
gateway pattern>})`, which works from the granted host permission alone, and
`chrome.tabs.create` needs no permission.

## Install (unpacked, for testing)

1. Unzip the package (or use this folder directly).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder containing `manifest.json`.

## Configure

1. The options page opens on first install (or click the toolbar icon → **Settings**).
2. Enter the **Gateway URL** exactly as your college provides it, e.g. `http://10.20.30.40/login`.
3. Enter your **college ID** and **password**.
4. Optionally set CSS selectors (`#username`, `#password`, `#login`) if auto-detection fails.
5. Click **Save Settings** and approve the one-origin site-access prompt Chrome shows.
6. Optional: **Test Gateway** performs a credential-free reachability check.

## Testing with the bundled simulator

1. Serve the test portal from a local web server so it has a real origin:
   `cd test && python3 -m http.server 8123`
2. In the options page set Gateway URL to `http://localhost:8123/test-gateway.html`,
   enter **fake** credentials (e.g. `test-user` / `test-pass-123`), and save.
3. Open the gateway URL in a tab. Expected: fields fill, the form submits, and the
   page shows "Login successful". The popup shows *Logging in… → Login submitted →
   Login successful*.
4. Click **Login Now** in the popup with no gateway tab open: a new tab opens at the
   configured URL and logs in.
5. Open DevTools console on the page, the service worker, and the popup — confirm no
   username or password is printed anywhere.
6. Click **Clear Credentials**, confirm, then check
   `chrome://extensions` → service worker → `chrome.storage.local.get(console.log)`:
   the `credentials` key is gone.
7. Visit any other website: confirm the content script is not injected and nothing is filled.

## Packaging for the Chrome Web Store

```bash
cd college-gateway-auto-login
zip -r ../college-gateway-auto-login-1.0.0.zip . -x "*.DS_Store" "test/*"
```

Ship `manifest.json` at the **root** of the ZIP. The `test/` folder is excluded
from the store build because it is a development aid.

## Publishing

1. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time US$5 registration fee).
2. **Add new item** → upload the ZIP.
3. Fill the listing from `STORE_LISTING.md` (short description, detailed description, category *Productivity*).
4. Upload the 128px icon, at least one 1280x800 screenshot, and a small promo tile if desired.
5. **Privacy practices**: declare the single data type *Authentication information*; certify that it is not sold, not transferred for unrelated purposes, and not used for creditworthiness. Paste the permission justifications from `STORE_LISTING.md`.
6. Host `PRIVACY.md` as a public web page and enter its URL as the privacy policy.
7. Submit for review; expect a few business days.

## Security review checklist

- [x] Manifest V3, `minimum_chrome_version` set, no deprecated keys
- [x] No `eval`, `new Function`, remote scripts, or dynamically downloaded code
- [x] Strict `extension_pages` CSP: `script-src 'self'; object-src 'self'; base-uri 'self'`
- [x] No inline `<script>`/`onclick`; all handlers attached in packaged JS
- [x] No third-party libraries, SDKs, ads, analytics, or telemetry
- [x] No `innerHTML` with user-supplied strings (`textContent` only in the UI)
- [x] Gateway URL validated with `new URL()`, `http(s)` only
- [x] CSS selectors validated with `querySelector` in a `try/catch`; failures fall back to auto-detection
- [x] Strict origin equality check before credentials leave the service worker
- [x] Credentials only ever passed to a content script on the verified gateway origin
- [x] No `console.log` of credentials anywhere; the popup never renders the password
- [x] Password field masked; reveal only for a newly typed value, never for the stored one
- [x] Clear Credentials removes the storage key and requires confirmation
- [x] Retry cap (10 field-detection passes) plus max 3 submissions per 30s per origin
- [x] Successful login latches the session off, so no infinite login loop
- [x] Host permission requested at runtime for one origin, revocable in `chrome://extensions`

## Rejection reasons this design avoids

| Common rejection | How this extension avoids it |
|---|---|
| Requesting broad permissions ("permissions not justified") | Only `storage` + `scripting` at install; host access is optional and one origin at a time, with written justifications. |
| Undisclosed collection of authentication data | The privacy form declares *Authentication information*, and `PRIVACY.md` states it stays on-device. |
| Missing/incomplete privacy policy | `PRIVACY.md` is complete and must be hosted publicly and linked in the listing. |
| Remote code execution | All JavaScript ships in the package; no CDN, no `eval`, no injected script strings. |
| Obfuscated code | Source is plain, readable, unminified JavaScript. |
| Single-purpose violation | The extension does one thing: log in to one user-configured gateway. |
| Misleading functionality / metadata | Description matches behaviour exactly; no keyword stuffing. |
| Unexpected behaviour on unrelated sites | The content script is registered only for the configured origin and re-verifies the origin before acting. |
| Bypassing security controls | No CAPTCHA solving, no MFA bypass; it only replays the user's own credentials into the normal form. |
