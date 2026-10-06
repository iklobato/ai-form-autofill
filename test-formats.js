// Runs the real shared.js + formdom.js logic against ~60 field formats that
// mirror test-form.html, asserting isFillable / isSensitive / signature / describe.
// Node has no layout engine, so visibility is modeled explicitly per field.
const vm = require("vm");
const fs = require("fs");

// --- fake DOM ---------------------------------------------------------------
const labelForMap = {}; // id -> <label for> text
const byIdMap = {}; // id -> element with textContent (aria targets)
let allControls = [];

const document = {
  querySelector(sel) {
    const m = sel.match(/^label\[for="(.+)"\]$/);
    if (m) {
      const v = labelForMap[m[1]];
      if (v == null) return null;
      // Strings model plain-text labels; objects are element-like fakes
      // (e.g. a label wrapping a select) used as-is.
      return typeof v === "object" ? v : { textContent: v };
    }
    return null;
  },
  getElementById(id) {
    return byIdMap[id] || null;
  },
  querySelectorAll() {
    return allControls;
  },
};

function proto() {
  function P() {}
  Object.defineProperty(P.prototype, "value", {
    set(v) {
      this._v = v;
    },
    get() {
      return this._v;
    },
    configurable: true,
  });
  return P;
}

const storageData = {}; // functional chrome.storage.local stub
const ctx = {
  console,
  // background.js registers its message router and may register content
  // scripts at load; stub just enough of chrome for it to compose.
  chrome: {
    storage: {
      local: {
        get: async (key) => ({ [key]: storageData[key] }),
        set: async (obj) => {
          Object.assign(storageData, obj);
        },
      },
    },
    runtime: {
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    scripting: {},
  },
  importScripts: () => {}, // background.js imports files we load explicitly
  setTimeout,
  clearTimeout,
  CSS: { escape: (s) => s },
  document,
  Event: class Event {
    constructor(type) {
      this.type = type;
    }
  },
  HTMLInputElement: proto(),
  HTMLTextAreaElement: proto(),
};
ctx.self = ctx;
vm.createContext(ctx);
for (const f of ["shared.js", "formdom.js", "providers.js", "background.js"])
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
const FormField = ctx.AIFF.FormField;

// --- element factory --------------------------------------------------------
function makeEl(o = {}) {
  const attrs = o.attrs || {};
  const el = {
    tagName: o.tag || "INPUT",
    type: o.type || "text",
    name: o.name || "",
    id: o.id || "",
    placeholder: o.placeholder || "",
    value: o.value || "",
    disabled: !!o.disabled,
    readOnly: !!o.readOnly,
    required: !!o.required,
    maxLength: o.maxLength == null ? -1 : o.maxLength,
    options: o.options || undefined,
    getAttribute: (a) => (a in attrs ? attrs[a] : null),
    closest: (sel) => (o.closest ? o.closest(sel) : null),
    offsetParent: o.visible === false ? null : {},
    getClientRects: () => (o.visible === false ? [] : [{}]),
    matches: (sel) =>
      !!o.autofilled && (sel === ":autofill" || sel === ":-webkit-autofill"),
    dispatchEvent: () => true,
  };
  if (o.id && o.labelFor != null) labelForMap[o.id] = o.labelFor;
  return el;
}
function ariaTarget(id, text) {
  byIdMap[id] = { textContent: text };
}
function fieldset(legend) {
  return (sel) =>
    sel.includes("fieldset")
      ? { querySelector: () => ({ textContent: legend }) }
      : null;
}
function wrappingLabel(text) {
  return (sel) => (sel === "label" ? { textContent: text } : null);
}

// --- cases (mirror test-form.html) -----------------------------------------
ariaTarget("lb1", "Aria");
ariaTarget("lb2", "labelled by");
ariaTarget("help1", "Enter your full legal name");

const F = true; // fillable
const X = false; // not fillable
const cases = [
  // 1. text input types
  ["text", makeEl({ type: "text", name: "text_field" }), { fillable: F }],
  [
    "email",
    makeEl({ type: "email", name: "email_field" }),
    { fillable: F, sig: "email_field" },
  ],
  ["tel", makeEl({ type: "tel", name: "tel_field" }), { fillable: F }],
  ["url", makeEl({ type: "url", name: "url_field" }), { fillable: F }],
  ["search", makeEl({ type: "search", name: "search_field" }), { fillable: F }],
  ["number", makeEl({ type: "number", name: "number_field" }), { fillable: F }],
  ["date", makeEl({ type: "date", name: "date_field" }), { fillable: F }],
  [
    "datetime-local",
    makeEl({ type: "datetime-local", name: "dtl" }),
    { fillable: F },
  ],
  ["month", makeEl({ type: "month", name: "month_field" }), { fillable: F }],
  ["week", makeEl({ type: "week", name: "week_field" }), { fillable: F }],
  ["time", makeEl({ type: "time", name: "time_field" }), { fillable: F }],

  // 2. autocomplete tokens -> canonical signature
  [
    "ac name",
    makeEl({ attrs: { autocomplete: "name" } }),
    { fillable: F, sig: "name" },
  ],
  [
    "ac given-name",
    makeEl({ attrs: { autocomplete: "given-name" } }),
    { fillable: F, sig: "given_name" },
  ],
  [
    "ac family-name",
    makeEl({ attrs: { autocomplete: "family-name" } }),
    { fillable: F, sig: "family_name" },
  ],
  [
    "ac email",
    makeEl({ type: "email", attrs: { autocomplete: "email" } }),
    { fillable: F, sig: "email" },
  ],
  [
    "ac tel",
    makeEl({ type: "tel", attrs: { autocomplete: "tel" } }),
    { fillable: F, sig: "tel" },
  ],
  [
    "ac organization",
    makeEl({ attrs: { autocomplete: "organization" } }),
    { fillable: F, sig: "organization" },
  ],
  [
    "ac street-address",
    makeEl({ attrs: { autocomplete: "street-address" } }),
    { fillable: F, sig: "street_address" },
  ],
  [
    "ac address-line1",
    makeEl({ attrs: { autocomplete: "address-line1" } }),
    { fillable: F, sig: "address_line1" },
  ],
  [
    "ac address-line2",
    makeEl({ attrs: { autocomplete: "address-line2" } }),
    { fillable: F, sig: "address_line2" },
  ],
  [
    "ac postal-code",
    makeEl({ attrs: { autocomplete: "postal-code" } }),
    { fillable: F, sig: "postal_code" },
  ],
  [
    "ac country-name",
    makeEl({ attrs: { autocomplete: "country-name" } }),
    { fillable: F, sig: "country_name" },
  ],
  [
    "ac shipping line1",
    makeEl({ attrs: { autocomplete: "shipping address-line1" } }),
    { fillable: F, sig: "shipping_address_line1" },
  ],

  // 3. label association
  [
    "label[for]",
    makeEl({ id: "l-for", name: "label_for", labelFor: "Full name" }),
    { fillable: F, label: "Full name" },
  ],
  [
    "wrapping label",
    makeEl({ name: "wrapped", closest: wrappingLabel("Wrapped name") }),
    { fillable: F, label: "Wrapped name" },
  ],
  [
    "aria-label",
    makeEl({ name: "aria_label", attrs: { "aria-label": "Aria label name" } }),
    { fillable: F, label: "Aria label name" },
  ],
  [
    "aria-labelledby",
    makeEl({ name: "aria_lblby", attrs: { "aria-labelledby": "lb1 lb2" } }),
    { fillable: F, label: "Aria labelled by" },
  ],
  [
    "placeholder only",
    makeEl({ name: "ph_only", placeholder: "Placeholder only" }),
    { fillable: F },
  ],
  [
    "title only",
    makeEl({ name: "title_only", attrs: { title: "Title only" } }),
    { fillable: F, label: "Title only" },
  ],
  [
    "fieldset/legend",
    makeEl({
      id: "fs-city",
      name: "fs_city",
      labelFor: "City",
      closest: fieldset("Shipping address"),
    }),
    { fillable: F, context: "Shipping address" },
  ],
  [
    "aria-describedby",
    makeEl({
      id: "desc-field",
      name: "desc_field",
      labelFor: "With help text",
      attrs: { "aria-describedby": "help1" },
    }),
    { fillable: F, help: "Enter your full legal name" },
  ],

  // 4. opaque names -> keyed by label
  [
    "opaque question_*",
    makeEl({
      id: "question_12013476007",
      name: "question_12013476007",
      type: "url",
      labelFor: "LinkedIn Profile URL",
    }),
    { fillable: F, sig: "linkedin_profile_url" },
  ],
  [
    "guid id",
    makeEl({
      id: "a1b2c3d4-1111-2222-3333-444455556666",
      type: "tel",
      labelFor: "Phone Number",
    }),
    { fillable: F, sig: "phone_number" },
  ],
  [
    "camelCase name",
    makeEl({ id: "camel", name: "firstName", labelFor: "camelCase name" }),
    { fillable: F, sig: "firstname" },
  ],

  // 5. constraints (describe)
  [
    "required",
    makeEl({ name: "req_field", required: true }),
    { fillable: F, describe: { required: true } },
  ],
  [
    "maxlength",
    makeEl({ name: "max_field", maxLength: 10 }),
    { fillable: F, describe: { maxLength: 10 } },
  ],
  [
    "pattern",
    makeEl({ name: "pat_field", attrs: { pattern: "[0-9]{5}" } }),
    { fillable: F, describe: { pattern: "[0-9]{5}" } },
  ],

  // 6. textarea & selects
  ["textarea", makeEl({ tag: "TEXTAREA", name: "bio" }), { fillable: F }],
  [
    "select single",
    makeEl({
      tag: "SELECT",
      type: "select-one",
      name: "country",
      options: [
        { value: "", textContent: "—" },
        { value: "United States", textContent: "United States" },
      ],
    }),
    { fillable: F, describe: { options: ["United States"] } },
  ],
  [
    "select multiple",
    makeEl({
      tag: "SELECT",
      type: "select-multiple",
      name: "langs",
      options: [{ value: "English", textContent: "English" }],
    }),
    { fillable: F },
  ],
  [
    "select optgroups",
    makeEl({
      tag: "SELECT",
      type: "select-one",
      name: "role",
      options: [
        { value: "Backend", textContent: "Backend" },
        { value: "Product", textContent: "Product" },
      ],
    }),
    { fillable: F },
  ],

  // 7. non-fillable
  ["hidden", makeEl({ type: "hidden", name: "hidden_field" }), { fillable: X }],
  ["file", makeEl({ type: "file", name: "file_field" }), { fillable: X }],
  ["checkbox", makeEl({ type: "checkbox", name: "cb" }), { fillable: X }],
  ["radio", makeEl({ type: "radio", name: "rb" }), { fillable: X }],
  ["range", makeEl({ type: "range", name: "rng" }), { fillable: X }],
  ["color", makeEl({ type: "color", name: "col" }), { fillable: X }],
  [
    "disabled",
    makeEl({ name: "disabled_field", disabled: true }),
    { fillable: X },
  ],
  [
    "readonly",
    makeEl({ name: "readonly_field", readOnly: true }),
    { fillable: X },
  ],
  ["submit", makeEl({ type: "submit" }), { fillable: X }],
  ["button", makeEl({ type: "button" }), { fillable: X }],
  ["reset", makeEl({ type: "reset" }), { fillable: X }],
  ["image", makeEl({ type: "image" }), { fillable: X }],
  [
    "not visible",
    makeEl({ name: "hidden_css", visible: false }),
    { fillable: X },
  ],
  ["non-form element (div)", makeEl({ tag: "DIV" }), { fillable: X }],

  // 8. sensitive (fillable type but never captured)
  [
    "password",
    makeEl({ type: "password", name: "password" }),
    { fillable: X, sensitive: true },
  ],
  [
    "current-password",
    makeEl({ attrs: { autocomplete: "current-password" } }),
    { fillable: F, sensitive: true },
  ],
  [
    "cc-number",
    makeEl({ attrs: { autocomplete: "cc-number" } }),
    { fillable: F, sensitive: true },
  ],
  [
    "cc-csc",
    makeEl({ attrs: { autocomplete: "cc-csc" } }),
    { fillable: F, sensitive: true },
  ],
  ["cvv", makeEl({ name: "cvv" }), { fillable: F, sensitive: true }],
  ["ssn", makeEl({ name: "ssn" }), { fillable: F, sensitive: true }],
  [
    "one-time-code",
    makeEl({ attrs: { autocomplete: "one-time-code" } }),
    { fillable: F, sensitive: true },
  ],
  ["iban", makeEl({ name: "iban" }), { fillable: F, sensitive: true }],
  [
    "routing number",
    makeEl({ name: "routing_number" }),
    { fillable: F, sensitive: true },
  ],

  // non-sensitive controls (must NOT be flagged)
  [
    "email not sensitive",
    makeEl({ type: "email", name: "email_field" }),
    { fillable: F, sensitive: false },
  ],
  [
    "account (username) not sensitive",
    makeEl({ name: "account" }),
    { fillable: F, sensitive: false },
  ],
];

allControls = cases.map(([, el]) => el);

// --- run --------------------------------------------------------------------
let pass = 0,
  fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(`${name}: ${detail}`);
  }
}

