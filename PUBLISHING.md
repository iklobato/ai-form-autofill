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
2. Run the checks: `node test-formats.js`.
3. Build the zip with only the files the extension ships (README, PRIVACY,
   tests and `.git` stay out):
   ```sh
   zip ai-form-autofill.zip manifest.json background.js shared.js providers.js \
     formdom.js content.js popup.js popup.html options.js options.html \
     icon16.png icon48.png icon128.png
   ```
4. In the dashboard, open the item, go to **Package**, upload the zip, and
   submit for review.

Listing text, screenshots and the privacy policy are edited in the dashboard.
