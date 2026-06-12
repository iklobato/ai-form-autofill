// Shared across every context (content scripts, background worker, popup,
// options). Classes are attached to the AIFF namespace via assignment so they
// never collide across files that share one global scope.

// var (not const/class): these files share one global scope (content-script
// isolated world; importScripts in the worker), so the binding must allow
// idempotent redeclaration.
var AIFF = (self.AIFF = self.AIFF || {});

AIFF.KEYS = {
  SETTINGS: "settings",
  MEMORY: "memory",
  FIELDMAP: "fieldMap",
  BLOCKS: "blocks",
};

// Defaults applied when a setting was never configured. Auto-fill is per-site
// opt-in (enabling it requests host access to that site), so the default is off.
AIFF.DEFAULTS = { autoFill: false };

// The content-script bundle, in load order. Used by both the popup's activeTab
// injection and the background's persistent per-site registration.
AIFF.CONTENT_SCRIPT_FILES = ["shared.js", "formdom.js", "content.js"];

// Starter content shown in the global fields until the user edits them.
AIFF.TEMPLATES = {
  globalPrompt: `Fill each field with my real information from the knowledge base below.
- Match the field's label and surrounding context to the right piece of my data.
- Use the format the field expects (full URL for profile links, digits only for phone/zip, ISO dates when asked).
- For free-text questions (cover letter, "why this role", "describe your experience"), write a concise, professional, first-person answer grounded in my background.
- Leave a field blank ("") if you can't determine a correct value. Never invent emails, phone numbers, IDs, or employer names that aren't in my knowledge base.`,

  globalKnowledge: `# Personal
Full name:
First name:
Last name:
Email:
Phone:

# Location
Address line 1:
City:
State/Province:
Postal code:
Country:

# Links
LinkedIn:
GitHub:
Portfolio / Website:

# Work
Current title:
Current company:
Years of experience:
Top skills:
Education:

# Job application preferences
Work authorization:
Require visa sponsorship:
Willing to relocate:
Desired salary:
Notice period:
Planned time off / unavailability:
Preferred work mode (remote / hybrid / onsite):

# Essay material (used to answer long, open-ended questions)
Key projects (what you built, tech, impact, links):
Production experience highlights (systems, scale, metrics):
Proudest professional achievement:
Why you're a strong candidate (themes to draw on):
Third-person pitch / short bio:

# Notes
(Anything else the AI should know about you.)`,
};

AIFF.PROVIDERS = {
  anthropic: { label: "Anthropic", defaultModel: "claude-sonnet-4-6" },
  openai: { label: "OpenAI", defaultModel: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", defaultModel: "openai/gpt-4o-mini" },
};

AIFF.Text = class Text {
  static normalize(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "_");
  }
};

// Base wrapper over chrome.storage.local for a single key.
AIFF.Store = class Store {
  constructor(key) {
    this.key = key;
  }
  async getRaw() {
    const data = await chrome.storage.local.get(this.key);
    return data[this.key];
  }
  async setRaw(value) {
    return chrome.storage.local.set({ [this.key]: value });
  }
};

// Value object: the configuration resolved for one domain.
AIFF.SiteConfig = class SiteConfig {
  constructor({
    provider,
    model,
    longFormModel,
    prompt,
    knowledge,
    apiKey,
    autoFill,
  }) {
    this.provider = provider;
    this.model = model;
    // Model used for essay-style fields; equals `model` unless configured.
    this.longFormModel = longFormModel || model;
    this.prompt = prompt;
    this.knowledge = knowledge;
    this.apiKey = apiKey;
    this.autoFill = autoFill;
  }
  get hasKey() {
    return !!this.apiKey;
  }
};

