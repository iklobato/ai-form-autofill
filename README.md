# AI Form Autofill (Chrome extension)

Fills web forms with AI, learns from what you type, and suggests values. You can
set a different provider, model, instructions and knowledge base per website.

Chrome Web Store item `eipchmghhpnfdlpcbkhgbndmkacieppe`. Release state, known
gaps and next steps live in [STATUS.md](STATUS.md).

## How a fill works

1. **Trigger.** Click the toolbar icon, then **Autofill this page**. On a site
   where you turned on **Auto-fill this site automatically**, it also runs on page
   load and again as new fields appear (wizard steps).
2. **Every frame.** The popup injects into all frames of the tab, so forms
   embedded from another site (Greenhouse, Lever inside a careers page) are
   reached. If such a frame is blocked, the popup offers **Allow access to the
   embedded form**, which asks for access to that one site.
3. **Scan.** Only **empty** fillable fields are considered, so a second run never
   overwrites what you typed. Supported: text-like inputs, textareas, selects,
   radio groups, checkbox groups, single checkboxes and `contenteditable` editors.
   Passwords, file inputs and sensitive fields are skipped.
4. **Match each field to a concept** (`email`, `first_name`, `job_title`, ...):
   learned field map first, then the `autocomplete` token, then label/placeholder
   heuristics. The same meaning shares one stored value across sites, even when
   the field names differ.
5. **Memory first.** A short field with a saved value is filled from memory: no
   API call. **Long fields** (textarea, rich text, `maxLength > 250`) always go to
   the AI, so an essay written for one company is not pasted into another; the
   saved answer is sent as context and used only if the AI returns nothing.
6. **AI for the rest.** Unknown fields go to your provider. Essay fields can use a
   separate **long-form model** with a bigger output budget (8192 tokens).
7. **Preview (default).** A panel shows every proposed value with a checkbox, an
   editable value (a textarea for long answers, so paragraphs survive), its
   source (`memory` or `AI`) and a 🚫 button to never fill that field on this site.
   On auto-fill sites values are written directly and then a review pass asks the
   AI to check that each answer fits its question.
8. **Options that did not match.** A value like "USA" for a select offering
   "United States" is resolved by one AI call for all such fields.
9. **Verify and correct.** Fields that fail the page's own validation are sent
   back to the AI with the error, up to two rounds.
10. **Ask when unsure.** Required fields still empty, and fields the AI flagged,
    open a small panel with the AI's question. Fields with fixed choices show
    their own options; open questions get a textarea. Answers are filled and saved.
11. **Learn.** Confirmed values are saved under their concept; values you type are
    captured too (debounced, sensitive fields excluded).

A status toast on the page reports progress ("Filling 5 fields…"), the result or
the error, because the popup closes as soon as you click away.

## What is sent to the AI

- **System prompt:** the task instructions, your global and per-site instructions,
  and your knowledge base. It is the part that repeats across calls, so it is
  marked cacheable (`cache_control`) for Claude: by the Anthropic provider, and
  by the OpenRouter provider for `anthropic/` models.
- **User message:** the page (URL, title, up to 12 headings, up to 6000 chars of
  visible text), up to 50 saved values ranked by use count then recency, and the
  field descriptions (label, type, placeholder, help text, nearby question and
  heading, options, constraints).

Calls go straight from the browser to Anthropic, OpenAI or OpenRouter with your
key (30 s timeout). Keys, settings and saved values stay in
`chrome.storage.local`. See [PRIVACY.md](PRIVACY.md).

## Other features

- **Inline chip:** focus an empty field for the remembered value and a `✨ AI`
  one-off suggestion.
- **Import autofill from page:** saves values already on the form, including ones
  Chrome autofilled, keyed by their `autocomplete` token.
- **Build the knowledge base from a URL** (Settings → Knowledge base): fetches a
  public page (résumé, portfolio) and extracts 50+ field/value pairs, including
  aliases and parts (full name to first/last). Works best on static pages; login
  or JS-rendered pages return little text.
- **Per-website settings:** provider, model, long-form model, instructions and
  knowledge base per domain, layered on top of the global ones.
- **Saved data:** view, edit, search, group by site, remove, merge duplicate keys
  with AI, and re-enable blocked fills.
- **Learn on all sites** (off by default): captures typed values on every site;
  asks for access to all sites.
- Settings page marks **Unsaved changes**, warns before closing, saves on
  Cmd/Ctrl+S. Save is manual on purpose: it replaces the whole memory store and
  must not race live captures.

## Install (load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and select this folder.
3. Open **Settings & knowledge base** from the popup, add a key for at least one
   provider, pick a default provider and model, and fill your knowledge base.

| Provider | Key format | Example models |
|----------|-----------|----------------|
| Anthropic | `sk-ant-...` | `claude-opus-4-8`, `claude-sonnet-4-6` |
| OpenAI | `sk-...` | `gpt-4o`, `gpt-4o-mini`, `o4-mini` |
| OpenRouter | `sk-or-...` | `openai/gpt-4o`, `anthropic/claude-sonnet-4-6` |

Without a key only saved values fill. Anthropic is called from the browser with
`anthropic-dangerous-direct-browser-access`.

## Code map

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest: `storage`, `activeTab`, `scripting`, provider hosts; all other sites optional |
| `shared.js` | Shared by every context: storage stores, settings resolution, `SensitivePolicy`, `ConceptResolver`, `FieldInfo`, `FrameReplies` |
| `formdom.js` | Page side: field wrappers (`FormField`, `ChoiceGroupField`, `RichTextField`), `FormScanner`, `PageContext` |
| `content.js` | Page side: `ContentApp` flow, preview/ask panel, chip, toast, capture, wizard observer |
| `background.js` | Service worker: `PromptBuilder`, `AutofillService`, knowledge extraction, memory merge, site script registration, message router |
| `providers.js` | HTTP client and the Anthropic / OpenAI-compatible providers |
| `popup.*`, `options.*` | Toolbar popup and settings page |

## Tests

- `node test-formats.js`: no dependencies. Runs the real `shared.js`,
  `formdom.js`, `providers.js` and `background.js` against ~66 field formats plus
  service checks (routing, reuse, ranking, caching, option picking, frame
  merging). 213 checks at the time of writing.
- `node --test tests/e2e/extension.test.js`: the real extension in a real
  Chromium, every feature (popup, auto-fill, wizard, iframes, preview, ask panel,
  chip, capture, import, settings, saved data, providers, errors). The AI is a
  scripted fake inside the service worker, so it runs offline and free. No repo
  dependency: Playwright comes from the npx cache (or `PLAYWRIGHT_PATH`).
- `node --test tests/e2e/smoke-real.test.js`: one fill per provider against the
  real APIs, for each of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `OPENROUTER_API_KEY` that is set; Claude models also check the cache read.
  Costs a few cents.
- `tests/deep-autofill.test.js`: older end-to-end test against
  `test-form.html`; needs Playwright (`npm i -D playwright`) and a local server
  (`python3 -m http.server 8731`).

## Publishing

Manual upload in the Chrome Web Store dashboard; see [PUBLISHING.md](PUBLISHING.md)
and the listing texts in [STORE_LISTING.md](STORE_LISTING.md).

## Limits

- Chrome does not expose its saved autofill profiles to extensions. Let Chrome
  fill a form, then use **Import autofill from page**.
- File inputs, passwords and sensitive fields are never filled or stored.
