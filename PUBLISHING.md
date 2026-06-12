# Publishing (automated package upload + publish)

`publish.sh` ships a new package version to the Chrome Web Store via the Web Store
API. Use it for every update after the first listing exists.

## One-time setup

### 1. Finish the first listing manually
The API cannot set listing metadata. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole):
- Pay the $5 fee, verify your account.
- Upload `ai-form-autofill-<version>.zip` (from `./package.sh`) once.
- Fill the **Store listing** (description, ≥1 screenshot), **Privacy** tab
  (justifications, data disclosures, privacy-policy URL) — see `STORE_LISTING.md`.
- Publish it once from the dashboard.
- Copy the **Item ID** from the item's URL — that's `CWS_EXTENSION_ID`.

### 2. Create API credentials (one time)
1. [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **Chrome Web Store API**.
3. **OAuth consent screen** → External → add yourself as a **Test user**.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
   Save the **Client ID** and **Client secret**.
5. Get a **refresh token** (one-time consent). In a browser, visit (replace
   CLIENT_ID), approve, and copy the `code` from the redirect:
   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&prompt=consent&scope=https://www.googleapis.com/auth/chromewebstore&redirect_uri=urn:ietf:wg:oauth:2.0:oob&client_id=CLIENT_ID
   ```
   Then exchange the code for a refresh token:
   ```
   curl -s -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d code=THE_CODE -d grant_type=authorization_code \
     -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```
   Copy `refresh_token` from the response.

## Usage (each release)

```sh
./package.sh        # build the zip (bump manifest.json "version" first)

export CWS_CLIENT_ID=...        # do NOT commit these
export CWS_CLIENT_SECRET=...
export CWS_REFRESH_TOKEN=...
export CWS_EXTENSION_ID=...     # the dashboard Item ID

./publish.sh        # uploads the zip and publishes
```

`publish.sh` reads secrets only from the environment — never hardcode them, never
commit them. After it runs, track review status in the dashboard.

## Automatic publish on merge to main (GitHub Actions)

`.github/workflows/publish.yml` publishes on every push to `main` (i.e. every PR
merge). It verifies (syntax + `test-formats.js`), sets the version to
`<major>.<minor>.<run_number>` so each run is unique, packages, and publishes —
no manual version bump needed.

### One-time setup
1. Do the **first listing manually** (above) so the item + listing exist, and
   note the **Item ID**.
2. Create the **OAuth credentials** and a **refresh token** (steps above).
3. In the GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**, add all four:
   - `CWS_CLIENT_ID`
   - `CWS_CLIENT_SECRET`
   - `CWS_REFRESH_TOKEN`
   - `CWS_EXTENSION_ID`
4. Push this repo to GitHub with `main` as the default branch.

After that, every merge to `main` auto-publishes. You can also trigger it
manually from the **Actions** tab (workflow_dispatch).

### Notes
- Bump the **major/minor** in `manifest.json` when you want (e.g. `1.1` → `1.2`);
  the patch is always the run number, so versions never collide.
- The CI publishes the **package** only — listing copy, screenshots and the
  privacy policy are still edited in the dashboard.
- A failed verify step stops the publish, so broken code won't ship.

## Notes
- A new upload must have a higher `version` than the published one.
- The API publishes the package; listing/screenshot/privacy changes still go
  through the dashboard.