// Learned field-shape → concept index, taught by the AI when it classifies an
// opaque field. Lets a meaningless name correlate next time it appears.
AIFF.FieldMapStore = class FieldMapStore extends AIFF.Store {
  constructor() {
    super(AIFF.KEYS.FIELDMAP);
    this._writeChain = Promise.resolve();
  }
  async get() {
    return (await this.getRaw()) || {};
  }
  async set(map) {
    return this.setRaw(map);
  }
  learn(entries) {
    this._writeChain = this._writeChain
      .then(() => this._learn(entries))
      .catch((e) => console.warn("AIFF fieldMap write failed", e));
    return this._writeChain;
  }
  async _learn(entries) {
    const clean = entries.filter(([fp, concept]) => fp && concept);
    if (!clean.length) return;
    const map = await this.get();
    for (const [fp, concept] of clean) map[fp] = concept;
    await this.set(map);
  }
};

// Per-domain blocklist of fills the user disabled: { domain: { conceptKey: true } }.
AIFF.BlockStore = class BlockStore extends AIFF.Store {
  constructor() {
    super(AIFF.KEYS.BLOCKS);
    this._writeChain = Promise.resolve();
  }
  async get() {
    return (await this.getRaw()) || {};
  }
  async set(blocks) {
    return this.setRaw(blocks);
  }
  block(domain, key) {
    return this._mutate((b) => {
      (b[domain] ||= {})[key] = true;
    });
  }
  unblock(domain, key) {
    return this._mutate((b) => {
      if (b[domain]) {
        delete b[domain][key];
        if (!Object.keys(b[domain]).length) delete b[domain];
      }
    });
  }
  _mutate(fn) {
    this._writeChain = this._writeChain
      .then(async () => {
        const b = await this.get();
        fn(b);
        await this.set(b);
      })
      .catch((e) => console.warn("AIFF blocks write failed", e));
    return this._writeChain;
  }
};

// Wraps the raw settings object; the one place that knows the settings shape.
AIFF.Settings = class Settings {
  constructor(raw) {
    this.raw = raw || {};
  }
  get globalAutoFill() {
    return this.raw.autoFill === undefined
      ? AIFF.DEFAULTS.autoFill
      : !!this.raw.autoFill;
  }
  resolve(domain) {
    const site = (this.raw.sites || {})[domain] || {};
    const provider = site.provider || this.raw.defaultProvider || "anthropic";
    const meta = AIFF.PROVIDERS[provider] || AIFF.PROVIDERS.anthropic;
    // The global default model only applies to the default provider; a site that
    // switches provider must not inherit another provider's model id.
    const isDefaultProvider =
      provider === (this.raw.defaultProvider || "anthropic");
    return new AIFF.SiteConfig({
      provider,
      model:
        site.model ||
        (isDefaultProvider ? this.raw.defaultModel : "") ||
        meta.defaultModel,
      // Same provider-scoping rule as the default model: the global long-form
      // model is another provider's id when the site switches provider.
      longFormModel:
        site.longFormModel ||
        (isDefaultProvider ? this.raw.longFormModel : "") ||
        "",
      prompt: [this.raw.globalPrompt, site.prompt].filter(Boolean).join("\n\n"),
      knowledge: [this.raw.globalKnowledge, site.knowledge]
        .filter(Boolean)
        .join("\n\n"),
      apiKey: (this.raw.providerKeys || {})[provider] || "",
      // Per-site override wins (even when false); else the global setting, which
      // defaults to off when never configured (see AIFF.DEFAULTS.autoFill).
      autoFill: "autoFill" in site ? !!site.autoFill : this.globalAutoFill,
    });
  }

  // Like resolve(), but never surfaces the provider API key. Content scripts
  // use this so the secret stays in the background worker; whether a key
  // exists is asked of the worker (fieldLookup) instead.
  resolvePublic(domain) {
    const { provider, model, autoFill } = this.resolve(domain);
    return { provider, model, autoFill };
  }
};

AIFF.SettingsStore = class SettingsStore extends AIFF.Store {
  constructor() {
    super(AIFF.KEYS.SETTINGS);
  }
  async load() {
    return new AIFF.Settings((await this.getRaw()) || {});
  }
  async save(settings) {
    const raw = settings instanceof AIFF.Settings ? settings.raw : settings;
    return this.setRaw(raw);
  }
};