for (const [name, el, exp] of cases) {
  const ff = new FormField(el);
  check(
    name + " fillable",
    ff.isFillable() === exp.fillable,
    `isFillable=${ff.isFillable()} want ${exp.fillable}`,
  );
  if (exp.sensitive !== undefined)
    check(
      name + " sensitive",
      ff.isSensitive() === exp.sensitive,
      `isSensitive=${ff.isSensitive()} want ${exp.sensitive}`,
    );
  if (exp.sig !== undefined)
    check(
      name + " signature",
      ff.signature() === exp.sig,
      `signature=${ff.signature()} want ${exp.sig}`,
    );
  if (exp.label !== undefined)
    check(
      name + " label",
      ff.label() === exp.label,
      `label=${ff.label()} want ${exp.label}`,
    );
  if (exp.context !== undefined)
    check(
      name + " context",
      ff.describe().context === exp.context,
      `context=${ff.describe().context}`,
    );
  if (exp.help !== undefined)
    check(
      name + " help",
      ff.describe().help === exp.help,
      `help=${ff.describe().help}`,
    );
  if (exp.describe)
    for (const [k, v] of Object.entries(exp.describe))
      check(
        `${name} describe.${k}`,
        JSON.stringify(ff.describe()[k]) === JSON.stringify(v),
        `describe.${k}=${JSON.stringify(ff.describe()[k])} want ${JSON.stringify(v)}`,
      );
}

