// The form DOM model. FormField wraps one element and answers everything we
// need about it; FormScanner produces the fillable fields on a page.

var AIFF = (self.AIFF = self.AIFF || {}); // shared global scope; see shared.js

// Walks the DOM near a control for the question text that label/legend miss —
// many real forms put the prompt in a plain block above the input with no
// label association at all. Defensive against partial DOM fakes (tests).
AIFF.FieldContext = class FieldContext {
  static HEADING_SELECTOR = "h1, h2, h3, h4, legend";
  // A legend titles only its own fieldset: one found inside an earlier
  // sibling is another group's question, not a heading for what follows.
  static SECTION_HEADING_SELECTOR = "h1, h2, h3, h4";
  static CONTROL_SELECTOR = "input, select, textarea, button";
  static MAX_TEXT = 300;

  // Nearest heading above the element: previous siblings first, then up the tree.
  static nearestHeading(el) {
    let node = el;
    for (let depth = 0; node && depth < 6; depth++) {
      for (
        let sib = node.previousElementSibling, hops = 0;
        sib && hops < 8;
        sib = sib.previousElementSibling, hops++
      ) {
        const h =
          sib.matches && sib.matches(FieldContext.HEADING_SELECTOR)
            ? sib
            : sib.querySelector &&
              sib.querySelector(FieldContext.SECTION_HEADING_SELECTOR);
        if (h) return FieldContext._clean(h.textContent);
      }
      node = node.parentElement;
    }
    return "";
  }

  // The text block immediately before the control — the de-facto question on
  // forms with no <label>. A sibling that is or contains another control means
  // we've crossed into the previous field: everything above it belongs to that
  // field (its label, the form's intro), so there is no question of our own.
  static questionText(el) {
    let node = el;
    for (let depth = 0; node && depth < 4; depth++) {
      for (
        let sib = node.previousElementSibling, hops = 0;
        sib && hops < 4;
        sib = sib.previousElementSibling, hops++
      ) {
        if (FieldContext._isOrHasControl(sib)) return "";
        const text = FieldContext._clean(sib.textContent);
        if (text.length >= 8) return text;
      }
      node = node.parentElement;
    }
    return "";
  }

  static _isOrHasControl(node) {
    const sel = FieldContext.CONTROL_SELECTOR;
    return !!(
      (node.matches && node.matches(sel)) ||
      (node.querySelector && node.querySelector(sel))
    );
  }

  static _clean(s) {
    return (s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, FieldContext.MAX_TEXT);
  }
};

