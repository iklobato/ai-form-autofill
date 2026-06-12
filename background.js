// Orchestrates autofill/suggest and routes messages. Depends on injected
// abstractions (stores, provider registry, prompt builder), not concretes.

importScripts("shared.js", "providers.js");

var AIFF = (self.AIFF = self.AIFF || {});

AIFF.JsonExtractor = class JsonExtractor {
  static parse(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf("{");
    if (start === -1) return {};
    // Fast path: whole span from first { to last }.
    const lastEnd = raw.lastIndexOf("}");
    if (lastEnd > start) {
      try {
        return JSON.parse(raw.slice(start, lastEnd + 1));
      } catch {
        // fall through to brace matching
      }
    }
    // First balanced object, ignoring braces inside strings.
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return {};
        }
      }
    }
    return {};
  }
};

AIFF.PromptBuilder = class PromptBuilder {
  static SYSTEM_AUTOFILL =
    "You help a user fill web forms quickly and accurately. You are given the " +
    "form's fields, plus the user's knowledge base and values they entered " +
    "before. Return ONLY a JSON object with two maps keyed by each field's " +
    '"key": "values" (the string to enter; choose select values from the given ' +
    'options; "" when unknown) and "concepts" (a short canonical name for what ' +
    'the field means, regardless of its name — e.g. "email", "username", ' +
    '"first_name", "phone", "city"). Never invent personal data (emails, names, ' +
    "phone numbers, addresses, IDs) not present in the knowledge base or values. " +
    "Open-ended questions (cover letters, “describe your experience”, " +
    "“why are you a good fit”, pitches) get a complete, specific answer " +
    "composed from the knowledge base and previous values: use the user's real " +
    "projects, employers, metrics and links (include links when the question " +
    "asks for them), write in the voice the question implies (first person " +
    "unless it asks for a third-person pitch or bio), and respect any requested " +
    "length or structure. Answer questions about plans or availability (time " +
    'off, notice period, start date) only from the knowledge base; use "" if ' +
    "it doesn't say. When page content is provided (e.g. a job posting), " +
    'tailor open-ended answers to it. For "radio_group", "checkbox_group" ' +
    "and select fields choose from the given options verbatim; a single " +
    '"checkbox" takes "yes" or "no". Also return a third map "questions": for ' +
    'fields you must leave "" because the knowledge base lacks the answer, a ' +
    "short, plain question to ask the user for exactly that missing fact (omit " +
    "fields you filled). Every field you ask about MUST also appear in " +
    '"concepts" with a canonical name (e.g. "start_date", "desired_salary", ' +
    '"github"), so the user\'s answer can be saved to their knowledge base and ' +
    "reused on later forms.";

  static SYSTEM_SUGGEST =
    "You suggest a single value for one web form field, based on the user's " +
    "knowledge base and previously entered values. Reply with just the value, " +
    "as plain text with no quotes and no explanation. For an open-ended " +
    "question (textarea, essay prompt), the value is a complete answer composed " +
    "from the knowledge base — the user's real projects, employers, metrics and " +
    "links, in the voice the question implies (first person unless it asks for " +
    "third person); never invent facts it doesn't contain.";

  static SYSTEM_CORRECT =
    "You fix web-form fields whose values failed the form's validation. Each " +
    "field includes the 'currentValue' that was tried and a 'problem' describing " +
    "why it was rejected, plus its type and constraints. Return ONLY a JSON " +
    'object mapping each field "key" to a corrected value that satisfies its ' +
    'constraints, using the user\'s real data. Use "" if you cannot.';

  static SYSTEM_REVIEW =
    "You review a web form that was just auto-filled. Each field describes " +
    "what it asks for (label, question, context, options) and the " +
    "'currentValue' that was entered. Check that every value actually answers " +
    "what its field asks and that the answers are consistent with each other " +
    "and with the user's knowledge base. Return ONLY a JSON object mapping the " +
    "keys of fields that need a different value to the corrected value, drawn " +
    "from the user's real data; omit fields that are already correct. Never " +
    "invent personal data.";

  static SYSTEM_PICK_OPTION =
    "You match a desired value to one of a form field's allowed options. " +
    "Reply with exactly one option from the list, written exactly as given, " +
    "or an empty reply if none reasonably matches. No quotes, no explanation.";

  static SYSTEM_CONSOLIDATE =
    "You normalize a personal autofill memory: a list of stored field keys " +
    "with value previews. Identify keys that mean the same concept (aliases " +
    "like e_mail / email_address / your_email) and return ONLY a JSON object " +
    "mapping each redundant key to the canonical key it should merge into " +
    "(snake_case; prefer an existing key with the clearest, most standard " +
    "name). Omit keys that are unique. Never map keys with different meanings " +
    "together.";

  static SYSTEM_ENRICH =
    "You extract a person's details from a web page (résumé, portfolio, public " +
    "profile) to pre-fill web forms. Return a JSON object mapping form-field " +
    "names to the person's values. Maximize coverage so later forms have many " +
    "ready values:\n" +
    "- Use canonical field names (email, first_name, last_name, phone, city, " +
    "state, postal_code, country, linkedin, github, website, current_title, " +
    "current_company, years_of_experience, skills, …).\n" +
    "- Also add common ALIAS labels for the same value (e.g. e-mail, " +
    "email_address, given_name, surname, mobile, telephone, full_name, " +
    "organization).\n" +
    "- Break composite values into parts (full name → first/last; address → " +
    "line1/city/state/postal_code/country; phone → country_code/national).\n" +
    "Aim for at least 50 field/value pairs. Coverage must come from aliases and " +
    "components of REAL data on the page — never invent emails, phone numbers, " +
    "addresses, or IDs that aren't there. Omit a field rather than guessing.";

  buildEnrich(pageText) {
    const user =
      "Build the field/value object for this person. Return at least 50 entries " +
      "as a flat JSON object of fieldName -> value, using only values supported " +
      "by the page (aliases and components are encouraged; fabrication is not)." +
      `\n\nPage content:\n${pageText}`;
    return { system: PromptBuilder.SYSTEM_ENRICH, user };
  }

  buildAutofill(cfg, memory, fields, page) {
    const system =
      PromptBuilder.SYSTEM_AUTOFILL +
      (cfg.prompt ? `\n\nUser guidance:\n${cfg.prompt}` : "");
    const user =
      this._pageText(page) +
      this._fieldsText(cfg.knowledge, memory, fields) +
      "\n\nFor each field, infer what it asks for from its label, question, " +
      "help text, context and type (even when its key is meaningless). Return " +
      '{ "values": {key->value}, "concepts": {key->canonical concept}, ' +
      '"questions": {key->question for the user, only for fields you could ' +
      "not fill} }.";
    return { system, user };
  }

  buildSuggest(cfg, memory, field, page) {
    const system =
      PromptBuilder.SYSTEM_SUGGEST + (cfg.prompt ? `\n\n${cfg.prompt}` : "");
    const user =
      this._pageText(page) +
      this._fieldsText(cfg.knowledge, memory, [field]) +
      "\n\nReturn ONLY the value for this single field as plain text.";
    return { system, user };
  }

  buildReview(cfg, memory, fields) {
    const system =
      PromptBuilder.SYSTEM_REVIEW +
      (cfg.prompt ? `\n\nUser guidance:\n${cfg.prompt}` : "");
    const user =
      this._fieldsText(cfg.knowledge, memory, fields) +
      "\n\nEach field's 'currentValue' is what was entered. Return ONLY the " +
      "corrections object — an empty object if everything is correct.";
    return { system, user };
  }

  buildPickOption(field, value) {
    const user =
      `Field:\n${JSON.stringify(field, null, 2)}\n\n` +
      `Desired value: ${value}\n\n` +
      "Reply with the single best option, verbatim.";
    return { system: PromptBuilder.SYSTEM_PICK_OPTION, user };
  }

  buildConsolidate(memory) {
    const lines = Object.entries(memory)
      .map(([k, v]) => `${k}: ${String((v && v.value) || "").slice(0, 60)}`)
      .join("\n");
    const user =
      `Stored keys and value previews:\n${lines}\n\n` +
      "Return ONLY the { redundantKey: canonicalKey } object.";
    return { system: PromptBuilder.SYSTEM_CONSOLIDATE, user };
  }

  // The page the form lives on, so answers can be tailored to it (capped
  // content-side by PageContext; capped again here defensively).
  _pageText(page) {
    if (!page) return "";
    const parts = [
      page.url ? `URL: ${page.url}` : "",
      page.title ? `Title: ${page.title}` : "",
      page.headings && page.headings.length
        ? `Headings: ${page.headings.join(" | ")}`
        : "",
      page.text
        ? `Visible text (trimmed):\n${String(page.text).slice(0, 6000)}`
        : "",
    ].filter(Boolean);
    return parts.length ? `Page being filled:\n${parts.join("\n")}\n\n` : "";
  }

  buildCorrect(cfg, memory, fields) {
    const system =
      PromptBuilder.SYSTEM_CORRECT +
      (cfg.prompt ? `\n\nUser guidance:\n${cfg.prompt}` : "");
    const user =
      this._fieldsText(cfg.knowledge, memory, fields) +
      "\n\nEach field includes a 'problem' explaining why its 'currentValue' " +
      "was rejected. Return a JSON object mapping each key to a corrected value " +
      "that satisfies the field's constraints (pattern, type, options, maxLength).";
    return { system, user };
  }

  _fieldsText(knowledge, memory, fields) {
    const known = Object.entries(memory)
      .filter(([, v]) => v && v.value)
      .slice(0, 50)
      .map(([k, v]) => `${k}: ${v.value}`)
      .join("\n");
    return [
      knowledge ? `Knowledge base about the user:\n${knowledge}` : "",
      known ? `Previously entered values (key: value):\n${known}` : "",
      `Fields:\n${JSON.stringify(fields, null, 2)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
};

AIFF.AutofillService = class AutofillService {
  // Output shape for autofill: a value, a canonical concept, and (when a field
  // couldn't be filled) a question for the user — all keyed by field key.
  static SCHEMA = {
    type: "object",
    properties: {
      values: { type: "object", additionalProperties: { type: "string" } },
      concepts: { type: "object", additionalProperties: { type: "string" } },
      questions: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["values"],
  };

  // Essay-style fields need a bigger output budget than the per-field default,
  // or a form with several paragraph answers truncates mid-JSON. 8192 fits
  // every supported provider's output ceiling.
  static LONG_FORM_MAX_TOKENS = 8192;

  static _isLongForm(f) {
    return (
      f.type === "textarea" || f.type === "richtext" || (f.maxLength || 0) > 250
    );
  }

  constructor({ settings, memory, fieldMap, blocks, registry, prompts }) {
    this.settings = settings;
    this.memory = memory;
    this.fieldMap = fieldMap;
    this.blocks = blocks;
    this.registry = registry;
    this.prompts = prompts;
  }

  _provider(cfg) {
    if (!cfg.hasKey)
      throw new Error(`No API key set for ${cfg.provider} (see options).`);
    return this.registry.get(cfg.provider);
  }

  // Request envelope: model defaults to the site's model; callers may route a
  // call to another model (e.g. the long-form one) per request.
  _request(cfg, { system, user, model, maxTokens }) {
    return {
      apiKey: cfg.apiKey,
      model: model || cfg.model,
      system,
      user,
      maxTokens,
    };
  }

  async _complete(cfg, opts) {
    return this._provider(cfg).complete(this._request(cfg, opts));
  }

  async _completeJson(cfg, opts, schema) {
    return this._provider(cfg).completeJson(this._request(cfg, opts), schema);
  }

  async autofill(domain, fields, page) {
    const settings = await this.settings.load();
    const memory = await this.memory.get();
    const map = await this.fieldMap.get();
    const blocked = (await this.blocks.get())[domain] || {};
    const values = {};
    const sources = {};
    const concepts = {};
    const questions = {};
    const unknown = [];

    for (const f of fields) {
      // Resolve the field's canonical concept and match memory by it (then by
      // the raw key for backward compatibility).
      f._concept = AIFF.ConceptResolver.resolve(f, map) || f.key;
      concepts[f.key] = f._concept;
      // The user disabled this fill on this site — never fill it.
      if (blocked[f._concept] || blocked[f.key]) continue;
      const remembered = memory[f._concept] || memory[f.key];
      if (remembered && remembered.value) {
        values[f.key] = remembered.value;
        sources[f.key] = "memory";
      } else {
        unknown.push(f);
      }
    }

    const cfg = settings.resolve(domain);
    const usedAI = cfg.hasKey && unknown.length > 0;
    if (usedAI) {
      const results = await Promise.all(
        this._batches(cfg, unknown).map((b) =>
          this._propose(cfg, b, memory, page),
        ),
      );
      for (const r of results) {
        for (const f of r.fields) {
          const q = r.questions[f.key];
          const v = r.values[f.key];
          if (v == null || v === "") {
            // Unfillable: surface the AI's question so the user can be asked,
            // and keep the AI's canonical concept so their answer is saved
            // under a reusable key (not the opaque field signature).
            if (q) questions[f.key] = String(q);
            const aiConcept =
              r.concepts[f.key] && AIFF.Text.normalize(r.concepts[f.key]);
            if (aiConcept) concepts[f.key] = aiConcept;
            continue;
          }
          values[f.key] = String(v);
          sources[f.key] = "ai";
          // Surface the AI's canonical concept so the content script can persist
          // the (possibly edited) value and teach the field-map index — but only
          // after the user confirms (see commit()). Proposing never writes.
          const concept =
            (r.concepts[f.key] && AIFF.Text.normalize(r.concepts[f.key])) ||
            f._concept;
          if (concept) concepts[f.key] = concept;
        }
      }
    }
    return { values, sources, concepts, questions, usedAI };
  }

  // Split one fill into per-model batches: when a long-form model is
  // configured, essay fields go to it (with the bigger budget) while short
  // fields stay on the default model — in parallel.
  _batches(cfg, unknown) {
    const long = unknown.filter(AutofillService._isLongForm);
    const short = unknown.filter((f) => !AutofillService._isLongForm(f));
    if (cfg.longFormModel === cfg.model || !long.length || !short.length) {
      return [
        {
          fields: unknown,
          model: long.length ? cfg.longFormModel : cfg.model,
          maxTokens: long.length
            ? AutofillService.LONG_FORM_MAX_TOKENS
            : undefined,
        },
      ];
    }
    return [
      { fields: short, model: cfg.model, maxTokens: undefined },
      {
        fields: long,
        model: cfg.longFormModel,
        maxTokens: AutofillService.LONG_FORM_MAX_TOKENS,
      },
    ];
  }

  async _propose(cfg, batch, memory, page) {
    const { system, user } = this.prompts.buildAutofill(
      cfg,
      memory,
      batch.fields,
      page,
    );
    const ai = await this._completeJson(
      cfg,
      { system, user, model: batch.model, maxTokens: batch.maxTokens },
      AutofillService.SCHEMA,
    );
    return {
      fields: batch.fields,
      values: ai.values || ai, // tolerate a flat map
      concepts: ai.concepts || {},
      questions: ai.questions || {},
    };
  }

  // Persist confirmed values. items: [{ info, value, source, concept }]. Called
  // after the user accepts the preview (or on auto-fill) — never at proposal
  // time — so Cancel, unchecking, and edits are all respected. The single writer
  // for memory/fieldMap, so concurrent tabs can't clobber each other.
  async commit(domain, items) {
    const map = await this.fieldMap.get();
    const entries = [];
    const index = [];
    for (const it of items || []) {
      const value = it.value == null ? "" : String(it.value).trim();
      if (!value) continue;
      const concept = it.concept || AIFF.ConceptResolver.keyFor(it.info, map);
      if (!concept) continue;
      entries.push([concept, value]);
      if (it.source === "ai" && it.info && it.info.fingerprint && it.concept)
        index.push([it.info.fingerprint, it.concept]);
    }
    if (index.length) this.fieldMap.learn(index);
    if (entries.length) await this.memory.remember(entries, domain);
    return { learned: entries.length };
  }

  // Persist plainly-keyed values (typed capture, import, ask-for-missing
  // answers). fields: [{ info, value }]. Keys via the same resolver as commit()
  // and autofill() so every path agrees on the storage key.
  async remember(domain, fields) {
    const map = await this.fieldMap.get();
    const entries = [];
    let fromBrowser = 0;
    for (const f of fields || []) {
      const value = f.value == null ? "" : String(f.value).trim();
      if (!value) continue;
      const key = AIFF.ConceptResolver.keyFor(f.info, map);
      if (!key) continue;
      entries.push([key, value]);
      if (f.fromBrowser) fromBrowser++;
    }
    if (entries.length) await this.memory.remember(entries, domain);
    return { remembered: entries.length, fromBrowser };
  }

  // What the inline suggestion chip needs for one field, resolved with the same
  // key as everything else, and whether a provider key exists — without ever
  // handing the API key to the content script.
  async lookup(domain, info) {
    const [settings, memory, map] = await Promise.all([
      this.settings.load(),
      this.memory.get(),
      this.fieldMap.get(),
    ]);
    const key = AIFF.ConceptResolver.keyFor(info, map);
    const hit = memory[key] || memory[info.key];
    return {
      memValue: hit && hit.value ? hit.value : "",
      hasKey: settings.resolve(domain).hasKey,
    };
  }

  async suggest(domain, field, page) {
    const settings = await this.settings.load();
    const memory = await this.memory.get();
    const cfg = settings.resolve(domain);
    const { system, user } = this.prompts.buildSuggest(
      cfg,
      memory,
      field,
      page,
    );
    const long = AutofillService._isLongForm(field);
    const value = await this._complete(cfg, {
      system,
      user,
      model: long ? cfg.longFormModel : cfg.model,
      maxTokens: long ? AutofillService.LONG_FORM_MAX_TOKENS : undefined,
    });
    return { value: value.trim() };
  }

  // One unmatched select/choice value: ask the AI for the closest allowed
  // option. The reply only counts when it is verbatim one of the options.
  async pickOption(domain, field, value) {
    const settings = await this.settings.load();
    const cfg = settings.resolve(domain);
    if (!cfg.hasKey) return { option: "" };
    const { system, user } = this.prompts.buildPickOption(field, value);
    const reply = (await this._complete(cfg, { system, user })).trim();
    const options = field.options || [];
    return { option: options.includes(reply) ? reply : "" };
  }

  // Semantic pass over AI-filled values: does each answer actually address its
  // field, and are the answers mutually consistent? Returns corrections only.
  async review(domain, fields) {
    const settings = await this.settings.load();
    const cfg = settings.resolve(domain);
    if (!cfg.hasKey || !fields.length) return { values: {} };
    const memory = await this.memory.get();
    const { system, user } = this.prompts.buildReview(cfg, memory, fields);
    const long = fields.some(AutofillService._isLongForm);
    const ai = await this._completeJson(cfg, {
      system,
      user,
      model: long ? cfg.longFormModel : cfg.model,
      maxTokens: long ? AutofillService.LONG_FORM_MAX_TOKENS : undefined,
    });
    const values = {};
    for (const f of fields) {
      const v = ai[f.key];
      if (v != null && v !== "") values[f.key] = String(v);
    }
    return { values };
  }

  // Verify-and-correct round: given fields that failed validation, ask the AI
  // for corrected values that satisfy their constraints. Fills the user disabled
  // on this site stay disabled here too (same check as autofill()).
  async correct(domain, fields) {
    const settings = await this.settings.load();
    const cfg = settings.resolve(domain);
    if (!cfg.hasKey || !fields.length) return { values: {} };
    const [memory, map, blocked] = await Promise.all([
      this.memory.get(),
      this.fieldMap.get(),
      this.blocks.get().then((b) => b[domain] || {}),
    ]);
    const allowed = fields.filter((f) => {
      const concept = AIFF.ConceptResolver.resolve(f, map) || f.key;
      return !blocked[concept] && !blocked[f.key];
    });
    if (!allowed.length) return { values: {} };
    const { system, user } = this.prompts.buildCorrect(cfg, memory, allowed);
    const ai = await this._completeJson(cfg, { system, user });
    const values = {};
    for (const f of allowed) {
      const v = ai[f.key];
      if (v != null && v !== "") values[f.key] = String(v);
    }
    return { values };
  }
};

// Fetches a page and asks the AI to extract a personal knowledge base from it.
AIFF.KnowledgeService = class KnowledgeService {
  constructor({ settings, registry, prompts, http }) {
    this.settings = settings;
    this.registry = registry;
    this.prompts = prompts;
    this.http = http;
  }

  static htmlToText(html) {
    // &amp; is decoded last, so "&amp;lt;" yields the literal "&lt;".
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  async extract(url) {
    const cfg = (await this.settings.load()).resolve("");
    if (!cfg.hasKey)
      throw new Error(`No API key set for ${cfg.provider} (see General).`);
    const text = KnowledgeService.htmlToText(
      await this.http.getText(url),
    ).slice(0, 12000);
    if (!text) throw new Error("Could not read any text from that page.");
    const { system, user } = this.prompts.buildEnrich(text);
    // Enrich asks for 50+ field/value pairs; give it more room than the
    // per-field autofill default so the JSON isn't truncated mid-object.
    const fields = await this.registry.get(cfg.provider).completeJson({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system,
      user,
      maxTokens: 4096,
    });
    // Keep only non-empty string values.
    const clean = {};
    for (const [k, v] of Object.entries(fields || {}))
      if (v != null && String(v).trim()) clean[k] = String(v).trim();
    return { fields: clean };
  }
};

// User-initiated memory hygiene: asks the AI which stored keys are aliases of
// the same concept and merges them, so the memory context stays full of
// distinct facts instead of duplicates.
AIFF.MemoryCurator = class MemoryCurator {
  constructor({ settings, memory, registry, prompts }) {
    this.settings = settings;
    this.memory = memory;
    this.registry = registry;
    this.prompts = prompts;
  }

  async consolidate() {
    const cfg = (await this.settings.load()).resolve("");
    if (!cfg.hasKey)
      throw new Error(`No API key set for ${cfg.provider} (see General).`);
    const memory = await this.memory.get();
    if (Object.keys(memory).length < 2) return { merged: 0 };
    const { system, user } = this.prompts.buildConsolidate(memory);
    const mapping = await this.registry.get(cfg.provider).completeJson({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system,
      user,
    });
    const merges = [];
    for (const [alias, canon] of Object.entries(mapping || {})) {
      if (typeof canon !== "string" || !canon || alias === canon) continue;
      if (!memory[alias]) continue;
      // Never let a merge route a value under a sensitive-looking key.
      if (AIFF.SensitivePolicy.isSensitiveKey(canon)) continue;
      merges.push([alias, canon]);
    }
    if (merges.length) await this.memory.merge(merges);
    return { merged: merges.length };
  }
};

// Registers/unregisters a persistent content script for sites the user has
// granted (so they auto-fill on load). Requires host permission, requested by
// the popup before calling register().
AIFF.SiteScriptManager = class SiteScriptManager {
  constructor(files) {
    this.files = files;
  }
  async _register(id, matches) {
    await this._unregister(id);
    await chrome.scripting.registerContentScripts([
      { id, matches, js: this.files, runAt: "document_idle" },
    ]);
    return { ok: true };
  }
  async _unregister(id) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch {
      // wasn't registered
    }
    return { ok: true };
  }
  register(host) {
    return this._register(`site-${host}`, [`*://${host}/*`]);
  }
  unregister(host) {
    return this._unregister(`site-${host}`);
  }
  // Passive capture on every page (opt-in "learn on all sites").
  setAll(on) {
    return on
      ? this._register("all-sites", ["*://*/*"])
      : this._unregister("all-sites");
  }
};

AIFF.MessageRouter = class MessageRouter {
  constructor(handlers) {
    this.handlers = handlers;
  }
  register() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const run = this.handlers[msg.action];
      if (!run) return;
      run(msg)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    });
  }
};