// fill behavior on a few fillable formats
const fillEl = makeEl({ name: "text_field" });
check(
  "fill text input",
  new FormField(fillEl).fill("hello") === true && fillEl._v === "hello",
  `value=${fillEl._v}`,
);
const fillTa = makeEl({ tag: "TEXTAREA", name: "bio" });
check(
  "fill textarea",
  new FormField(fillTa).fill("bio text") === true && fillTa._v === "bio text",
  `value=${fillTa._v}`,
);
const sel = makeEl({
  tag: "SELECT",
  type: "select-one",
  name: "country",
  options: [
    { value: "us", textContent: "United States" },
    { value: "br", textContent: "Brazil" },
  ],
});
const selFf = new FormField(sel);
check(
  "fill select by text",
  selFf.fill("Brazil") === true && sel.value === "br",
  `value=${sel.value}`,
);

// --- keying consistency (keyFor) -------------------------------------------
// capture, import, and chip lookup all resolve a field's storage key through
// ConceptResolver.keyFor, so the same logical field always keys the same way.
const CR = ctx.AIFF.ConceptResolver;
function keyOf(o, map) {
  return CR.keyFor(new FormField(makeEl(o)).describe(), map || {});
}
// A field whose concept differs from its raw signature must key by the concept.
check(
  "keyFor given-name -> first_name",
  keyOf({ attrs: { autocomplete: "given-name" } }) === "first_name",
  keyOf({ attrs: { autocomplete: "given-name" } }),
);
check(
  "keyFor email -> email",
  keyOf({ type: "email", attrs: { autocomplete: "email" } }) === "email",
  keyOf({ type: "email", attrs: { autocomplete: "email" } }),
);
// Opaque field with no resolvable concept falls back to its signature.
const opaqueInfo = new FormField(makeEl({ name: "fld_xyz" })).describe();
check(
  "keyFor opaque -> signature",
  CR.keyFor(opaqueInfo, {}) === opaqueInfo.key && opaqueInfo.key === "fld_xyz",
  `${CR.keyFor(opaqueInfo, {})} vs ${opaqueInfo.key}`,
);
// The learned field-map index (taught by the AI) overrides heuristics.
const fpInfo = new FormField(
  makeEl({ attrs: { autocomplete: "given-name" } }),
).describe();
check(
  "keyFor honors learned map",
  CR.keyFor(fpInfo, { [fpInfo.fingerprint]: "taught_concept" }) ===
    "taught_concept",
  CR.keyFor(fpInfo, { [fpInfo.fingerprint]: "taught_concept" }),
);

// --- OTP split-code detection (#10) ----------------------------------------
// A lone maxlength=1 field (e.g. middle initial) is NOT sensitive; only a group
// of them (OTP/2FA split inputs) is.
function singleCharField(name, siblings) {
  const inputs = [];
  const form = { querySelectorAll: () => inputs };
  for (let i = 0; i < siblings; i++) {
    const e = makeEl({ name: "digit", maxLength: 1 });
    e.form = form;
    inputs.push(e);
  }
  const el = makeEl({ name, maxLength: 1 });
  el.form = form;
  inputs.push(el);
  return el;
}
check(
  "lone maxlength=1 not sensitive",
  new FormField(singleCharField("middle_initial", 0)).isSensitive() === false,
  "middle initial flagged sensitive",
);
check(
  "split-code group is sensitive",
  new FormField(singleCharField("digit", 3)).isSensitive() === true,
  "OTP split inputs not flagged",
);

// --- wrapping label strips nested controls (#11) ---------------------------
// A wrapped <select>'s option text must not leak into the field's label.
function labelWithSelect(text, optionText) {
  const makeClone = () => {
    let removed = false;
    return {
      querySelectorAll: () =>
        removed ? [] : [{ remove: () => (removed = true) }],
      get textContent() {
        return removed ? text : text + optionText;
      },
    };
  };
  return {
    cloneNode: () => makeClone(),
    querySelectorAll: () => [{}],
    textContent: text + optionText,
  };
}
const wrapLbl = labelWithSelect("Country ", "United StatesBrazil");
const wrappedEl = makeEl({
  name: "country2",
  closest: (sel) => (sel === "label" ? wrapLbl : null),
});
check(
  "wrapping label strips nested select",
  new FormField(wrappedEl).label() === "Country",
  new FormField(wrappedEl).label(),
);
// label[for] must strip nested controls the same way as a wrapping label.
labelForMap["country-for"] = labelWithSelect("Country ", "United StatesBrazil");
const labelForEl = makeEl({ id: "country-for", name: "country3" });
check(
  "label[for] strips nested select",
  new FormField(labelForEl).label() === "Country",
  new FormField(labelForEl).label(),
);

// --- provider maxTokens passthrough (#6) -----------------------------------
function recordingHttp() {
  const calls = [];
  return {
    calls,
    postJson(url, headers, body) {
      calls.push({ url, headers, body });
      return Promise.resolve({
        content: [{ type: "tool_use", input: { ok: "1" } }],
        choices: [{ message: { content: "{}" } }],
      });
    },
  };
}
async function providerChecks() {
  const httpA = recordingHttp();
  const a = new ctx.AIFF.AnthropicProvider(httpA);
  await a.complete({ apiKey: "k", model: "m", system: "s", user: "u" });
  check(
    "anthropic default max_tokens 2048",
    httpA.calls[0].body.max_tokens === 2048,
    `${httpA.calls[0].body.max_tokens}`,
  );
  await a.completeJson(
    { apiKey: "k", model: "m", system: "s", user: "u", maxTokens: 4096 },
    null,
  );
  check(
    "anthropic maxTokens passthrough",
    httpA.calls[1].body.max_tokens === 4096,
    `${httpA.calls[1].body.max_tokens}`,
  );

  const httpO = recordingHttp();
  const o = new ctx.AIFF.OpenAICompatibleProvider(httpO, "http://x");
  await o.complete({
    apiKey: "k",
    model: "m",
    system: "s",
    user: "u",
    maxTokens: 1234,
  });
  check(
    "openai maxTokens passthrough",
    httpO.calls[0].body.max_tokens === 1234,
    `${httpO.calls[0].body.max_tokens}`,
  );
  await o.complete({ apiKey: "k", model: "m", system: "s", user: "u" });
  check(
    "openai omits max_tokens when unset",
    !("max_tokens" in httpO.calls[1].body),
    "max_tokens present without maxTokens",
  );
}

// --- background.js: htmlToText entity decoding ------------------------------
const h2t = ctx.AIFF.KnowledgeService.htmlToText;
check(
  "htmlToText strips tags and scripts",
  h2t("<script>x()</script><p>Hi <b>there</b></p>") === "Hi there",
  h2t("<script>x()</script><p>Hi <b>there</b></p>"),
);
check(
  "htmlToText decodes entities",
  h2t("a &lt; b &amp; c&nbsp;&quot;d&quot;") === 'a < b & c "d"',
  h2t("a &lt; b &amp; c&nbsp;&quot;d&quot;"),
);
// &amp; decodes last: "&amp;lt;" is the literal text "&lt;", not "<".
check(
  "htmlToText does not double-decode &amp;lt;",
  h2t("a &amp;lt; b") === "a &lt; b",
  h2t("a &amp;lt; b"),
);

