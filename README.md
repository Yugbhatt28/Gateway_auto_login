# College Gateway Auto Login

A Manifest V3 Chrome extension that signs you in to your own college Ethernet /
captive-portal gateway. Everything stays on your device: no developer server, no
analytics, no telemetry, no third-party libraries.

## Features

- Automatic captive-portal detection — notices when your connection is being held
  behind the college gateway, not just when the cable is unplugged.
- Automatic login: opens (or reuses) the gateway tab, fills your saved credentials,
  submits the form and verifies the result.
- Explicit state machine with retry, exponential backoff and cooldowns.
- Session-expiry handling: when the gateway asks for credentials again, the cycle
  repeats automatically.
- Status popup: Internet connected / Authentication required / Logging in… /
  Login submitted / Login successful / Login failed with retry countdown.
- Manual **Login Now** and **Check Connection** at any time.
- Optional Chrome notifications, rate-limited to one per minute.
- Optional custom CSS selectors for username, password, login button and a
  success indicator, with automatic fallbacks.
- Local captive-portal simulator with six scenarios.

## How automatic detection works

`navigator.onLine` is never trusted on its own — it stays `true` while a portal is
intercepting traffic. Instead, every check does a tiny HTTP status probe:

1. `GET https://connectivitycheck.gstatic.com/generate_204` with
   `redirect: "manual"`, `credentials: "omit"`, `cache: "no-store"` and a 4-second
   timeout. The response body is empty (HTTP 204) — nothing is downloaded, nothing
   is uploaded, no account or identifier is involved.
2. Interpretation:
   - `204` and not redirected → **ONLINE**
   - redirect / opaque redirect / `200` with a page body → **CAPTIVE PORTAL**
   - network error → try the second endpoint, then check whether the configured
     gateway answers. Gateway reachable → captive portal; otherwise → offline.
3. If the probe endpoints were not permitted, the extension falls back to
   `navigator.onLine` plus a no-cors reachability check of your own gateway.

Check frequency: every 5 minutes while the internet is fine, every minute while
something is wrong, every 2 minutes for a while after a successful login. Chrome
alarms clamp to a 30-second minimum, so the extension can never poll harder than
that.

## State / flow diagram

```text
                 ┌──────────────┐
                 │     IDLE     │◀── install / Chrome start (delayed first check)
                 └──────┬───────┘
                        ▼
            ┌────────────────────────┐
            │ CHECKING_CONNECTIVITY  │◀──────────────┐
            └───┬───────────┬────────┘               │
      204 ok    │           │  no network            │
                ▼           ▼                        │
        ┌──────────────┐  ┌─────────┐                │
        │ INTERNET_OK  │  │ OFFLINE │────────────────┤
        └──────┬───────┘  └─────────┘                │
               │ (5 min alarm)                       │
               └─────────────────────────────────────┤
                                                     │
   redirect / portal page                            │
                ▼                                    │
        ┌───────────────┐   auto-login off / tab off │
        │ AUTH_REQUIRED │───────────────────────────▶│ (status + notification only)
        └──────┬────────┘
               ▼
      ┌──────────────────┐   tab reused or created (single-flight lock)
      │ OPENING_GATEWAY  │
      └──────┬───────────┘
             ▼
    ┌─────────────────────┐  content script fills fields
    │ LOGIN_IN_PROGRESS   │
    └──────┬──────────────┘
           ▼
    ┌──────────────────┐      ┌───────────┐
    │ LOGIN_SUBMITTED  │─────▶│ VERIFYING │
    └──────────────────┘      └─────┬─────┘
                       success      │      failure / timeout
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
        ┌────────────────┐                     ┌──────────────┐
        │ LOGIN_SUCCESS  │                     │ LOGIN_FAILED │
        └───────┬────────┘                     └──────┬───────┘
                │ 2-min re-check                      ▼
                │ (session expiry →            ┌─────────────┐
                └── AUTH_REQUIRED again)       │   BACKOFF   │ 30s → 60s → 120s … 15m
                                               └──────┬──────┘
                                                      └──▶ CHECKING_CONNECTIVITY
```

Transitions are validated by `canTransition()` in `state.js`; an illegal jump is
simply ignored, so impossible states cannot be reached by a stray message.

## Files

| File | Responsibility |
| --- | --- |
| `manifest.json` | MV3 declaration, minimal permissions |
| `config.js` | Defaults, URL/selector validation, storage helpers, machine state accessors |
| `state.js` | Pure state machine, intervals, backoff, probe classification, tab picking (unit-tested) |
| `background.js` | Connectivity monitoring, alarms, gateway tab management, login orchestration, notifications |
| `content.js` | Form detection, filling, submission, result verification, re-auth watching |
| `popup.html/js/css` | Status display, Login Now, Check Connection, Settings, Clear Credentials |
| `options.html/js/css` | Configuration, validation, permission requests |
| `test/` | Local captive-portal simulator and automated tests |

## Installation

1. Unzip the package.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped folder.

## Configuration

Open **Settings** and enter:

- Gateway URL (http/https only, validated and normalised)
- College ID / username and password
- Automatic monitoring, automatic login, automatic tab opening, notifications
- Attempts before pausing (1–10)
- Optional selectors: username, password, login button, success indicator, success text

Saving requests Chrome access to that one gateway origin, and — if monitoring is
enabled — read access to the connectivity status endpoints.

## Permissions and why each is needed

| Permission | Why |
| --- | --- |
| `storage` | Save settings and credentials locally; keep transient state in session storage |
| `scripting` | Register the login content script for the one configured origin |
| `alarms` | MV3 service workers are suspended; alarms are the only reliable way to schedule connectivity checks and retries |
| `notifications` (optional) | Only requested when you tick the notifications box; removed when you untick it |
| host permission for your gateway origin (optional) | Read and fill the login form on that gateway only |
| host permission for `connectivitycheck.gstatic.com` / `www.gstatic.com` (optional) | The status-code probe that detects a captive portal |

Not used: `<all_urls>` as a required permission, `tabs`, `cookies`, `history`,
`webRequest`, `webNavigation`, `nativeMessaging`, `externally_connectable`, remote
code. Tab lookup works through the granted gateway origin alone, so the broad
`tabs` permission is unnecessary.

## Security model

- Credentials live in `chrome.storage.local`; `chrome.storage.sync` is never used.
- They are handed out only in response to a message whose sender origin equals the
  configured gateway origin, and only for a single fill.
- They never appear in logs, error text, status messages, notifications, the popup,
  URLs or query parameters.
- CSP: `script-src 'self'`, `object-src 'self'`, `base-uri 'self'`, `form-action 'none'`.
  No `eval`, no remote scripts.
- User-supplied selectors are parsed with `querySelector` in a detached fragment
  before saving, and every query at runtime is wrapped in a try/catch.

## Duplicate-tab and duplicate-login prevention

- Before opening anything, `chrome.tabs.query({ url: "<origin>/*" })` looks for an
  existing gateway tab; the remembered `gatewayTabId` wins, otherwise the lowest tab
  id is chosen deterministically. A new tab is created only when none exists.
- A `loginLock` timestamp in session storage makes login single-flight for 90 s.
- A 60-second success cooldown stops an immediate second attempt.
- `nextRetryAt` blocks automatic retries during backoff; **Login Now** clears it.
- Simultaneous connectivity events all read the same stored lock, so only one wins.

## MV3 suspension handling

Nothing is kept in memory. State lives in `chrome.storage.session`, schedules live
in `chrome.alarms`, and the content script is re-registered from stored settings on
install, Chrome start, permission change and settings change. After Chrome restarts
or the laptop wakes, the first check is deliberately delayed (15–30 s) so the
gateway is never hammered at startup. A watchdog alarm turns a silent login attempt
into a failure instead of a stuck state.

## Testing

### Automated

```sh
bunx vitest run extension/test/state.test.js
```

Covers URL validation and origin extraction, state transitions (including illegal
ones), retry/backoff, probe classification, cooldowns, notification rate limiting
and duplicate-tab prevention.

### Local simulator

1. Serve the folder: `python3 -m http.server 8000 --directory extension/test`
2. Set the gateway URL to `http://localhost:8000/test-gateway.html?mode=success`.
3. Save (grant access to `http://localhost:8000`), then press **Login Now**.
4. Repeat with each scenario: `?mode=fail` (wrong password), `?mode=slow`,
   `?mode=redirect`, `?mode=expire` (session expiry), `?mode=unavailable`
   (gateway down, no form). For custom-selector testing use `#cg-user`,
   `#cg-pass`, `#cg-login` and success selector `#logout`.

### On your college network

1. Configure the real gateway URL and your college ID, save and grant access.
2. Leave automatic login and monitoring on.
3. Connect to the college Ethernet/Wi-Fi without signing in manually.
4. Open a normal site — the portal interception happens.
5. Within a minute the popup should move through *Authentication required →
   Logging in… → Login submitted → Login successful*, and the gateway tab appears.
6. To retest, sign out on the gateway page (or wait for the session to expire) and
   watch the cycle repeat. **Login Now** forces an immediate attempt at any time.

## Troubleshooting

- *Login fields not found* — fill in the username/password/login selectors from the
  gateway page (right-click → Inspect).
- *No confirmation from the gateway* — set a success selector or success text that
  only appears after signing in.
- *Nothing happens* — check that site access for the gateway origin is still granted
  in `chrome://extensions`, and that automatic login is on in Settings.
- *Repeated failures* — after the configured number of attempts the extension stops
  automatically retrying; press **Login Now** once the problem is fixed.

## Limitations

Captive-portal detection is inherently imperfect: colleges implement authentication
very differently. Some portals answer probes with a 200 page, some silently drop
traffic, some only redirect plain HTTP. Some gateways also use MAC-based sessions,
IP-bound tokens or extra fields (OTP, captcha, terms checkbox) that no extension can
fill. In those cases detection still works, but the login step may need manual help.