// Composition root.
const http = new AIFF.HttpClient();
const settings = new AIFF.SettingsStore();
const registry = new AIFF.ProviderRegistry(http);
const prompts = new AIFF.PromptBuilder();
const memory = new AIFF.MemoryStore();
const fieldMap = new AIFF.FieldMapStore();
const blocks = new AIFF.BlockStore();
const autofill = new AIFF.AutofillService({
  settings,
  memory,
  fieldMap,
  blocks,
  registry,
  prompts,
});
const knowledge = new AIFF.KnowledgeService({
  settings,
  registry,
  prompts,
  http,
});
const curator = new AIFF.MemoryCurator({ settings, memory, registry, prompts });
const siteScripts = new AIFF.SiteScriptManager(AIFF.CONTENT_SCRIPT_FILES);
new AIFF.MessageRouter({
  aiAutofill: (m) => autofill.autofill(m.domain, m.fields, m.page),
  aiSuggest: (m) => autofill.suggest(m.domain, m.field, m.page),
  aiCorrect: (m) => autofill.correct(m.domain, m.fields),
  aiReview: (m) => autofill.review(m.domain, m.fields),
  aiPickOption: (m) => autofill.pickOption(m.domain, m.field, m.value),
  consolidateMemory: () => curator.consolidate(),
  // The single writer for memory/fieldMap: content commits only after the user
  // confirms; capture/import/answers remember plainly-keyed values.
  commitLearn: (m) => autofill.commit(m.domain, m.items),
  rememberValues: (m) => autofill.remember(m.domain, m.fields),
  fieldLookup: (m) => autofill.lookup(m.domain, m.field),
  extractKnowledge: (m) => knowledge.extract(m.url),
  registerSite: (m) => siteScripts.register(m.host),
  unregisterSite: (m) => siteScripts.unregister(m.host),
  setLearnAllSites: (m) => siteScripts.setAll(m.on),
  blockFill: (m) => blocks.block(m.domain, m.key).then(() => ({ ok: true })),
  unblockFill: (m) =>
    blocks.unblock(m.domain, m.key).then(() => ({ ok: true })),
  // Options-page memory mutations routed through the same single writer.
  setMemory: (m) => memory.replace(m.memory).then(() => ({ ok: true })),
  removeMemory: (m) => memory.removeKey(m.key).then(() => ({ ok: true })),
  clearMemory: () => memory.clear().then(() => ({ ok: true })),
  // Pre-keyed entries (knowledge-base import already canonicalizes its keys).
  rememberKeyed: (m) =>
    memory.remember(m.entries, m.domain).then(() => ({ ok: true })),
}).register();