// --- background.js: JsonExtractor --------------------------------------------
const JE = ctx.AIFF.JsonExtractor;
check(
  "JsonExtractor parses fenced json",
  JE.parse('```json\n{"a":1}\n```').a === 1,
  JSON.stringify(JE.parse('```json\n{"a":1}\n```')),
);
check(
  "JsonExtractor parses prose-wrapped json",
  JE.parse('Sure! Here it is: {"a":"x"} hope that helps').a === "x",
  JSON.stringify(JE.parse('Sure! Here it is: {"a":"x"} hope that helps')),
);
check(
  "JsonExtractor handles braces inside strings",
  JE.parse('{"a":"}"} trailing }').a === "}",
  JSON.stringify(JE.parse('{"a":"}"} trailing }')),
);
check(
  "JsonExtractor returns {} on garbage",
  Object.keys(JE.parse("no json here")).length === 0,
  JSON.stringify(JE.parse("no json here")),
);

// --- shared.js: settings resolution ------------------------------------------
const settingsRaw = {
  defaultProvider: "anthropic",
  defaultModel: "claude-custom",
  providerKeys: { anthropic: "ka", openai: "ko" },
  sites: { "a.com": { provider: "openai" } },
};
const S = new ctx.AIFF.Settings(settingsRaw);
check(
  "default model applies to default provider",
  S.resolve("b.com").model === "claude-custom",
  S.resolve("b.com").model,
);
// A site switching provider must not inherit the other provider's model id.
check(
  "provider switch does not inherit default model",
  S.resolve("a.com").model === "gpt-4o-mini",
  S.resolve("a.com").model,
);
const pub = S.resolvePublic("a.com");
const full = S.resolve("a.com");
check(
  "resolvePublic mirrors resolve without the key",
  pub.provider === full.provider &&
    pub.model === full.model &&
    pub.autoFill === full.autoFill &&
    !("apiKey" in pub),
  JSON.stringify(pub),
);

// --- background.js: correct() honors the block list (#3) ---------------------
async function correctChecks() {
  const sent = [];
  const svc = new ctx.AIFF.AutofillService({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" } }),
    },
    memory: { get: async () => ({}) },
    fieldMap: { get: async () => ({}) },
    blocks: { get: async () => ({ "example.com": { email: true } }) },
    registry: {
      get: () => ({
        completeJson: async (req) => {
          sent.push(req);
          return { email: "x@y.z", city: "Lisbon" };
        },
      }),
    },
    prompts: new ctx.AIFF.PromptBuilder(),
  });
  const res = await svc.correct("example.com", [
    { key: "email", label: "Email" },
    { key: "city", label: "City" },
  ]);
  check(
    "correct() skips blocked fields",
    !("email" in res.values) && res.values.city === "Lisbon",
    JSON.stringify(res.values),
  );
  check(
    "correct() never sends blocked fields to the AI",
    sent.length === 1 && !sent[0].user.includes('"email"'),
    sent.length ? sent[0].user : "no AI call",
  );
  const allBlocked = await svc.correct("example.com", [
    { key: "email", label: "Email" },
  ]);
  check(
    "correct() skips the AI call when everything is blocked",
    sent.length === 1 && Object.keys(allBlocked.values).length === 0,
    JSON.stringify(allBlocked.values),
  );
}

// --- background.js: long-form fields raise the output budget -----------------
async function longFormChecks() {
  const sent = [];
  const svc = new ctx.AIFF.AutofillService({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" } }),
    },
    memory: { get: async () => ({}) },
    fieldMap: { get: async () => ({}) },
    blocks: { get: async () => ({}) },
    registry: {
      get: () => ({
        completeJson: async (req) => {
          sent.push(req);
          return { values: {}, concepts: {} };
        },
        complete: async (req) => {
          sent.push(req);
          return "ok";
        },
      }),
    },
    prompts: new ctx.AIFF.PromptBuilder(),
  });
  await svc.autofill("example.com", [
    {
      key: "best_candidate",
      label: "Why are you the best candidate?",
      type: "textarea",
    },
    { key: "email", label: "Email", type: "email" },
  ]);
  check(
    "autofill raises token budget when a textarea is present",
    sent[0].maxTokens === ctx.AIFF.AutofillService.LONG_FORM_MAX_TOKENS,
    `${sent[0].maxTokens}`,
  );
  await svc.autofill("example.com", [
    { key: "city_name", label: "Which city do you live in?", type: "text" },
  ]);
  check(
    "autofill keeps the default budget for short fields",
    sent[1].maxTokens === undefined,
    `${sent[1].maxTokens}`,
  );
  await svc.suggest("example.com", {
    key: "pitch",
    label: "Write your third-person pitch here",
    type: "textarea",
  });
  check(
    "suggest raises token budget for a long-form field",
    sent[2].maxTokens === ctx.AIFF.AutofillService.LONG_FORM_MAX_TOKENS,
    `${sent[2].maxTokens}`,
  );
  await svc.autofill("example.com", [
    { key: "summary", label: "Summary", type: "text", maxLength: 1000 },
  ]);
  check(
    "autofill treats a large-maxLength input as long-form",
    sent[3].maxTokens === ctx.AIFF.AutofillService.LONG_FORM_MAX_TOKENS,
    `${sent[3].maxTokens}`,
  );
}

// --- choice groups (radio / checkbox) ----------------------------------------
function makeChoice(o) {
  const el = makeEl(o);
  el.checked = !!o.checked;
  el.click = () => {
    el.checked = el.type === "checkbox" ? !el.checked : true;
  };
  return el;
}
function radio(name, value, labelText, extra = {}) {
  const el = makeChoice({
    type: "radio",
    name,
    value,
    id: `r_${name}_${value}`,
    ...extra,
  });
  labelForMap[el.id] = labelText;
  return el;
}
const CG = ctx.AIFF.ChoiceGroupField;
const authRadios = [
  radio("work_auth", "yes", "Yes", { closest: fieldset("Work authorization") }),
  radio("work_auth", "no", "No"),
];
const authGroup = new CG(authRadios);
check("radio group type", authGroup.type === "radio_group", authGroup.type);
check(
  "radio group label from legend",
  authGroup.label() === "Work authorization",
  authGroup.label(),
);
check(
  "radio group options",
  JSON.stringify(authGroup.describe().options) === '["Yes","No"]',
  JSON.stringify(authGroup.describe().options),
);
check(
  "radio group fill by option label",
  authGroup.fill("Yes") === true && authRadios[0].checked,
  `checked=${authRadios[0].checked}`,
);
check(
  "radio group value reads selection",
  authGroup.value === "Yes",
  authGroup.value,
);
check(
  "radio group rejects unknown option",
  authGroup.fill("Maybe") === false,
  "filled an option that does not exist",
);
check(
  "radio group signature from name",
  authGroup.signature() === "work_auth",
  authGroup.signature(),
);