// Decides whether a field's value must never be captured (passwords, cards,
// OTP/2FA/TOTP codes, tokens, etc.). Usable field-side and key-side.
AIFF.SensitivePolicy = class SensitivePolicy {
  static AUTOCOMPLETE = new Set([
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "current-password",
    "new-password",
    "one-time-code",
  ]);
  static PATTERN =
    /\b(password|passwd|pwd|passcode|pin|otp|one[ -]?time|two[ -]?factor|2fa|mfa|totp|authenticator|verification|verify|user[ -]?code|auth(?:entication)?[ -]?code|access[ -]?code|confirmation[ -]?code|security[ -]?code|login[ -]?code|sms[ -]?code|cvv|cvc|csc|card[ -]?number|cardnumber|credit[ -]?card|ssn|social[ -]?security|tax[ -]?id|passport|iban|account[ -]?number|routing|sort[ -]?code|secret|api[ -]?key|token)\b/;

  static isSensitiveText(text) {
    return SensitivePolicy.PATTERN.test(
      AIFF.Text.normalize(text || "").replace(/_/g, " "),
    );
  }
  // For checking an already-stored key (e.g. "user_code_0") during cleanup.
  static isSensitiveKey(key) {
    return SensitivePolicy.isSensitiveText(key);
  }
  // Split code/PIN entry renders as several adjacent single-character inputs
  // (OTP/2FA). A lone maxlength=1 field (e.g. a middle initial) is NOT that, so
  // only treat it as sensitive when it sits in a group of such boxes.
  static _looksLikeSplitCode(el) {
    if (!el || el.maxLength !== 1) return false;
    const scope = el.form || (el.closest && el.closest("form")) || document;
    const inputs = scope.querySelectorAll
      ? scope.querySelectorAll("input")
      : [];
    let single = 0;
    for (const i of inputs) if (i.maxLength === 1 && ++single >= 3) return true;
    return false;
  }

  static isSensitive(field) {
    const auto = (field.attr("autocomplete") || "").toLowerCase().trim();
    if (SensitivePolicy.AUTOCOMPLETE.has(auto)) return true;
    if (field.type === "password") return true;
    if (SensitivePolicy._looksLikeSplitCode(field.el)) return true;
    const haystack = [
      field.name,
      field.id,
      field.placeholder,
      field.label(),
      field.attr("aria-label"),
    ]
      .filter(Boolean)
      .join(" ");
    return SensitivePolicy.isSensitiveText(haystack);
  }
};