// Wraps one form element and answers everything the rest of the extension needs
// about it — its key/signature, label and context, whether it's fillable or
// sensitive, and how to read/write its value. (The sensitive-data policy itself
// lives in shared.js so it can be audited and reused key-side.)
AIFF.FormField = class FormField {
  constructor(el) {
    this.el = el;
  }

  get tag() {
    return this.el.tagName ? this.el.tagName.toLowerCase() : "";
  }
  get type() {
    return (this.el.type || this.tag || "").toLowerCase();
  }
  get name() {
    return this.el.name || "";
  }
  get id() {
    return this.el.id || "";
  }
  get placeholder() {
    return this.el.placeholder || "";
  }
  get value() {
    return this.el.value;
  }
  attr(name) {
    return this.el.getAttribute(name);
  }

  // Machine-generated names/ids (question_12013476007, hashes, GUIDs) are
  // volatile and meaningless, so they make poor keys.
  static _isOpaque(s) {
    return (
      /\d{4,}/.test(s) ||
      /(^|[_-])\d{3,}([_-]|$)/.test(s) ||
      /^[0-9a-f]{8,}$/i.test(s) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
    );
  }

  static _textFromIds(ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((e) => e.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  // Text of a wrapping <label>, minus any nested controls — otherwise a wrapped
  // <select>'s option labels (or a button's text) leak into the field's label.
  static _labelText(labelEl) {
    if (
      typeof labelEl.cloneNode === "function" &&
      typeof labelEl.querySelectorAll === "function"
    ) {
      const clone = labelEl.cloneNode(true);
      for (const c of clone.querySelectorAll("input, select, textarea, button"))
        c.remove();
      return (clone.textContent || "").trim();
    }
    return (labelEl.textContent || "").trim();
  }

  // The HTML autocomplete field-name token (email, tel, given-name,
  // address-line1, …). Standardized and stable across sites, so it makes the
  // best key and lines our data up with the browser's own autofill. Drops
  // arbitrary section-* tokens but keeps shipping/billing so they stay distinct.
  autocompleteToken() {
    const raw = (this.attr("autocomplete") || "").trim().toLowerCase();
    if (!raw || raw === "on" || raw === "off" || raw === "false") return "";
    return raw
      .split(/\s+/)
      .filter((t) => t && !t.startsWith("section-"))
      .join(" ");
  }

  label() {
    const el = this.el;
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return FormField._labelText(l);
    }
    const wrap = el.closest("label");
    if (wrap) return FormField._labelText(wrap);
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = FormField._textFromIds(lb);
      if (t) return t;
    }
    const title = el.getAttribute("title");
    return title ? title.trim() : "";
  }

  // Stable key matching the same logical field across pages/sites. Prefers the
  // standardized autocomplete token (so our data lines up with the browser's),
  // then a meaningful name/id, then the label; nameless fields fall back to a
  // positional key so two of them don't collide into one.
  signature() {
    const name = this.name && !FormField._isOpaque(this.name) ? this.name : "";
    const id = this.id && !FormField._isOpaque(this.id) ? this.id : "";
    const base =
      this.autocompleteToken() ||
      name ||
      id ||
      this.label() ||
      this.placeholder ||
      this.attr("aria-label") ||
      this.name ||
      this.id ||
      "";
    const key = AIFF.Text.normalize(base);
    if (key) return key;
    const controls = [...document.querySelectorAll("input, textarea, select")];
    const idx = controls.indexOf(this.el);
    return `field_${AIFF.Text.normalize(this.type || this.tag)}_${idx < 0 ? 0 : idx}`;
  }

  _visible() {
    return !!(this.el.offsetParent || this.el.getClientRects().length);
  }

  isFillable() {
    const el = this.el;
    if (!el || el.disabled || el.readOnly) return false;
    const tag = this.tag;
    if (tag === "textarea" || tag === "select") return this._visible();
    if (tag !== "input") return false;
    const skip = [
      "hidden",
      "password",
      "file",
      "submit",
      "button",
      "reset",
      "image",
      "checkbox",
      "radio",
      "range",
      "color",
    ];
    if (skip.includes((el.type || "text").toLowerCase())) return false;
    return this._visible();
  }

  isSensitive() {
    return AIFF.SensitivePolicy.isSensitive(this);
  }

  // True when the browser autofilled this field (Chrome/Safari mark such inputs
  // with the :autofill pseudo-class). Some engines reject the selector, so guard.
  isAutofilled() {
    for (const sel of [":autofill", ":-webkit-autofill"]) {
      try {
        if (this.el.matches(sel)) return true;
      } catch {
        // selector unsupported in this engine
      }
    }
    return false;
  }

  // A stable shape id from context (not the opaque name), so the same field
  // across forms produces the same fingerprint for concept correlation.
  fingerprint() {
    const base =
      this.autocompleteToken() ||
      AIFF.Text.normalize(this.label()) ||
      AIFF.Text.normalize(this.placeholder) ||
      (this.name && !FormField._isOpaque(this.name)
        ? AIFF.Text.normalize(this.name)
        : "");
    return base ? `${base}|${this.type}` : "";
  }

  isEmpty() {
    return !this.el.value;
  }
  isRequired() {
    return !!this.el.required;
  }
  // Fails the browser's own validation (required-empty, pattern, type, maxlength…).
  isInvalid() {
    return (
      typeof this.el.checkValidity === "function" &&
      this.el.willValidate &&
      !this.el.checkValidity()
    );
  }
  validationMessage() {
    return this.el.validationMessage || "";
  }

  _nearbyContext() {
    const fs = this.el.closest("fieldset");
    const legend = fs && fs.querySelector("legend");
    if (legend) return legend.textContent.trim().slice(0, 200);
    const group = this.el.closest('[role="group"], [role="radiogroup"]');
    const groupLabel = group && group.getAttribute("aria-label");
    return groupLabel ? groupLabel.trim() : "";
  }

  _helpText() {
    const db = this.el.getAttribute("aria-describedby");
    return db ? FormField._textFromIds(db).slice(0, 300) : "";
  }

  // A rich description for the AI: every attribute/context we can extract, so
  // the model can infer what to fill even when name/id are meaningless.
  describe(key) {
    const el = this.el;
    const info = {
      key: key || this.signature(),
      label: this.label(),
      type: el.type || this.tag,
    };
    const fp = this.fingerprint();
    if (fp) info.fingerprint = fp;
    if (this.placeholder) info.placeholder = this.placeholder;
    if (el.required) info.required = true;
    const auto = el.getAttribute("autocomplete");
    if (auto && auto !== "off") info.autocomplete = auto;
    if (el.maxLength > 0) info.maxLength = el.maxLength;
    const pattern = el.getAttribute("pattern");
    if (pattern) info.pattern = pattern;
    const help = this._helpText();
    if (help) info.help = help;
    const context =
      this._nearbyContext() || AIFF.FieldContext.nearestHeading(el);
    if (context) info.context = context;
    const question = AIFF.FieldContext.questionText(el);
    if (question && question !== info.label) info.question = question;
    // A value-less option is the "Select..." placeholder, not an answer.
    if (this.tag === "select")
      info.options = [...el.options]
        .filter((o) => o.value !== "")
        .map((o) => o.textContent.trim())
        .filter(Boolean);
    return info;
  }

  // Set value via the native setter so React/Vue controlled inputs notice.
  fill(value) {
    const el = this.el;
    const tag = this.tag;
    if (tag === "select") {
      const opt = [...el.options].find(
        (o) =>
          o.value === value ||
          o.textContent.trim() === value ||
          AIFF.Text.normalize(o.textContent) === AIFF.Text.normalize(value),
      );
      if (!opt) return false;
      el.value = opt.value;
    } else {
      const proto =
        tag === "textarea"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
};

// A radio group, checkbox group, or single checkbox presented as ONE logical
// field. Mirrors FormField's interface (describe/fill/isFillable/…) so the
// rest of the pipeline treats every field kind uniformly; member-level work
// is delegated to per-element FormField wrappers (composition).
AIFF.ChoiceGroupField = class ChoiceGroupField {
  constructor(els) {
    this.els = els;
    this.el = els[0]; // representative: positioning, sensitivity, signature
    this.members = els.map((el) => new AIFF.FormField(el));
  }

  get type() {
    if ((this.el.type || "").toLowerCase() === "radio") return "radio_group";
    return this.els.length > 1 ? "checkbox_group" : "checkbox";
  }
  get name() {
    return this.el.name || "";
  }
  get id() {
    return this.el.id || "";
  }
  get placeholder() {
    return "";
  }
  get value() {
    return this.members
      .filter((m) => m.el.checked)
      .map((m) => m.label() || m.el.value || "")
      .filter(Boolean)
      .join(", ");
  }
  attr(name) {
    return this.el.getAttribute(name);
  }

  // The group's question. A member's own label is just one option, so it only
  // serves as the label for a single standalone checkbox.
  label() {
    if (this.type === "checkbox") {
      const own = this.members[0].label();
      if (own) return own;
    }
    return (
      this.members[0]._nearbyContext() || // fieldset legend / role=group label
      AIFF.FieldContext.questionText(this.el) ||
      AIFF.FieldContext.nearestHeading(this.el) ||
      this.name
    );
  }

  options() {
    return this.members
      .map((m) => m.label() || m.el.value || "")
      .filter(Boolean);
  }

  signature() {
    const name =
      this.name && !AIFF.FormField._isOpaque(this.name) ? this.name : "";
    const key = AIFF.Text.normalize(name || this.label());
    if (key) return key;
    const controls = [...document.querySelectorAll("input, textarea, select")];
    const idx = controls.indexOf(this.el);
    return `field_${this.type}_${idx < 0 ? 0 : idx}`;
  }

  fingerprint() {
    const base = AIFF.Text.normalize(this.label() || this.name);
    return base ? `${base}|${this.type}` : "";
  }

  isFillable() {
    return this.members.some((m) => !m.el.disabled && m._visible());
  }
  isSensitive() {
    return AIFF.SensitivePolicy.isSensitive(this);
  }
  isAutofilled() {
    return false;
  }
  isEmpty() {
    return !this.value;
  }
  isRequired() {
    return this.members.some((m) => m.el.required);
  }
  isInvalid() {
    return this.members.some((m) => m.isInvalid());
  }
  validationMessage() {
    const m = this.members.find((m) => m.validationMessage());
    return m ? m.validationMessage() : "";
  }

  describe(key) {
    const info = {
      key: key || this.signature(),
      label: this.label(),
      type: this.type,
      // A lone checkbox is a yes/no question; groups offer their members.
      options: this.type === "checkbox" ? ["yes", "no"] : this.options(),
    };
    const fp = this.fingerprint();
    if (fp) info.fingerprint = fp;
    if (this.isRequired()) info.required = true;
    const question = AIFF.FieldContext.questionText(this.el);
    if (question && question !== info.label) info.question = question;
    return info;
  }

  // value: an option's label (or input value); single checkbox: yes/no; a
  // checkbox group accepts several options separated by commas.
  fill(value) {
    const wanted = String(value == null ? "" : value);
    if (this.type === "checkbox") return this._fillCheckbox(wanted);
    const targets =
      this.type === "checkbox_group"
        ? wanted
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [wanted];
    let hit = false;
    for (const t of targets) {
      const want = AIFF.Text.normalize(t);
      if (!want) continue;
      const m = this.members.find(
        (m) =>
          AIFF.Text.normalize(m.label()) === want ||
          AIFF.Text.normalize(m.el.value) === want,
      );
      if (m) {
        ChoiceGroupField._set(m.el, true);
        hit = true;
      }
    }
    return hit;
  }

  _fillCheckbox(value) {
    const v = AIFF.Text.normalize(value);
    const on = /^(yes|true|y|1|on|checked)$/.test(v);
    const off = /^(no|false|n|0|off|unchecked)$/.test(v);
    if (!on && !off) return false;
    ChoiceGroupField._set(this.el, on);
    return true;
  }

  // click() drives the framework's own handlers; fall back to the property +
  // events for engines where click doesn't land.
  static _set(el, checked) {
    if (!!el.checked === checked) return;
    if (typeof el.click === "function") el.click();
    if (!!el.checked !== checked) {
      el.checked = checked;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
};

// A contenteditable rich-text editor (cover letters, "tell us more" boxes)
// behind the same field interface.
AIFF.RichTextField = class RichTextField {
  constructor(el) {
    this.el = el;
  }

  get type() {
    return "richtext";
  }
  get name() {
    return "";
  }
  get id() {
    return this.el.id || "";
  }
  get placeholder() {
    return this.attr("aria-placeholder") || this.attr("data-placeholder") || "";
  }
  get value() {
    const text =
      this.el.innerText != null ? this.el.innerText : this.el.textContent;
    return (text || "").trim();
  }
  attr(name) {
    return this.el.getAttribute(name);
  }

  label() {
    const aria = this.attr("aria-label");
    if (aria) return aria.trim();
    const lb = this.attr("aria-labelledby");
    if (lb) {
      const t = AIFF.FormField._textFromIds(lb);
      if (t) return t;
    }
    return (
      AIFF.FieldContext.questionText(this.el) ||
      AIFF.FieldContext.nearestHeading(this.el) ||
      this.placeholder
    );
  }

  signature() {
    const key = AIFF.Text.normalize(this.label() || this.id);
    if (key) return key;
    const all = [...document.querySelectorAll("[contenteditable]")];
    const idx = all.indexOf(this.el);
    return `field_richtext_${idx < 0 ? 0 : idx}`;
  }

  fingerprint() {
    const base = AIFF.Text.normalize(this.label());
    return base ? `${base}|${this.type}` : "";
  }

  isFillable() {
    const el = this.el;
    if (!el || el.getAttribute("contenteditable") === "false") return false;
    return !!(el.offsetParent || el.getClientRects().length);
  }
  isSensitive() {
    return AIFF.SensitivePolicy.isSensitive(this);
  }
  isAutofilled() {
    return false;
  }
  isEmpty() {
    return !this.value;
  }
  isRequired() {
    return this.attr("aria-required") === "true";
  }
  isInvalid() {
    return false; // no native validation on contenteditable
  }
  validationMessage() {
    return "";
  }

  describe(key) {
    const info = {
      key: key || this.signature(),
      label: this.label(),
      type: this.type,
    };
    const fp = this.fingerprint();
    if (fp) info.fingerprint = fp;
    if (this.placeholder) info.placeholder = this.placeholder;
    if (this.isRequired()) info.required = true;
    return info;
  }

  fill(value) {
    this.el.textContent = value; // plain text; editors normalize on input
    this.el.dispatchEvent(new Event("input", { bubbles: true }));
    this.el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
};

// What the AI needs to know about the page itself (a job posting, a product
// page…) so open-ended answers can be tailored to it. The text budget bounds
// the prompt overhead (~6k chars ≈ 1.5k tokens) — a deliberate cost ceiling,
// not a measured limit.
AIFF.PageContext = class PageContext {
  static MAX_TEXT = 6000;
  static MAX_HEADINGS = 12;

  static collect() {
    const headings = [...document.querySelectorAll("h1, h2, h3")]
      .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, PageContext.MAX_HEADINGS);
    const text = ((document.body && document.body.innerText) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PageContext.MAX_TEXT);
    return {
      url: location.href,
      title: (document.title || "").slice(0, 300),
      headings,
      text,
    };
  }
};

// Produces the page's fillable logical fields: text-like controls as
// FormField, radio/checkbox groups as ChoiceGroupField, contenteditable
// editors as RichTextField. The extension's own panels ([data-aiff-ui]) are
// never scanned as form fields, and sensitive fields (SSN, card, OTP…) are
// left out so no fill, correction or question ever sends them to the AI.
AIFF.FormScanner = class FormScanner {
  static UI_MARKER = "[data-aiff-ui]";

  constructor(root = document) {
    this.root = root;
  }

  fields() {
    const out = [];
    const groups = new Map();
    const scopes = [];
    const els = [...this.root.querySelectorAll("input, textarea, select")];
    for (const [i, el] of els.entries()) {
      if (this._ownUI(el)) continue;
      const type = (el.type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        // Same name + same form = one logical group; nameless ones stand alone.
        const scope = el.form || null;
        let scopeIdx = scopes.indexOf(scope);
        if (scopeIdx === -1) scopeIdx = scopes.push(scope) - 1;
        const key = el.name ? `${scopeIdx}|${type}|${el.name}` : `el|${i}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(el);
      } else {
        out.push(new AIFF.FormField(el));
      }
    }
    for (const groupEls of groups.values())
      out.push(new AIFF.ChoiceGroupField(groupEls));
    const editors = this.root.querySelectorAll(
      '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    );
    for (const el of editors) {
      if (this._ownUI(el)) continue;
      out.push(new AIFF.RichTextField(el));
    }
    return out.filter((f) => f.isFillable() && !f.isSensitive());
  }

  _ownUI(el) {
    return !!(el.closest && el.closest(FormScanner.UI_MARKER));
  }
};
