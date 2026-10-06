# Publishing

Releases are uploaded by hand in the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## First release
- Pay the $5 fee and verify your account.
- Upload the zip (see below).
- Fill the **Store listing** (description, at least one screenshot) and the
  **Privacy** tab (justifications, data disclosures, privacy-policy URL); see
  `STORE_LISTING.md`.
- Submit it for review.

## Each release
1. Bump `"version"` in `manifest.json`. The store rejects a version that is not
   higher than the published one.
2. Run the checks: `node test-formats.js` and
   `node --test tests/e2e/extension.test.js`.
3. Build the zip with only the files the extension ships (README, PRIVACY,
   tests and `.git` stay out):
   ```sh
   zip ai-form-autofill.zip manifest.json background.js shared.js providers.js \
     formdom.js content.js popup.js popup.html options.js options.html \
     icon16.png icon48.png icon128.png
   ```
4. Test the zip itself, not only the repo: unzip it to a folder and run
   `AIFF_EXTENSION_SRC=<folder> node --test tests/e2e/extension.test.js`.
   Note its `shasum -a 256` in STATUS.md.
5. In the dashboard, open the item, go to **Package**, upload the zip, and
   submit for review. Then record the version and date in STATUS.md.

Listing text, screenshots and the privacy policy are edited in the dashboard.

## How users get the update

Installed copies update themselves: Chrome checks the store at startup and every
few hours, and installs the new version once the extension is idle. Users do
nothing, as long as these hold:

- **Same item, higher version.** A new item ID would be a separate extension
  with its own (empty) saved data.
- **No new required permissions.** Adding to `permissions` or
  `host_permissions` makes Chrome disable the extension for every user until
  they accept the new warning. `node test-formats.js` fails if either list
  grows; put new site access in `optional_host_permissions` and request it at
  runtime.
- **Saved data stays readable.** `chrome.storage.local` survives updates. If its
  shape changes, convert it in `chrome.runtime.onInstalled` with
  `reason === "update"` (see the `allFrames` migration in `background.js`).

A copy loaded with **Load unpacked** never updates by itself (reload it in
`chrome://extensions`) and is a different extension from the store copy.

Checked on 2026-10-06 with a simulated update (Chromium 1148, unpacked reload
to a higher version): saved values were kept, and a tab opened before the
update filled from the popup without reloading the page. Chrome for Testing
153 disables an unpacked extension on reload, so it cannot run this check.
