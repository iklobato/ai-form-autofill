#!/usr/bin/env bash
# Build a Chrome Web Store upload zip containing only the shippable files.
set -euo pipefail

cd "$(dirname "$0")"

command -v zip >/dev/null 2>&1 || {
  echo "error: 'zip' is not installed" >&2
  exit 1
}

# The shippable file list lives in files.txt (shared with CI) — read it,
# dropping comment and blank lines.
[[ -f files.txt ]] || {
  echo "error: files.txt not found" >&2
  exit 1
}
files=()
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// /}" ]] && continue
  files+=("$line")
done <files.txt

for f in "${files[@]}"; do
  [[ -f "$f" ]] || {
    echo "error: missing required file: $f" >&2
    exit 1
  }
done

version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)"
[[ -n "$version" ]] || {
  echo "error: could not read version from manifest.json" >&2
  exit 1
}

out="ai-form-autofill-${version}.zip"
rm -f "$out"
zip -q "$out" "${files[@]}"

printf 'Created %s (%s)\n' "$out" "$(du -h "$out" | cut -f1)"