const newsletter = new CG([
  makeChoice({
    type: "checkbox",
    name: "subscribe",
    closest: wrappingLabel("Subscribe to newsletter"),
  }),
]);
check("single checkbox type", newsletter.type === "checkbox", newsletter.type);
check(
  "single checkbox label is its own",
  newsletter.label() === "Subscribe to newsletter",
  newsletter.label(),
);
check(
  "single checkbox describe offers yes/no",
  JSON.stringify(newsletter.describe().options) === '["yes","no"]',
  JSON.stringify(newsletter.describe().options),
);
check(
  "single checkbox fill yes",
  newsletter.fill("Yes") === true && newsletter.els[0].checked === true,
  `checked=${newsletter.els[0].checked}`,
);
check(
  "single checkbox fill no unchecks",
  newsletter.fill("no") === true && newsletter.els[0].checked === false,
  `checked=${newsletter.els[0].checked}`,
);

const langEls = [
  radio("langs", "en", "English"),
  radio("langs", "es", "Spanish"),
  radio("langs", "de", "German"),
].map((el) => ((el.type = "checkbox"), el));
const langGroup = new CG(langEls);
check(
  "checkbox group type",
  langGroup.type === "checkbox_group",
  langGroup.type,
);
check(
  "checkbox group fills several options",
  langGroup.fill("English, Spanish") === true &&
    langEls[0].checked &&
    langEls[1].checked &&
    !langEls[2].checked,
  langGroup.value,
);

// EEO-style sensitive policy still applies to groups via the shared policy.
check(
  "choice group is not sensitive by default",
  authGroup.isSensitive() === false,
  "work_auth flagged sensitive",
);

// --- rich text (contenteditable) ----------------------------------------------
function makeEditor(o = {}) {
  const attrs = { contenteditable: "true", ...(o.attrs || {}) };
  return {
    tagName: "DIV",
    id: o.id || "",
    textContent: o.text || "",
    getAttribute: (a) => (a in attrs ? attrs[a] : null),
    closest: () => null,
    offsetParent: o.visible === false ? null : {},
    getClientRects: () => (o.visible === false ? [] : [{}]),
    dispatchEvent: () => true,
  };
}
const editor = new ctx.AIFF.RichTextField(
  makeEditor({ attrs: { "aria-label": "Cover letter" } }),
);
check("richtext fillable", editor.isFillable() === true, "not fillable");
check("richtext label", editor.label() === "Cover letter", editor.label());
check(
  "richtext describe type",
  editor.describe().type === "richtext",
  editor.describe().type,
);
check(
  "richtext fill",
  editor.fill("Dear team…") === true && editor.value === "Dear team…",
  editor.value,
);
check(
  "richtext counts as long-form",
  ctx.AIFF.FieldInfo.isLongForm(editor.describe()) === true,
  "richtext not long-form",
);

// --- scanner: grouping, editors, own-UI exclusion ------------------------------
function fakeRoot(controls, editors = []) {
  return {
    querySelectorAll: (sel) =>
      sel.includes("contenteditable") ? editors : controls,
  };
}
const scanRadios = [radio("color", "r", "Red"), radio("color", "g", "Green")];
const scanEmail = makeEl({ type: "email", name: "email_field" });
const ownUiInput = makeEl({
  name: "panel_input",
  closest: (sel) => (sel === "[data-aiff-ui]" ? {} : null),
});
const scanned = new ctx.AIFF.FormScanner(
  fakeRoot([...scanRadios, scanEmail, ownUiInput], [makeEditor()]),
).fields();
check(
  "scanner groups radios + keeps text + editor",
  scanned.length === 3 &&
    scanned.some((f) => f.type === "radio_group") &&
    scanned.some((f) => f.type === "richtext"),
  scanned.map((f) => f.type).join(","),
);
check(
  "scanner skips the extension's own UI",
  !scanned.some((f) => f.name === "panel_input"),
  "panel input scanned as a field",
);

// --- field context: question text + nearest heading ---------------------------
const questionDiv = {
  previousElementSibling: null,
  textContent: "  Why do you want to work here?  ",
  querySelector: () => null,
  matches: () => false,
};
const ctxEl = makeEl({ name: "q1", type: "textarea", tag: "TEXTAREA" });
ctxEl.previousElementSibling = questionDiv;
check(
  "describe picks up the question block above the field",
  new FormField(ctxEl).describe().question === "Why do you want to work here?",
  new FormField(ctxEl).describe().question,
);
const headingSib = {
  previousElementSibling: null,
  textContent: "Application form",
  matches: (sel) => sel.includes("h1"),
  querySelector: () => null,
};
const ctxEl2 = makeEl({ name: "q2" });
ctxEl2.previousElementSibling = headingSib;
check(
  "describe falls back to the nearest heading as context",
  new FormField(ctxEl2).describe().context === "Application form",
  new FormField(ctxEl2).describe().context,
);
const fieldBefore = {
  previousElementSibling: null,
  textContent: "Other question text long enough",
  querySelector: (sel) => (sel.includes("input") ? {} : null),
  matches: () => false,
};
const ctxEl3 = makeEl({ name: "q3" });
ctxEl3.previousElementSibling = fieldBefore;
check(
  "question search stops at the previous field",
  new FormField(ctxEl3).describe().question === undefined,
  new FormField(ctxEl3).describe().question,
);

// --- prompts include the page context ------------------------------------------
const pagePrompt = new ctx.AIFF.PromptBuilder().buildAutofill(
  { prompt: "", knowledge: "" },
  {},
  [{ key: "pitch", type: "textarea" }],
  {
    url: "https://x.test/jobs/1",
    title: "Senior Search Engineer",
    headings: ["About the role"],
    text: "We build semantic search at scale.",
  },
);
check(
  "autofill prompt carries the page being filled",
  pagePrompt.user.includes("URL: https://x.test/jobs/1") &&
    pagePrompt.user.includes("Senior Search Engineer") &&
    pagePrompt.user.includes("We build semantic search at scale."),
  pagePrompt.user.slice(0, 200),
);

// --- settings: long-form model resolution ---------------------------------------
const SL = new ctx.AIFF.Settings({
  defaultProvider: "anthropic",
  longFormModel: "claude-opus-4-8",
  sites: { "a.com": { provider: "openai" } },
});
check(
  "long-form model resolves globally",
  SL.resolve("x.com").longFormModel === "claude-opus-4-8",
  SL.resolve("x.com").longFormModel,
);
check(
  "long-form model defaults to the site model",
  new ctx.AIFF.Settings({}).resolve("").longFormModel ===
    new ctx.AIFF.Settings({}).resolve("").model,
  new ctx.AIFF.Settings({}).resolve("").longFormModel,
);
check(
  "provider switch does not inherit the long-form model",
  SL.resolve("a.com").longFormModel === SL.resolve("a.com").model,
  SL.resolve("a.com").longFormModel,
);

// --- service-level checks (routing, questions, pick, review, curator, merge) ----
function stubService(registry, raw) {
  return new ctx.AIFF.AutofillService({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" }, ...raw }),
    },
    memory: { get: async () => ({}) },
    fieldMap: { get: async () => ({}) },
    blocks: { get: async () => ({}) },
    registry,
    prompts: new ctx.AIFF.PromptBuilder(),
  });
}

