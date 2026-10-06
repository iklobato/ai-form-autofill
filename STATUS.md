# Project status

_Last updated: 2026-10-06_

## Where it stands

- **Version 1.3.2 is live** on the Chrome Web Store (review passed, store email
  on 2026-10-06; visibility Public). Item ID `eipchmghhpnfdlpcbkhgbndmkacieppe`:
  https://chromewebstore.google.com/detail/eipchmghhpnfdlpcbkhgbndmkacieppe
  Adds the version in the popup and ARIA radios/checkboxes (Google Forms).
  Same permissions as 1.3.1.
- The package Chrome's update server hands out was downloaded on 2026-10-06
  and compared with main: manifest says 1.3.2, every file is identical; the
  store only adds `update_url` to the manifest and a `_metadata` folder. The
  e2e suite passed 47/47 on that published package. Installed copies move to
  1.3.2 on their own (see "How users get the update" in PUBLISHING.md).
- Repo made **public** on 2026-09-30 so the listing can link the homepage,
  support page and privacy policy. The full history was scanned for keys and
  tokens first; none found.
- Releases are **manual** (see PUBLISHING.md). The next upload must be at least
  1.3.3.
- 1.3.1 carries every fix merged since 1.3.0 (PRs #6 to #12), including
  sensitive fields kept away from the AI and support for Claude Sonnet 5.5 /
  Opus 5.5 / Fable 5.1. The same zip passed 45/45 e2e tests and 214 unit checks
  before upload.
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
| #8 | The suggestion chip stays when focus moves to the next field. |
| #9 | README, store listing and this status file brought up to date. |
| #10 | Claude Sonnet 5.5 / Opus 5.5 / Fable 5.1 work (no forced tool call); tests for the unsaved-changes prompt and the release zip; the old deep-autofill test runs again. |
| #11 | Status after the validation run. |
| #12 | Version 1.3.1. |
| #13 | Status records the 1.3.1 upload. |
| #14 | Project docs brought up to date after 1.3.1. |
| #15 | Guard against new required permissions; how installed copies update. |
| #16 | Version in the popup; ARIA radios/checkboxes (Google Forms); headless e2e. |
| #17 | Version 1.3.2. |
| #18 | Status records the 1.3.2 upload. |
| #19 | Status records 1.3.2 as live. |
| #20 | Embedded-form permission prompt checked on the published package. |

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
- **Google Forms choices were invisible.** Its radios and checkboxes are
  `div role="radio"`/`"checkbox"`, not `<input>`s, so the scanner skipped them;
  now read and filled through `AriaChoiceField` (state via `aria-checked`,
  changed by clicking).
- **The chip vanished on Tab** (#8): moving to the next field hid its chip 200 ms
  after it appeared.
- **Current Claude models failed every fill** (#10). The Anthropic provider
  forced the `result` tool (`tool_choice: tool`), which Claude Sonnet 5.5, Opus
  5.5 and Fable 5.1 reject with a 400. It now uses `tool_choice: auto` and asks
  for the tool in the system prompt; text replies are still parsed.
- **The old real-browser test had silently stopped running** (#10): its chrome
  stub lacked `runtime.onInstalled`, so `background.js` threw before the message
  router loaded.
- **A busy port made the e2e suite fail with no reason** (#10): another server on
  127.0.0.1 answered the fixture requests (36 failures). The suite now stops
  with "Fixture port busy".

## Not verified

- **A live Google Form.** The test form
  (`docs.google.com/forms/d/e/1FAIpQLSf...iOymeiA`) needs a Google sign-in. One
  headless run with the Brave session saw its 15 questions (13 text/textarea,
  1 ARIA radio group "Level English", 1 file upload); every later attempt,
  including cookies exported by hand, was sent to the sign-in page (likely
  Google rejecting a copied session). ARIA choices are covered by a local
  fixture that copies the Google Forms markup (test C7), not by the real site.

- **api.anthropic.com itself** (no Anthropic key). The Anthropic provider's
  exact requests were run against real Claude through OpenRouter's
  Anthropic-compatible `/v1/messages` on 2026-10-06: Sonnet 4.6 and Sonnet 5.5
  fill the test form and read the cache on a repeat fill (3,172 and 3,985
  tokens). Opus 5.5 and Fable 5.1 were not run.
- **Chrome's permission prompt as a repeatable test.** One scripted run
  (macOS accessibility) saw the real prompt for "Learn on all sites" ("Read and
  change all your data on all websites") and Allow granted it; the test was not
  kept because it passed about 1 run in 5 on a machine in use.
- **Embedded-form prompt (checked 2026-10-06).** On the published 1.3.2
  package, with its manifest unchanged, a request for one new site from a
  click stays pending (Chrome's prompt is waiting) and grants nothing on its
  own; a site already in `host_permissions` resolves `true` at once. The
  earlier "granted with no prompt" came from the e2e harness, which adds the
  test hosts to `host_permissions`, so Chrome had nothing new to ask. Chromium's
  `permissions_api.cc` skips the prompt only for component extensions, so a
  store install follows the same rule. Not done: installing from the store
  itself (the store page refuses Chrome for Testing: "Switch to Chrome") and
  seeing the prompt's text.
- **Answer quality across many runs.** `gpt-4o-mini` on OpenAI left the cover
  letter empty in 2 of 3 runs before the context fix and wrote it in 1 of 1
  after; too few runs to call it a rate.

## Verified on 2026-10-06

- `node test-formats.js`: 216 checks. `node --test tests/e2e/extension.test.js`:
  47 tests, run against the 1.3.2 upload zip and again against the package
  the store serves. (1.3.1: 214 checks, 45 tests.)
- The embedded-form permission prompt opens on the published 1.3.2 package
  (see "Not verified" for what that check did not cover).
- The `beforeunload` prompt in Settings (test H1b).
- `tests/deep-autofill.test.js` passes (with Playwright from the npx cache:
  `NODE_PATH=<npx playwright node_modules>` and a server on 8731).
- Every file the manifest, HTML pages and scripts load is in the release zip
  list.

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
  text is used only to fill that form. The 1.3.1 and 1.3.2 reviews passed with it
  unchecked (the 1.3.0 outcome was not recorded); if a later review objects, check it and resubmit.
- **An AI error drops the saved values too.** If the AI call fails (bad key,
  rate limit, timeout), nothing is filled, not even fields that have a saved
  value.
- **"Clear" in Saved data asks nothing**: one click deletes every saved value.
- **Opus 5.5 and Fable 5.1 checked only by the docs**: neither was run;
  the API docs list the same forced-tool error as Sonnet 5.5, which is fixed.

## Next steps

1. A live Google Form (needs a form that does not require sign-in).

## Still open (not scheduled)

- Fill from saved values when the AI call fails, instead of filling nothing.
- Ask before "Clear" deletes all saved values.
- Fill a cross-origin iframe on page load for auto-fill sites (needs that
  site's own access).
- A repeatable test of Chrome's permission prompt, on a machine nobody is using.
- A field labelled just "Name" does not map to `full_name`, so a saved full name
  is not reused there (the AI still fills it from the knowledge base).

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
