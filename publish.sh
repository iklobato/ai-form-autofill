#!/usr/bin/env bash
# Upload the built zip to the Chrome Web Store and publish it, via the
# Web Store API. Credentials are read from the environment — never hardcode them.
#
# Required env vars (see PUBLISHING.md for how to obtain them):
#   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID
#
# The store LISTING (description, screenshots, privacy policy, data disclosures)
# must already be filled in the dashboard — this script only ships the package.
set -euo pipefail

cd "$(dirname "$0")"

: "${CWS_CLIENT_ID:?set CWS_CLIENT_ID}"
: "${CWS_CLIENT_SECRET:?set CWS_CLIENT_SECRET}"
: "${CWS_REFRESH_TOKEN:?set CWS_REFRESH_TOKEN}"
: "${CWS_EXTENSION_ID:?set CWS_EXTENSION_ID}"

command -v curl >/dev/null 2>&1 || {
  echo "error: 'curl' is required" >&2
  exit 1
}

json_field() {
  # crude single-field extractor: json_field <key> <<<"$json"
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)"
zip="ai-form-autofill-${version}.zip"
[[ -f "$zip" ]] || {
  echo "error: $zip not found — run ./package.sh first" >&2
  exit 1
}

echo "Requesting access token…"
token_resp="$(curl -fsS -X POST https://oauth2.googleapis.com/token \
  -d client_id="$CWS_CLIENT_ID" \
  -d client_secret="$CWS_CLIENT_SECRET" \
  -d refresh_token="$CWS_REFRESH_TOKEN" \
  -d grant_type=refresh_token)"
access_token="$(json_field access_token <<<"$token_resp")"
[[ -n "$access_token" ]] || {
  echo "error: could not obtain access token: $token_resp" >&2
  exit 1
}

echo "Uploading $zip to item $CWS_EXTENSION_ID…"
upload_resp="$(curl -fsS \
  -H "Authorization: Bearer $access_token" \
  -H "x-goog-api-version: 2" \
  -X PUT -T "$zip" \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$CWS_EXTENSION_ID")"
echo "$upload_resp"
grep -q '"uploadState"[[:space:]]*:[[:space:]]*"SUCCESS"' <<<"$upload_resp" || {
  echo "error: upload did not report SUCCESS (see response above)" >&2
  exit 1
}

echo "Publishing…"
publish_resp="$(curl -fsS \
  -H "Authorization: Bearer $access_token" \
  -H "x-goog-api-version: 2" \
  -H "Content-Length: 0" \
  -X POST \
  "https://www.googleapis.com/chromewebstore/v1.1/items/$CWS_EXTENSION_ID/publish")"
echo "$publish_resp"

echo "Submitted. Check the Developer Dashboard for review status."