async function advancedChecks() {
  // Model routing: essays go to the long-form model, short fields stay put.
  const sent = [];
  const recorder = {
    get: () => ({
      completeJson: async (req) => {
        sent.push(req);
        return { values: {}, concepts: {}, questions: {} };
      },
      complete: async (req) => {
        sent.push(req);
        return "United States";
      },
    }),
  };
  const routed = stubService(recorder, { longFormModel: "claude-opus-4-8" });
  await routed.autofill("d.com", [
    { key: "pitch", label: "Your pitch", type: "textarea" },
    { key: "nickname", label: "Nickname", type: "text" },
  ]);
  check(
    "routing: short fields use the default model",
    sent[0].model === "claude-sonnet-4-6" && sent[0].maxTokens === undefined,
    `${sent[0].model}/${sent[0].maxTokens}`,
  );
  check(
    "routing: long-form fields use the long-form model + budget",
    sent[1].model === "claude-opus-4-8" && sent[1].maxTokens === 8192,
    `${sent[1].model}/${sent[1].maxTokens}`,
  );

  // Questions: surfaced only for fields the AI left empty.
  const asker = stubService({
    get: () => ({
      completeJson: async () => ({
        values: { nickname: "Ike" },
        concepts: {},
        questions: { start_date: "When can you start?", nickname: "ignored" },
      }),
    }),
  });
  const asked = await asker.autofill("d.com", [
    { key: "start_date", label: "Start date", type: "text" },
    { key: "nickname", label: "Nickname", type: "text" },
  ]);
  check(
    "AI questions surface for unfilled fields only",
    asked.questions.start_date === "When can you start?" &&
      asked.questions.nickname === undefined,
    JSON.stringify(asked.questions),
  );

  // pickOptions: every unmatched field in one call, verbatim replies only.
  let pickCalls = 0;
  const picker = stubService({
    get: () => ({
      completeJson: async () => {
        pickCalls++;
        return { country: "United States", size: "Huge" };
      },
    }),
  });
  const countryField = {
    key: "country",
    options: ["United States", "Brazil"],
  };
  const sizeField = { key: "size", options: ["Small", "Large"] };
  const picked = await picker.pickOptions("d.com", [
    { field: countryField, value: "USA" },
    { field: sizeField, value: "big" },
  ]);
  check(
    "pickOptions uses one call for several fields",
    pickCalls === 1,
    `${pickCalls}`,
  );
  check(
    "pickOptions accepts a verbatim option",
    picked.options.country === "United States",
    JSON.stringify(picked.options),
  );
  check(
    "pickOptions rejects non-options",
    picked.options.size === undefined,
    JSON.stringify(picked.options),
  );

  // review: returns only non-empty corrections.
  const reviewer = stubService({
    get: () => ({
      completeJson: async () => ({ pitch: "Better answer", email: "" }),
    }),
  });
  const reviewed = await reviewer.review("d.com", [
    { key: "pitch", type: "textarea", currentValue: "Bad answer" },
    { key: "email", type: "email", currentValue: "a@b.c" },
  ]);
  check(
    "review returns corrections and drops empties",
    reviewed.values.pitch === "Better answer" && !("email" in reviewed.values),
    JSON.stringify(reviewed.values),
  );

  // MemoryStore.merge: fresher value wins, counts add, alias removed.
  const ms = new ctx.AIFF.MemoryStore();
  await ms.set({
    e_mail: { value: "old@b.c", lastUsed: 1, count: 2 },
    email: { value: "new@b.c", lastUsed: 5, count: 3 },
    city: { value: "Lisbon", lastUsed: 1, count: 1 },
  });
  await ms.merge([
    ["e_mail", "email"],
    ["ghost", "city"],
  ]);
  const mergedMem = await ms.get();
  check(
    "memory merge keeps the fresher value and sums counts",
    mergedMem.email.value === "new@b.c" &&
      mergedMem.email.count === 5 &&
      !("e_mail" in mergedMem) &&
      mergedMem.city.value === "Lisbon",
    JSON.stringify(mergedMem),
  );

  // Curator: applies AI mapping, skips unknown aliases and sensitive targets.
  const curated = { pairs: null };
  const curator = new ctx.AIFF.MemoryCurator({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" } }),
    },
    memory: {
      get: async () => ({
        e_mail: { value: "a@b.c" },
        email: { value: "a@b.c" },
        city: { value: "Lisbon" },
      }),
      merge: async (pairs) => {
        curated.pairs = pairs;
      },
    },
    registry: {
      get: () => ({
        completeJson: async () => ({
          e_mail: "email",
          city: "password", // sensitive target — must be skipped
          ghost: "email", // unknown alias — must be skipped
        }),
      }),
    },
    prompts: new ctx.AIFF.PromptBuilder(),
  });
  const cur = await curator.consolidate();
  check(
    "curator merges aliases, skips sensitive/unknown",
    cur.merged === 1 &&
      JSON.stringify(curated.pairs) === '[["e_mail","email"]]',
    `${cur.merged} ${JSON.stringify(curated.pairs)}`,
  );
}

