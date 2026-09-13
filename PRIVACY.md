# Privacy Policy — College Gateway Auto Login

**Last updated: 12 September 2026**

College Gateway Auto Login is a Chrome extension that fills and submits the login
form of a college Ethernet / captive-portal gateway that you configure yourself.

## What the extension stores

Saved in `chrome.storage.local`, which lives in your own Chrome profile on your
own computer:

- the gateway URL you enter;
- your college ID / username;
- your gateway password;
- the optional CSS selectors and success text you enter;
- your automatic-login, automatic-detection, automatic-tab and notification
  preferences, and the retry limit.

Saved in `chrome.storage.session` (cleared when Chrome closes):

- the current state of the login state machine (status text, failure counter,
  timestamps of the last attempt and last success, the id of the gateway tab and
  the notification cooldown). No credentials are kept here.

## Where your data goes

Your username and password are used for one purpose only: to be typed into the
login form of the gateway address you configured, on that page, in your browser.

- Credentials are **never** sent to the developer of this extension.
- Credentials are **never** sent to any analytics, advertising, logging, crash
  reporting, or third-party service.
- Credentials are **never** sold, rented, or shared with anyone.
- Credentials are **never** written to the browser console or into error messages.
- Credentials are **not** synced across devices — `chrome.storage.sync` is not used.
- No data leaves your device except the login request your browser sends to the
  gateway you configured, which is the same request you would make by typing your
  credentials manually.

## Encryption

Your credentials are stored using Chrome's extension storage in your browser
profile. They are **not** additionally encrypted by this extension, and no claim
of encryption is made. Protection therefore comes from your operating-system user
account and Chrome profile. If your gateway uses `http://` rather than `https://`,
the login request itself is unencrypted in transit — this is a property of your
college's gateway, not of this extension.

## Analytics and telemetry

This extension contains no analytics, no telemetry, no tracking pixels, no
advertising SDKs, and no third-party libraries of any kind. It makes no network
requests to any developer-controlled server, because none exists.

## Permissions

- `storage` — to save the settings listed above on your device.
- `scripting` — to register the login script for the single gateway origin you configure.
- `alarms` — to schedule connectivity checks and retries, because a Manifest V3
  background worker is suspended and cannot keep timers in memory.
- `notifications` (optional, only if you switch notifications on) — to show
  detection, success and failure messages. Notification text never contains
  credentials. Switching the option off removes the permission.
- Optional host permission — granted by you for one origin at a time when you save a
  gateway; it lets the extension read and fill the login form on that gateway only.

## Connectivity checks

To notice that your college gateway is holding your connection, the extension
periodically sends a plain status request to a public connectivity-check endpoint
(`https://connectivitycheck.gstatic.com/generate_204`, with
`https://www.gstatic.com/generate_204` as a fallback). These requests:

- carry no cookies, no credentials, no identifier and no page data;
- download nothing (the normal reply is an empty HTTP 204);
- are only used to read the HTTP status code, which reveals whether traffic is
  being redirected to a captive portal;
- run at most every 5 minutes when the connection is fine and every minute when it
  is not, with a 4-second timeout.

They are not analytics and are not operated by the developer of this extension. If
you refuse the permission, or turn automatic detection off, the extension instead
checks only the gateway you configured.

## Deleting your data

- Click **Clear Credentials** in the popup or the options page, and confirm. This
  removes your username and password from extension storage immediately.
- Removing site access in `chrome://extensions` stops the extension from acting on
  the gateway.
- Removing the extension from `chrome://extensions` deletes all of its stored data.

## Children

The extension is aimed at students using their own institutional network accounts
and collects nothing beyond what the user types into it.

## Changes

Any change to this policy will be published with a new version of the extension and
a new "Last updated" date.

## Contact

Questions about this policy can be sent to the developer contact address listed on
the extension's Chrome Web Store page.
