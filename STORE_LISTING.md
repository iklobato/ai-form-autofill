# Chrome Web Store listing: AI Form Autofill

The texts submitted with version 1.3.0 on 2026-09-30 (item
`eipchmghhpnfdlpcbkhgbndmkacieppe`). Version 1.3.1 (2026-10-06) was a new
package only; no listing change was recorded with it. Sections map to the
dashboard fields. Keep this file in sync when the listing changes.

The description's last line ("sensitive fields are never saved or sent") is
true only from 1.3.1: in 1.3.0 a text field such as "Social security number"
had its label sent to the AI.

---

## Store listing tab

**Title and summary:** taken from `manifest.json` (`name`, `description`).

**Category:** Productivity. **Language:** English. **Mature content:** No.

**Homepage URL:** https://github.com/iklobato/ai-form-autofill

**Support URL:** https://github.com/iklobato/ai-form-autofill/issues

**Store icon:** `icon128.png`.

**Screenshots** (1280x800 JPEG, no alpha, fictional data): the preview panel on
a job form; the filled form with the "ask" panel and status toast; the Knowledge
base settings. They were generated from the real extension with a mocked AI; the
script is not in the repo.

### Description

```
AI Form Autofill fills web forms for you, using the AI provider you choose: Anthropic, OpenAI or OpenRouter (bring your own API key).

How it works
- Click the extension on any form and choose "Autofill this page". A preview shows every proposed value, each one editable, with a checkbox. You decide what gets filled.
- Write your details once in the knowledge base (name, contact, links, work history, preferences). The AI uses it to answer form fields, including open questions like "Why do you want to join us?".
- Long answers are written fresh for each page, using the job post or page you are on, so an answer written for one company is never pasted into another.
- It learns from what you type and reuses those values on similar forms across sites, instantly and without calling the AI.
- If a required field can't be answered from your data, it asks you once and remembers the answer. For fields with fixed choices, you pick from the field's own options.
- Works on forms embedded in other pages (for example job forms shown inside a company's careers page).
- Focus an empty field for an inline suggestion from your saved values or the AI.
- Set a different provider, model, instructions and knowledge base per website.
- Optional: turn on "Auto-fill this site automatically" for a site to fill it when the page loads.

Privacy
Your API keys, settings and saved values stay in your browser. Nothing is sent to the developer. Form details, the visible text of the page you are filling, and your knowledge base go only to the AI provider you set up. Passwords, card numbers, one-time codes and similar sensitive fields are never saved or sent.
```

---

## Privacy practices tab

### Single purpose

```
Help the user fill out web forms by suggesting and entering values, using an AI provider the user configures and a knowledge base the user provides.
```

### Permission justifications

**storage**
```
Saves the user's settings, API keys and the values learned from forms, locally on the user's device.
```

**activeTab**
```
When the user clicks Autofill or Import, the extension reads and fills the form on the current tab for that action only. It has no standing access to the page.
```

**scripting**
```
Injects the form-filling script into the current tab when the user clicks the extension (through activeTab), and registers a content script for a specific site only when the user turns on "Auto-fill this site automatically" for that site.
```

**Host permission**
```
Always-allowed hosts are only the AI provider APIs (api.anthropic.com, api.openai.com, openrouter.ai). The extension sends them the form field descriptions, the visible text of the page being filled and the user's knowledge base, to get suggested values from the provider the user chose. Access to other sites is optional and requested at runtime, one site at a time, only when the user: turns on auto-fill for a site, allows access to a form embedded from another site, builds a knowledge base from a URL, or turns on "Learn on all sites" in Options. None of it is granted by default.
```

### Remote code

Answer: **No, I am not using remote code.**
```
No remote code is executed. All logic ships in the package. The extension only makes HTTPS API calls to the AI provider the user configures.
```

### Data usage

- Checked: **Personally identifiable information** (name, address, email, phone
  the user enters; stored locally, sent to the chosen AI provider to fill forms).
- Unchecked: health, financial and payment, authentication (sensitive fields are
  excluded), personal communications, location, web history, user activity,
  website content.
  - Open point: the visible page text is sent to the AI provider to tailor
    answers. It was left unchecked as "website content" because it is used only
    to fill that form. If the review objects, check it and resubmit.

Certifications (all three checked):
- I do not sell or transfer user data to third parties, outside of the approved
  use cases.
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

### Privacy policy URL

https://github.com/iklobato/ai-form-autofill/blob/main/PRIVACY.md
