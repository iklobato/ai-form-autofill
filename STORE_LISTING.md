# Chrome Web Store listing — AI Form Autofill

Copy/paste material for the Developer Dashboard. Sections map to the dashboard
fields and the "Privacy practices" tab.

---

## Name
AI Form Autofill

## Summary (≤132 chars)
Fill web forms with AI. Learns from what you type, suggests values, and lets you
set a model, prompt and knowledge base per site.

## Category
Productivity

## Single purpose (required)
Help the user fill out web forms by suggesting and entering values, using an AI
provider the user configures and a knowledge base the user provides.

## Detailed description
AI Form Autofill fills web forms for you using the AI provider you choose
(Anthropic, OpenAI, or OpenRouter — bring your own API key).

How it works:
- Click the extension on any form and choose Autofill. You see a preview of the
  proposed values — each editable, with a checkbox — and confirm what gets filled.
- It learns from what you type (sensitive fields like passwords, cards, and OTPs
  are never stored) and reuses those values on similar forms across sites, instantly
  and offline.
- Focus an empty field for an inline suggestion from your saved values or the AI.
- Provide a knowledge base (name, contact, links, work history, preferences) once
  and the AI uses it to answer form fields — including free-text questions. You can
  even build the knowledge base automatically from a URL (résumé, portfolio,
  public profile).
- Configure a different provider, model, instructions, and knowledge base per
  website.
- Optionally enable "Auto-fill this site automatically" for a specific site to
  fill it on page load (this asks for access to that site).

Your API keys, settings, and saved values are stored locally in your browser.
Nothing is sent to the developer — form data goes only to the AI provider you
configured. See the privacy policy for details.

## Privacy policy URL
(Host PRIVACY.md, e.g. on GitHub Pages, and put the URL here.)

---

## Permission justifications (reviewers ask for these)

- **storage** — Save your settings, API keys, and the values learned from forms,
  locally on your device.
- **activeTab** — When you click Autofill or Import, read and fill the form on the
  current tab for that action only. No standing access to the page.
- **scripting** — Inject the form-filling script into the current tab on your click
  (activeTab), and register a content script for a specific site only when you
  enable "Auto-fill this site automatically" for it.
- **host_permissions: api.anthropic.com, api.openai.com, openrouter.ai** — Send
  form-field descriptions, the page's readable text (so answers fit, e.g., the job
  posting being applied to), and your knowledge base to the AI provider you chose
  to obtain suggested values. These are the only always-allowed hosts.
- **optional_host_permissions (all sites)** — Requested at runtime, per site, only
  when you (a) enable automatic fill for that site, or (b) build a knowledge base
  from a URL. Not granted by default.

## Remote code
No remote code is executed. All logic ships in the package. The extension only
makes HTTPS API calls to the AI provider you configure.

---

## Privacy practices tab — data collection answers

The extension collects/uses the following **to provide the feature, on the user's
device and to the user's chosen AI provider only** (not to the developer):

- **Personally identifiable information** (name, address, email, phone): YES —
  the user enters this; stored locally; sent to the chosen AI provider to fill
  forms.
- **Authentication information** (passwords): NO — sensitive fields are excluded
  and never stored or sent.
- **Personal communications, financial/payment info, health info, location,
  web history, user activity (clicks, keystroke logging), website content for
  unrelated purposes**: NO.
  - Note: the extension reads form fields and the page's visible text only when
    you invoke it, to fill that form (the page text lets answers match, e.g., the
    job posting) — not to track activity.

Certifications (all must be true and are):
- I do not sell or transfer user data to third parties outside the approved use
  cases.
- I do not use or transfer user data for purposes unrelated to the item's single
  purpose.
- I do not use or transfer user data to determine creditworthiness or for lending.

---

## Suggested assets to prepare
- Screenshots (1280×800 or 640×400): the preview panel filling a form; the Options
  tabs (General, Knowledge base, Websites, Saved data); the popup with the per-site
  auto-fill toggle.
- 128×128 icon (already in the package: icon128.png).
- Optional 440×280 promo tile.