// --- end-to-end: a full application form fills from the knowledge base --------
// Mirrors the new sections of test-form.html. Drives the REAL FormScanner-built
// field objects through the REAL AutofillService: simple fields resolve from
// the learned memory (knowledge base), and the new field kinds (radio/checkbox
// groups, contenteditable, essays, unlabeled questions) fill via the AI path,
// then every proposed value is applied with the field's own fill(). Asserts the
// whole page ends up filled — the "everything fills" guarantee.
async function applicationFormChecks() {
  // The learned knowledge base: canonical concept -> value.
  const kb = {
    first_name: "Alex",
    last_name: "Rivera",
    email: "alex.rivera@example.com",
    phone: "+1 415 555 0148",
    organization: "Acme Search",
    address_line1: "500 Market Street",
    postal_code: "94105",
    country: "United States",
    linkedin: "https://linkedin.com/in/alexrivera",
  };
  const memory = {};
  for (const [k, v] of Object.entries(kb))
    memory[k] = { value: v, lastUsed: 1, count: 1 };

  // Memory-path fields: [field, expectedValue, expectedConcept].
  const memSpec = [
    [
      new FormField(makeEl({ attrs: { autocomplete: "given-name" } })),
      "Alex",
      "first_name",
    ],
    [
      new FormField(makeEl({ attrs: { autocomplete: "family-name" } })),
      "Rivera",
      "last_name",
    ],
    [
      new FormField(
        makeEl({ type: "email", attrs: { autocomplete: "email" } }),
      ),
      "alex.rivera@example.com",
      "email",
    ],
    [
      new FormField(makeEl({ type: "tel", attrs: { autocomplete: "tel" } })),
      "+1 415 555 0148",
      "phone",
    ],
    [
      new FormField(makeEl({ attrs: { autocomplete: "organization" } })),
      "Acme Search",
      "organization",
    ],
    [
      new FormField(makeEl({ attrs: { autocomplete: "street-address" } })),
      "500 Market Street",
      "address_line1",
    ],
    [
      new FormField(makeEl({ attrs: { autocomplete: "postal-code" } })),
      "94105",
      "postal_code",
    ],
    [
      new FormField(makeEl({ attrs: { autocomplete: "country-name" } })),
      "United States",
      "country",
    ],
    [
      new FormField(
        makeEl({ id: "li", type: "url", labelFor: "LinkedIn Profile URL" }),
      ),
      "https://linkedin.com/in/alexrivera",
      "linkedin",
    ],
  ];

  // AI-path fields: [field, answerAModelWouldGiveFromTheKnowledgeBase].
  const workAuth = new CG([
    radio("work_auth", "yes", "Yes", {
      closest: fieldset("Are you legally authorized to work here?"),
    }),
    radio("work_auth", "no", "No"),
  ]);
  const workMode = new CG([
    radio("work_mode", "remote", "Remote", {
      closest: fieldset("Preferred work mode"),
    }),
    radio("work_mode", "hybrid", "Hybrid"),
    radio("work_mode", "onsite", "Onsite"),
  ]);
  const skills = new CG(
    [
      radio("skills", "py", "Python"),
      radio("skills", "go", "Go"),
      radio("skills", "rust", "Rust"),
    ].map((el) => ((el.type = "checkbox"), el)),
  );
  const relocate = new CG([
    makeChoice({
      type: "checkbox",
      name: "relocate",
      closest: wrappingLabel("Willing to relocate"),
    }),
  ]);
  const cover = new ctx.AIFF.RichTextField(
    makeEditor({ attrs: { "aria-label": "Cover letter" } }),
  );
  const whyFit = new FormField(
    makeEl({ tag: "TEXTAREA", type: "textarea", name: "best_candidate" }),
  );
  // Unlabeled field — the question lives in a block above it (FieldContext).
  const titleEl = makeEl({
    tag: "TEXTAREA",
    type: "textarea",
    name: "opaque_title_8842001",
  });
  titleEl.previousElementSibling = {
    previousElementSibling: null,
    textContent: "What is your current job title?",
    querySelector: () => null,
    matches: () => false,
  };
  const title = new FormField(titleEl);

  const aiSpec = [
    [workAuth, "Yes"],
    [workMode, "Remote"],
    [skills, "Python, Go"],
    [relocate, "yes"],
    [cover, "Dear hiring team, I build production retrieval systems…"],
    [
      whyFit,
      "Nine years shipping measurable relevance wins across the vector-search stack.",
    ],
    [title, "Senior Search Engineer"],
  ];

  // Keys are derived from the real describe() so opaque/positional keys line up.
  const aiAnswers = {};
  for (const [f, a] of aiSpec) aiAnswers[f.describe().key] = a;

  let captured = null;
  const service = new ctx.AIFF.AutofillService({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" } }),
    },
    memory: { get: async () => memory },
    fieldMap: { get: async () => ({}) },
    blocks: { get: async () => ({}) },
    registry: {
      get: () => ({
        completeJson: async (req) => {
          captured = req;
          return { values: aiAnswers, concepts: {}, questions: {} };
        },
      }),
    },
    prompts: new ctx.AIFF.PromptBuilder(),
  });

  const allFields = [...memSpec.map((s) => s[0]), ...aiSpec.map((s) => s[0])];
  const infos = allFields.map((f) => f.describe());
  const page = {
    url: "https://jobs.test/senior-search-engineer",
    title: "Senior Search Engineer",
    headings: ["Relevance Platform"],
    text: "We build semantic search, vector databases and LLM-powered RAG at scale.",
  };
  const resp = await service.autofill("jobs.test", infos, page);

  // Every field got a proposed value, and every value applied to its control.
  let proposed = 0;
  let filled = 0;
  for (const [i, f] of allFields.entries()) {
    const v = resp.values[infos[i].key];
    if (v != null && v !== "") {
      proposed++;
      if (f.fill(v)) filled++;
    }
  }
  check(
    "application form: every field proposed a value",
    proposed === allFields.length,
    `${proposed}/${allFields.length}`,
  );
  check(
    "application form: every proposed value applied to its field",
    filled === allFields.length,
    `${filled}/${allFields.length}`,
  );

  // Simple fields came from memory; the new kinds came from the AI.
  for (const [f, expected, concept] of memSpec) {
    const info = f.describe();
    check(
      `application form: ${concept} from memory`,
      resp.values[info.key] === expected && resp.sources[info.key] === "memory",
      `${resp.values[info.key]} (${resp.sources[info.key]})`,
    );
  }
  check(
    "application form: cover letter came from the AI",
    resp.sources[cover.describe().key] === "ai",
    resp.sources[cover.describe().key],
  );

  // The radio actually selected, the checkbox group ticked both, the editor set.
  check(
    "application form: radio group selected Yes",
    workAuth.els[0].checked === true && workAuth.els[1].checked !== true,
    `yes=${workAuth.els[0].checked}`,
  );
  check(
    "application form: checkbox group ticked Python+Go only",
    skills.els[0].checked && skills.els[1].checked && !skills.els[2].checked,
    skills.value,
  );
  check(
    "application form: contenteditable received the cover letter",
    cover.value.startsWith("Dear hiring team"),
    cover.value,
  );

  // Page + per-field context reached the model.
  check(
    "application form: job posting reached the prompt",
    !!captured && /semantic search/.test(captured.user),
    captured ? "missing posting" : "no AI call",
  );
  check(
    "application form: unlabeled field's question reached the prompt",
    !!captured && /current job title/i.test(captured.user),
    captured ? "missing question" : "no AI call",
  );
  check(
    "application form: long-form budget applied (essays present)",
    !!captured && captured.maxTokens === 8192,
    captured ? `${captured.maxTokens}` : "no AI call",
  );
}

// --- ask-the-user-and-save flow ---------------------------------------------
// When the knowledge base can't answer a field, the AI returns a question AND a
// canonical concept for it; the user's answer is then saved under that concept
// (and teaches the field-map index) so it reuses on later forms.
async function askFlowChecks() {
  // 1. autofill() surfaces a question and a reusable concept for an unfilled field.
  const service = new ctx.AIFF.AutofillService({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" } }),
    },
    memory: { get: async () => ({}) },
    fieldMap: { get: async () => ({}) },
    blocks: { get: async () => ({}) },
    registry: {
      get: () => ({
        completeJson: async () => ({
          values: { nickname: "Ike" },
          concepts: { nickname: "nickname", q_881: "start_date" },
          questions: { q_881: "When can you start?" },
        }),
      }),
    },
    prompts: new ctx.AIFF.PromptBuilder(),
  });
  const resp = await service.autofill("site.com", [
    { key: "nickname", label: "Nickname", type: "text" },
    { key: "q_881", label: "Availability", type: "text" },
  ]);
  check(
    "ask flow: question surfaces for the unfilled field",
    resp.questions.q_881 === "When can you start?",
    JSON.stringify(resp.questions),
  );
  check(
    "ask flow: unfilled field keeps the AI's reusable concept",
    resp.concepts.q_881 === "start_date",
    resp.concepts.q_881,
  );

  // 2. The answer (committed as source 'ai' with that concept) is saved under
  //    the concept AND learns the field-map fingerprint->concept mapping.
  const memStore = new ctx.AIFF.MemoryStore();
  const mapStore = new ctx.AIFF.FieldMapStore();
  await memStore.set({});
  await mapStore.set({});
  const saver = new ctx.AIFF.AutofillService({
    settings: { load: async () => new ctx.AIFF.Settings({}) },
    memory: memStore,
    fieldMap: mapStore,
    blocks: { get: async () => ({}) },
    registry: { get: () => ({}) },
    prompts: new ctx.AIFF.PromptBuilder(),
  });
  await saver.commit("site.com", [
    {
      info: { key: "q_881", fingerprint: "availability|text" },
      value: "March 2026",
      source: "ai",
      concept: "start_date",
    },
  ]);
  await mapStore.learn([]); // flush the fire-and-forget field-map write chain
  const savedMem = await memStore.get();
  const savedMap = await mapStore.get();
  check(
    "ask flow: answer saved under the canonical concept",
    savedMem.start_date && savedMem.start_date.value === "March 2026",
    JSON.stringify(savedMem),
  );
  check(
    "ask flow: field-map learns fingerprint -> concept",
    savedMap["availability|text"] === "start_date",
    JSON.stringify(savedMap),
  );

  // 3. Without an AI concept (source 'memory'), the answer still saves — keyed
  //    by signature — but does NOT teach the field map.
  await memStore.set({});
  await mapStore.set({});
  await saver.commit("site.com", [
    {
      info: { key: "weird_field", fingerprint: "weird|text" },
      value: "value",
      source: "memory",
    },
  ]);
  await mapStore.learn([]);
  const m3 = await memStore.get();
  const fm3 = await mapStore.get();
  check(
    "ask flow: concept-less answer saved by signature",
    m3.weird_field && m3.weird_field.value === "value",
    JSON.stringify(m3),
  );
  check(
    "ask flow: concept-less answer does not teach the field map",
    Object.keys(fm3).length === 0,
    JSON.stringify(fm3),
  );
}

