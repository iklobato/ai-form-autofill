# Privacy Policy — AI Form Autofill

_Last updated: 2026-06-10_

AI Form Autofill ("the extension") helps you fill web forms using an AI provider
you choose. This policy explains what data the extension handles and where it
goes. **The developer operates no servers and receives none of your data.**

## What the extension stores (locally, on your device)

All of the following is kept in your browser via `chrome.storage.local` and never
leaves your machine except as described under "What is sent to AI providers":

- **API keys** you enter for Anthropic, OpenAI, and/or OpenRouter.
- **Settings**: default provider/model, global instructions, your knowledge base,
  and per-website overrides.
- **Saved values ("memory")**: values learned from forms you fill, keyed by field
  name, plus the website they were first seen on. You can view, edit, and delete
  these at any time in the extension's Options page, or clear them entirely.

Sensitive fields — passwords, credit-card numbers, CVV/CSC, one-time codes,
SSNs, bank/account numbers, API keys, and similar — are detected and **never
captured or stored**.

## What is sent to AI providers

When you ask the extension to fill a form or suggest a value, or to build your
knowledge base from a URL, it sends the following to **the AI provider you
configured** (Anthropic, OpenAI, or OpenRouter):

- A description of the form's fields (labels, types, and surrounding context — not
  pre-existing sensitive values).
- The page the form is on: its URL, title, headings, and a trimmed excerpt of its
  visible text (so answers can be tailored to, e.g., the job posting being
  applied to).
- Your knowledge base and previously saved values, used as context.
- For "build knowledge base from a URL", the readable text of the page you
  specified.
- For the optional "Merge duplicates (AI)" cleanup in Options, the names of your
  saved fields with short value previews.

This data is transmitted directly from your browser to that provider's API using
the API key you supplied. It is handled under **that provider's** privacy policy:

- Anthropic — https://www.anthropic.com/legal/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- OpenRouter — https://openrouter.ai/privacy

The extension does not send your data anywhere else, and the developer has no
server that receives it.

## Site access

The extension requests access to a website only when you act:

- Clicking **Autofill** / **Import** uses temporary access to the current tab
  (`activeTab`) for that action only.
- Enabling **Auto-fill this site automatically** asks for ongoing access to that
  one site, so it can fill on page load. You can revoke this anytime in
  `chrome://extensions`.
- **Build knowledge base from a URL** asks for access to the URL you entered.

It does not read pages in the background, track your browsing, or collect browsing
history.

## What we do not do

- We do not sell or share your data.
- We do not use your data for advertising or for any purpose unrelated to filling
  forms for you.
- We do not transmit your data to the developer.

## Removing your data

Uninstalling the extension removes everything it stored. You can also clear saved
values and settings from the Options page at any time.

## Contact

Questions: ikk.lobs@gmail.com
