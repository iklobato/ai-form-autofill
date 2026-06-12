# AI Form Autofill (Chrome extension)

Auto-fills web forms using AI, learns from what you type, and suggests values.
You can configure a different model, instructions, and knowledge base per website.

## How it works

- **Memory (free, instant):** every non-sensitive value you type into a form is
  saved locally, keyed by a normalized field name. The next time a similar field
  appears anywhere, it can be filled from memory with no API call. These learned
  values also feed the AI as context, so it can fill differently-shaped forms.
- **Concept correlation:** every field is mapped to a canonical *concept* (e.g.
  `username`, `email`, `first_name`) from its label/autocomplete/context — not its
  raw name. So an opaquely-named field (`fld_01`) labelled "Username", a `login`
  field, and a `user name` field all resolve to the same concept and share one
  stored value across forms. When the AI fills an opaque field, it also labels the
  concept, which is remembered so the same field shape fills instantly next time.
- **Sensitive fields are never learned:** passwords, credit-card numbers, CVV/CSC,
  expiry, OTP/one-time codes, SSN, account/routing numbers, API keys/secrets, etc.
  are detected (by field type, `autocomplete`, and name/label) and excluded from
  capture. They are also never sent to the AI.
- **AI fill:** for fields it hasn't seen, the extension sends the field list plus
  your knowledge base to your chosen AI provider and fills in what it returns.
  Memory values are always used first; AI only handles the gaps.
- **Auto-fill (default on):** forms fill automatically on page load. Turn off
  **Auto-fill this site automatically** in the popup (or **Auto-fill
  automatically on all sites** in Options) and clicking **Autofill this page**
  then shows a preview panel of the proposed values — each with a checkbox and an
  editable value — so you confirm what gets written before anything is filled.
- **Import browser autofill:** click **Import autofill from page** in the popup to
  harvest values already on the form — including ones Chrome autofilled — into your
  saved values. Fields are keyed by their standardized `autocomplete` token
  (`email`, `tel`, `given-name`, `address-line1`, …) when present, so a value
  captured on one site fills the matching field on any other site.
- **Inline suggestions:** focus an empty field to get a small chip with the
  remembered value and a `✨ AI` button for a one-off AI suggestion.
- **Verify & correct:** after filling, it re-reads the form and, for any field that
  fails the page's validation (bad format, required-but-empty), asks the AI for a
  corrected value and re-fills — up to two rounds.
- **Ask when unsure:** required fields the AI still couldn't fill get a short inline
  prompt asking you for the value; your answer is filled and remembered, so the
  next form already knows it.

Everything (API key, settings, saved values) is stored in `chrome.storage.local`
on your machine. Nothing is sent anywhere except the AI API you configure.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open the extension's **Settings** (popup → "Settings & knowledge base") and add
   a key for at least one provider (Anthropic, OpenAI, and/or OpenRouter). Pick a
   default provider and model. Optionally set global instructions, a global
   knowledge base, and per-site overrides.

## Providers

The extension supports three providers; set a key for the ones you use:

| Provider | Key format | Example models |
|----------|-----------|----------------|
| Anthropic | `sk-ant-...` | `claude-opus-4-8`, `claude-sonnet-4-6` |
| OpenAI | `sk-...` | `gpt-4o`, `gpt-4o-mini`, `o4-mini` |
| OpenRouter | `sk-or-...` | `openai/gpt-4o`, `anthropic/claude-sonnet-4-6`, `google/gemini-2.5-pro` |

Choose a **default provider** globally, and override the provider/model per domain
under **Per-website settings**. OpenAI and OpenRouter use the OpenAI-compatible
`chat/completions` API; Anthropic uses the Messages API. All calls go directly
from your browser to the provider — no intermediary server.

## Use

- Click the toolbar icon → **Autofill this page**.
- Or just start filling forms; values are remembered for next time.
- Focus an empty field for an inline suggestion chip.

## Build your knowledge base from a URL

In **Settings → Knowledge base**, paste a URL to a page about you (résumé,
portfolio, public profile) and click **Fetch & fill**. The extension fetches the
page and asks the AI to extract a broad **field → value map (50+ entries)** —
canonical fields plus common aliases (email / e-mail / email address) and
components (name → first/last, address → line1/city/state/postal code/country).
Those values are seeded straight into your **Saved values**, so forms fill
instantly from them, and a readable copy is added to the knowledge base textarea
for review. Coverage comes from aliases and components of real data on the page —
it won't invent emails, phone numbers, or IDs that aren't there.

It reads the page's **server HTML**, so it works best on public, mostly-static
pages. Login-gated or heavily JavaScript-rendered pages (e.g. a logged-in
LinkedIn feed) often return little usable text.

## Configure per website

In Settings → **Per-website settings**, add a domain (e.g. `jobs.example.com`) and
give it its own model, instructions, and knowledge base. These layer on top of the
global settings for that domain.

## About browser autofill

Chrome does not expose its saved autofill profiles (addresses, payment methods,
passwords) to extensions — there is no API to read that store, by design. So this
plugin can't pull those records directly. Instead it learns the same data the
moment the browser puts it on a page: let Chrome autofill a form, then click
**Import autofill from page** (or just submit — typed/autofilled values are
captured automatically). Because fields are keyed by their `autocomplete` token,
that data then reuses across every site that asks for the same thing.

## Notes / limits

- Fills text-like inputs, textareas, and selects. Checkboxes, radios, passwords,
  and file inputs are intentionally skipped.
- Without an API key, only saved values are used (no AI).
- Uses the Anthropic Messages API directly from the browser via
  `anthropic-dangerous-direct-browser-access`.