// --- reuse: long-form re-composition, ranked memory, cacheable prompt ---------
function memoryService(memory, raw, completeJson) {
  const sent = [];
  const svc = new ctx.AIFF.AutofillService({
    settings: {
      load: async () =>
        new ctx.AIFF.Settings({ providerKeys: { anthropic: "k" }, ...raw }),
    },
    memory: { get: async () => memory },
    fieldMap: { get: async () => ({}) },
    blocks: { get: async () => ({}) },
    registry: {
      get: () => ({
        completeJson: async (req) => {
          sent.push(req);
          return completeJson(req);
        },
      }),
    },
    prompts: new ctx.AIFF.PromptBuilder(),
  });
  return { svc, sent };
}

async function reuseChecks() {
  const memory = {
    why_us: { value: "I love Acme's search team.", count: 1 },
    email: { value: "a@b.co", count: 3 },
  };
  const fields = [
    { key: "why_us", label: "Why us?", type: "textarea" },
    { key: "email", label: "Email", type: "email" },
  ];

  const fresh = memoryService(memory, {}, () => ({
    values: { why_us: "I want to build Globex's ranking." },
  }));
  const r1 = await fresh.svc.autofill("globex.com", fields);
  const freshUser = fresh.sent.length ? fresh.sent[0].user : "";
  check(
    "saved essay is re-composed by the AI, not pasted",
    r1.values.why_us === "I want to build Globex's ranking." &&
      r1.sources.why_us === "ai",
    JSON.stringify(r1),
  );
  check(
    "short saved values still skip the AI",
    r1.sources.email === "memory" &&
      !freshUser.includes('"key": "email"'),
    JSON.stringify(r1.sources),
  );
  check(
    "the AI still sees the saved essay",
    freshUser.includes("I love Acme's search team."),
    freshUser.slice(0, 200),
  );

  const empty = memoryService(memory, {}, () => ({ values: {} }));
  const r2 = await empty.svc.autofill("globex.com", fields);
  check(
    "saved essay is the fallback when the AI returns nothing",
    r2.values.why_us === "I love Acme's search team." &&
      r2.sources.why_us === "memory",
    JSON.stringify(r2),
  );

  const noKey = memoryService(memory, { providerKeys: {} }, () => ({}));
  const r3 = await noKey.svc.autofill("globex.com", fields);
  check(
    "without an API key the saved essay fills directly",
    r3.values.why_us === "I love Acme's search team." && !noKey.sent.length,
    JSON.stringify(r3),
  );

  // Ranked memory: the most-used facts survive the context cap.
  const big = {};
  const limit = ctx.AIFF.PromptBuilder.MEMORY_CONTEXT_LIMIT;
  for (let i = 0; i < limit; i++)
    big[`filler_${i}`] = { value: `v${i}`, count: 1 };
  big.linkedin = { value: "linkedin.com/in/me", count: 9 };
  const ranked = new ctx.AIFF.PromptBuilder().buildAutofill(
    { prompt: "", knowledge: "" },
    big,
    [{ key: "x", type: "text" }],
  );
  check(
    "most-used memory value survives the cap",
    ranked.user.includes("linkedin.com/in/me") &&
      !ranked.user.includes(`filler_${limit - 1}:`),
    ranked.user.slice(0, 200),
  );

  // Knowledge base sits in the (cacheable) system prompt, not the user turn.
  const kb = new ctx.AIFF.PromptBuilder().buildSuggest(
    { prompt: "", knowledge: "Name: Ike" },
    {},
    { key: "name", type: "text" },
  );
  check(
    "knowledge base is in the system prompt",
    kb.system.includes("Name: Ike") && !kb.user.includes("Name: Ike"),
    kb.system.slice(-60),
  );
  const httpA = recordingHttp();
  await new ctx.AIFF.AnthropicProvider(httpA).completeJson(
    { apiKey: "k", model: "m", system: "s", user: "u" },
    null,
  );
  const sys = httpA.calls[0].body.system;
  check(
    "anthropic marks the system prompt cacheable",
    Array.isArray(sys) &&
      sys[0].text === "s" &&
      (sys[0].cache_control || {}).type === "ephemeral",
    JSON.stringify(sys),
  );

  // Frame replies: an iframe's fill is reported even if the top frame is empty.
  const FR = ctx.AIFF.FrameReplies;
  const merged = FR.fill([
    { filled: 0, total: 0, message: "Nothing to fill." },
    { filled: 4, total: 5, usedAI: true },
  ]);
  check(
    "frame replies sum fills across frames",
    merged.filled === 4 && merged.total === 5 && merged.usedAI,
    JSON.stringify(merged),
  );
  check(
    "frame error shows only when no frame filled",
    FR.fill([{ error: "No API key" }, { filled: 2, total: 2 }]).filled === 2 &&
      FR.fill([{ error: "No API key" }, { filled: 0, total: 0 }]).error ===
        "No API key",
    "",
  );
  check(
    "frame previews add up",
    FR.fill([{ preview: true, total: 2 }, { preview: true, total: 3 }])
      .total === 5,
    "",
  );
  check(
    "frame imports add up",
    FR.import([{ imported: 1, fromBrowser: 1 }, { imported: 2, fromBrowser: 0 }])
      .imported === 3,
    "",
  );
}

Promise.all([
  providerChecks(),
  reuseChecks(),
  correctChecks(),
  longFormChecks(),
  applicationFormChecks(),
  // Both mutate the shared chrome.storage stub (memory/fieldMap), so run them
  // in series rather than racing on the same keys.
  advancedChecks().then(() => askFlowChecks()),
]).then(() => {
  console.log(`\nFormats tested: ${cases.length}`);
  console.log(`${pass} checks passed, ${fail} failed`);
  if (fail) {
    console.log("\nFailures:");
    for (const f of fails) console.log("  - " + f);
  }
  process.exit(fail ? 1 : 0);
});
