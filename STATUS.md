# Project status

_Last updated: 2026-10-06_

## Where it stands

- **Version 1.3.0** submitted to the Chrome Web Store on 2026-09-30. Status:
  **Pending review**. Item ID `eipchmghhpnfdlpcbkhgbndmkacieppe`. Store page once
  approved: https://chromewebstore.google.com/detail/eipchmghhpnfdlpcbkhgbndmkacieppe
- Not live until the review passes. The review may take longer than usual because
  the manifest asks for optional access to all sites.
- Repo made **public** on 2026-09-30 so the listing can link the homepage,
  support page and privacy policy. The full history was scanned for keys and
  tokens first; none found.
- Releases are **manual** (see PUBLISHING.md). The next upload must be at least
  1.3.1.
- **Fixes merged on main but not released.** PRs #6 and #7 (2026-10-06) fixed six
  bugs found by the new end-to-end suite, including sensitive fields being sent
  to the AI. They reach users only with 1.3.1. Decision on 2026-10-06: wait for
  the 1.3.0 review to finish, then upload 1.3.1, so the pending review is not
  replaced (what the dashboard does with a new upload during review was not
  checked).
- The 1.3.0 listing says sensitive fields are "never saved or sent". In 1.3.0 a
  text field such as "Social security number" was sent to the AI: its label on
  every fill, and the typed value too if it failed the page's validation. True
  from 1.3.1.

## Done

| PR | What |
|----|------|
| #1 | Forms inside iframes are filled; long answers re-written by the AI per page; only empty fields filled; memory ranked by use; one AI call for all unmatched options; knowledge base in a cacheable system prompt; popup no longer errors during an auto-fill run. Then: textarea in the preview, status toast on the page, option pickers in the "ask" panel, unsaved-changes guard and Cmd/Ctrl+S in Settings. |
| #2 | Removed the GitHub Actions publish workflow, `publish.sh`, `package.sh` and `files.txt`; PUBLISHING.md rewritten for manual releases. |
| #3 | Version 1.3.0. |
| #4 | Preview checkbox no longer inherits page `input` styles. |
| #5 | Privacy policy covers "Learn on all sites" and the embedded-form access prompt. |
| #6 | End-to-end suite `tests/e2e`: the real extension in Chromium with a scripted fake AI, every feature; plus a real-API smoke test. |
| #7 | Six bugs from that suite fixed (below); OpenRouter caches the system prompt for Claude models. |
| #8 | (open) The suggestion chip stays when focus moves to the next field. |

## What we found (and fixed)

- **Embedded forms were invisible.** Injection had no `allFrames`, so forms from
  another site inside an iframe stayed fully manual.
- **Saved essays were reused as-is.** A "why this company" answer saved for one
  company was pasted, unchanged, into the next company's form.
- **Re-runs overwrote edits.** On wizard steps the auto-fill ran over every field,
  not only empty ones.
- **Memory context was arbitrary.** The AI got the first 50 saved values in
  insertion order, so frequent facts could drop out as memory grew.
- **One AI call per unmatched select**, run one after another.
- **"Autofill already running" error** when the popup click landed while the
  injection-triggered auto-fill was running; the fill itself had worked.
- **Preview destroyed paragraphs.** It used `<input type=text>`, which strips line
  breaks, and that edited value is what got filled.
- **Page CSS broke the preview.** Pages that style every `input` stretched the row
  checkbox and hid labels and values. Found only when screenshotting a styled page;
  the earlier test pages had no CSS.
- **The publish workflow never worked.** The repo never had store credentials, so
  every run failed at the publish step. The old PUBLISHING.md also used Google's
  retired OAuth "OOB" redirect.
- **Privacy policy was inaccurate** about background reading (the opt-in "Learn on
  all sites" does capture on every site).
- **Sensitive fields went to the AI** (#7). Only passwords and file inputs were
  skipped; a text field like "Social security number" was sent on every fill and
  got an AI chip. They were only kept out of memory.
- **"Select..." was a real option** (#7): sent to the AI and offered in the ask
  panel.
- **Context came from the previous field** (#7): "Email" was sent with the question
  "Last name"; a fieldset legend became the context of the fields after it.
- **A confirmed fill counted twice** (#7): the typing capture also saved the
  extension's own `fill()` events, doubling the use count that ranks memory.
- **The extension's panels were captured** (#7): answers typed in the ask panel
  were saved again under junk keys like `field_select_one_22`.
- **No per-site long-answer model field** (#7), though settings used it.
- **Claude on OpenRouter cached nothing** (#7): 0 cached tokens on back-to-back
  fills; after the fix a repeat fill read 3,609 of 5,272 input tokens from cache.
- **The chip vanished on Tab** (#8): moving to the next field hid its chip 200 ms
  after it appeared.

## Not verified

- Chrome's real permission prompt for the embedded-form button (tests granted
  access through the manifest instead).
- The `beforeunload` warning dialog in Settings (only the "Unsaved changes" label
  was checked).
- The Anthropic provider against the real API (no key was available): its prompt
  caching is still not measured. Real calls ran on 2026-10-06 for OpenAI and
  OpenRouter (`gpt-4o-mini`, `anthropic/claude-sonnet-5.5`). `gpt-4o-mini` on
  OpenAI left the cover letter empty in 2 of 3 runs before the context fix and
  wrote it in 1 of 1 after; too few runs to call it a rate.
- `tests/deep-autofill.test.js` is still not run (needs Playwright in the repo);
  `tests/e2e` covers the same flows without it.

## Known gaps

- **Auto-fill sites and embedded forms:** the per-site script matches only that
  site's own host, so an iframe from another host is not filled on page load;
  it is filled when you click **Autofill this page**.
- **Page context inside an iframe** is the iframe's own text, so a job post shown
  by the parent page is not sent to the AI.
- **Per-site settings inside an iframe** resolve by the frame's host, not the
  page's.
- **30 s request timeout** is shared with long-form calls that can return up to
  8192 tokens; a slow model on several essays could hit it (not measured).
- **Panels are styled inline**, not isolated in a shadow root; other page CSS
  (for example on `textarea` or `select`) can still change how they look.
- **Store data disclosure:** "Website content" was left unchecked because page
  text is used only to fill that form. If the review objects, check it and
  resubmit.

## Next steps

1. Wait for the review email. If rejected, fix what it names and resubmit.
2. Once live, check the store page, install from the store and fill one real form.

## Backlog (not started)

- Keyboard shortcut for "Autofill this page" (`commands` in the manifest).
- Inline chip: keyboard access, Esc to close, full value visible (now cut at 40
  chars).
- Undo the last fill.
- Highlight fields the AI filled so they are easy to review.
- First-run guidance when no API key or an empty knowledge base.
- Plain error messages (e.g. "API key is invalid" instead of the raw 401).
- Optional review pass (setting), to save one AI call per auto-fill.
- Shadow DOM for the extension's page UI.
