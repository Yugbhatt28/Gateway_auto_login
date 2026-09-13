# Chrome Web Store Listing — College Gateway Auto Login

## Category
Productivity

## Short description (108 / 132 characters)
Automatically log in to your own college Ethernet gateway. Credentials stay on your device. No tracking.

## Detailed description

College Gateway Auto Login signs you in to your college's Ethernet or captive-portal
gateway so you do not have to retype your college ID and password every time the
portal appears.

WHAT IT DOES
Once you configure your gateway, the extension detects that page, fills in your
college ID and password, and submits the login form for you. That is the entire
feature set — one purpose, nothing else.

HOW YOU SET IT UP
1. Install the extension; the settings page opens automatically.
2. Enter your gateway address, exactly as your college provides it
   (for example http://10.20.30.40/login).
3. Enter your college ID and password.
4. Optionally add CSS selectors for the username field, password field, and login
   button if your portal is unusual — otherwise the extension detects them.
5. Save. Chrome asks you to approve access to that one gateway address; nothing
   else is accessed.

HOW AUTOMATIC LOGIN WORKS
When you open the gateway you configured, the extension waits for the page to load,
locates the login fields (your selectors first, then common patterns such as
input[name="username"] and input[type="password"]), fills them, fires the input and
change events that JavaScript portals expect, and clicks the login button or submits
the form. It stops as soon as login succeeds, retries only a limited number of times,
and enforces a cooldown so it can never loop.

You can also click "Login Now" in the popup: if the gateway is not open, it opens
your configured gateway URL in a new tab and logs in there. It never opens any other
site.

HOW YOUR CREDENTIALS ARE STORED
Your college ID and password are saved with Chrome's extension storage inside your
own Chrome profile, on your own computer. They are never uploaded to the developer,
never sent to analytics or any third party, never synced between devices, and never
printed to the console or into error messages. The only place they are ever sent is
the gateway you configured — the same request your browser makes when you log in by
hand. They are not additionally encrypted by the extension, and we do not claim
otherwise. You can delete them at any time with "Clear Credentials".

PRIVACY AND SECURITY
- No analytics, no telemetry, no ads, no tracking.
- No third-party libraries; all code ships inside the extension.
- No remote code, no eval, strict Content Security Policy.
- Minimal permissions, with access to your gateway granted by you, one address at a
  time, and revocable in chrome://extensions.
- The login script runs only on the gateway origin you configured, and re-verifies
  that origin before touching any field.

WHAT IT DOES NOT DO
It does not bypass CAPTCHA, multi-factor authentication, or any security control. It
only automates the ordinary login you are already entitled to perform.

## Permission justifications

storage
Required to save the gateway URL, optional CSS selectors, the automatic-login
preference, and the user's college ID and password on the user's own device, so the
settings survive browser restarts. Transient popup status is kept in session storage.
No less privileged API can persist user settings.

scripting
Required to register the login content script at runtime with
chrome.scripting.registerContentScripts, scoped to the single gateway origin the user
configured. The gateway address is different at every college and is unknown when the
extension is packaged, so a static content_scripts entry is impossible. The only
alternative would be a static content script matching <all_urls>, which is strictly
more privileged; this approach limits execution to one user-chosen origin.

Optional host permission (http://*/*, https://*/*)
Nothing is granted at install time. When the user saves a gateway, the extension calls
chrome.permissions.request for exactly one origin, e.g. http://10.20.30.40/*. This
access is needed to read the login form and fill it on that gateway. A narrower
install-time pattern is not possible because the origin is typed by the user after
installation, and campus gateways are private addresses that vary per institution.
The user can revoke the grant at any time in chrome://extensions.

Not requested: tabs, history, bookmarks, cookies, webRequest, webNavigation,
downloads, identity, nativeMessaging, or install-time <all_urls> access.

## Privacy disclosure (Developer Dashboard form)

Data collected: Authentication information (the user's college gateway username and
password), plus the user-entered gateway URL and CSS selectors as user settings.

Handling: stored locally in the user's Chrome profile via chrome.storage.local; used
solely to fill the login form of the gateway the user configured; never transmitted to
the developer or any third party; never synced. No personally identifiable information
beyond these credentials is handled. No location, browsing history, web-page content,
or activity data is collected.

Certifications:
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Single purpose statement: Automatically fill and submit the login form of a college
network gateway that the user configures.

Privacy policy URL: the publicly hosted copy of PRIVACY.md.