// Maps a field to a canonical concept so the same meaning correlates across
// forms even when names differ (fld_01, user, login → "username"). Order:
// learned index (taught by the AI) → autocomplete token → label/text heuristics.
AIFF.ConceptResolver = class ConceptResolver {
  static AUTOCOMPLETE = {
    name: "full_name",
    "given-name": "first_name",
    "additional-name": "middle_name",
    "family-name": "last_name",
    email: "email",
    username: "username",
    tel: "phone",
    "tel-national": "phone",
    organization: "organization",
    "organization-title": "job_title",
    "street-address": "address_line1",
    "address-line1": "address_line1",
    "address-line2": "address_line2",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "postal_code",
    country: "country",
    "country-name": "country",
    bday: "dob",
    url: "website",
  };
  static PATTERNS = [
    [/\b(user ?name|user ?id|login)\b/, "username"],
    [/\b(e ?mail)\b/, "email"],
    [/\b(first|given) name\b/, "first_name"],
    [/\b((last|family) name|surname)\b/, "last_name"],
    [/\b(full name|your name)\b/, "full_name"],
    [/\b(phone|telephone|mobile|cell)\b/, "phone"],
    [/\b(company|employer|organi[sz]ation)\b/, "organization"],
    [/\b(job ?title|position|role)\b/, "job_title"],
    [/\b((zip|postal) ?code|postcode)\b/, "postal_code"],
    [/\b(city|town)\b/, "city"],
    [/\b(state|province|region)\b/, "state"],
    [/\bcountry\b/, "country"],
    [/\b(street|address)\b/, "address_line1"],
    [/\blinkedin\b/, "linkedin"],
    [/\bgithub\b/, "github"],
    [/\b(website|portfolio|personal site)\b/, "website"],
    [/\b(date of birth|birth ?date|dob)\b/, "dob"],
  ];

  static fromAutocomplete(token) {
    if (!token) return null;
    const last = String(token).toLowerCase().trim().split(/\s+/).pop();
    return ConceptResolver.AUTOCOMPLETE[last] || null;
  }
  static fromText(text) {
    const t = (text || "").toLowerCase();
    for (const [re, concept] of ConceptResolver.PATTERNS)
      if (re.test(t)) return concept;
    return null;
  }
  static resolve(info, fieldMap) {
    if (info.fingerprint && fieldMap && fieldMap[info.fingerprint])
      return fieldMap[info.fingerprint];
    const a = ConceptResolver.fromAutocomplete(info.autocomplete);
    if (a) return a;
    const text = AIFF.Text.normalize(
      [info.label, info.placeholder, info.key].filter(Boolean).join(" "),
    ).replace(/_/g, " ");
    return ConceptResolver.fromText(text);
  }

  // The single source of truth for the storage key a field's value lives under:
  // its canonical concept when known, else its raw signature. Every read and
  // write path (capture, AI learning, import, chip lookup) must use this so the
  // same logical field always resolves to the same key.
  static keyFor(info, fieldMap) {
    return ConceptResolver.resolve(info, fieldMap) || info.key || "";
  }
};

AIFF.MemoryStore = class MemoryStore extends AIFF.Store {
  constructor() {
    super(AIFF.KEYS.MEMORY);
    // Serializes read-modify-write so overlapping remember() calls don't clobber.
    this._writeChain = Promise.resolve();
  }
  async get() {
    return (await this.getRaw()) || {};
  }
  async set(memory) {
    return this.setRaw(memory);
  }
  // All mutations run on one chain so overlapping writes never lose updates.
  _queue(fn) {
    this._writeChain = this._writeChain.then(fn).catch((e) => {
      console.warn("AIFF memory write failed", e);
    });
    return this._writeChain;
  }
  remember(entries, domain) {
    return this._queue(() => this._remember(entries, domain));
  }
  async _remember(entries, domain) {
    const clean = entries.filter(([, value]) => value);
    if (!clean.length) return;
    const memory = await this.get();
    for (const [key, value] of clean) {
      const prev = memory[key];
      memory[key] = {
        value,
        lastUsed: Date.now(),
        count: (prev?.count || 0) + 1,
        domain: domain || prev?.domain || "",
      };
    }
    await this.set(memory);
  }
  // Replace the whole store (options "Save"); chained so it can't race a capture.
  replace(memory) {
    return this._queue(() => this.set(memory || {}));
  }
  // Merge alias keys into canonical ones: pairs of [aliasKey, canonicalKey].
  // The fresher value wins; usage counts add up so ranking survives the merge.
  merge(pairs) {
    return this._queue(async () => {
      const memory = await this.get();
      let merged = 0;
      for (const [alias, canon] of pairs || []) {
        const a = memory[alias];
        if (!a || !canon || alias === canon) continue;
        const c = memory[canon];
        const winner = c && (c.lastUsed || 0) >= (a.lastUsed || 0) ? c : a;
        memory[canon] = {
          ...winner,
          count: ((c && c.count) || 0) + (a.count || 0),
        };
        delete memory[alias];
        merged++;
      }
      if (merged) await this.set(memory);
    });
  }

  removeKey(key) {
    return this._queue(async () => {
      const memory = await this.get();
      if (key in memory) {
        delete memory[key];
        await this.set(memory);
      }
    });
  }
  clear() {
    return this._queue(() => this.set({}));
  }
};
