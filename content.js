// Content-script wiring: runs autofill on request, learns from typing, and
// shows the inline suggestion chip. DOM details live in formdom.js.

var AIFF = (self.AIFF = self.AIFF || {}); // shared global scope; see shared.js

AIFF.SuggestionChip = class SuggestionChip {
  constructor() {
    this.el = null;
  }

  _ensure() {
    if (this.el) return this.el;
    this.el = document.createElement("div");
    this.el.setAttribute("data-aiff-ui", ""); // never scanned as a form field
    Object.assign(this.el.style, {
      position: "absolute",
      zIndex: 2147483647,
      background: "#1f2937",
      color: "#fff",
      font: "12px system-ui, sans-serif",
      padding: "5px 6px",
      borderRadius: "8px",
      boxShadow: "0 2px 10px rgba(0,0,0,.35)",
      display: "none",
    });
    document.body.appendChild(this.el);
    return this.el;
  }

  hide() {
    if (this.el) this.el.style.display = "none";
  }

  maybeHide() {
    if (this.el && !this.el.matches(":hover")) this.hide();
  }

  _truncate(s) {
    return s.length > 40 ? s.slice(0, 39) + "…" : s;
  }

  _button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      background: "#374151",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      padding: "4px 8px",
      marginRight: "4px",
      cursor: "pointer",
      font: "inherit",
    });
    // Keep the field focused so clicking the chip doesn't blur (and hide) it.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }

  _position(targetEl) {
    const r = targetEl.getBoundingClientRect();
    const c = this._ensure();
    c.style.left = window.scrollX + r.left + "px";
    c.style.top = window.scrollY + r.bottom + 4 + "px";
  }

  // suggestFn(field) -> Promise<value>, or null when AI suggestions are off.
  render(field, memValue, suggestFn) {
    const c = this._ensure();
    c.innerHTML = "";
    if (memValue) {
      c.appendChild(
        this._button("↩ " + this._truncate(memValue), () => {
          field.fill(memValue);
          this.hide();
        }),
      );
    }
    if (suggestFn) {
      const ai = this._button("✨ AI", async () => {
        ai.textContent = "…";
        try {
          const value = await suggestFn(field);
          c.innerHTML = "";
          c.appendChild(
            this._button("↩ " + this._truncate(value), () => {
              field.fill(value);
              this.hide();
            }),
          );
        } catch (e) {
          ai.textContent = "⚠";
          ai.title = e.message;
        }
      });
      c.appendChild(ai);
    }
    this._position(field.el);
    c.style.display = "block";
  }
};

// Captures typed values (debounced) so they persist before a submit navigates
// away. Skips sensitive fields. Sends field descriptors to the worker, which
// resolves the canonical storage key — so capture, AI learning, and import all
// agree on the key.
AIFF.MemoryCapture = class MemoryCapture {
  constructor() {
    this.pending = new Map(); // signature -> { info, value }
    this.timer = null;
  }
  queue(field) {
    if (!field || !field.isFillable() || !field.value) return;
    if (field.isSensitive()) return;
    // Single-character values are code/PIN fragments — never worth storing.
    if (field.value.trim().length <= 1) return;
    const info = field.describe();
    this.pending.set(info.key, { info, value: field.value.trim() });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  }
  flush() {
    clearTimeout(this.timer);
    if (!this.pending.size) return;
    const fields = [...this.pending.values()];
    this.pending.clear();
    chrome.runtime
      .sendMessage({
        action: "rememberValues",
        domain: location.hostname,
        fields,
      })
      .catch((e) => console.warn("AIFF remember failed", e));
  }
};

// A floating panel that previews proposed values with per-field checkboxes and
// editable values before anything is written to the form.
AIFF.PreviewPanel = class PreviewPanel {
  static TEXTAREA_ROWS = 5;
  constructor() {
    this.el = null;
  }

  _ensure() {
    if (this.el) return this.el;
    const el = document.createElement("div");
    el.setAttribute("data-aiff-ui", ""); // never scanned as a form field
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: 2147483647,
      width: "360px",
      maxHeight: "70vh",
      overflow: "auto",
      background: "#0f172a",
      color: "#e5e7eb",
      border: "1px solid #1f2937",
      borderRadius: "10px",
      boxShadow: "0 8px 30px rgba(0,0,0,.5)",
      font: "13px system-ui, sans-serif",
      padding: "12px",
    });
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  close() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }

  // items: [{ field, info, value, source }]; onFill([{ field, value }]);
  // onBlock(item) when the user disables a field for this site.
  show(items, onFill, onBlock) {
    this.close();
    const el = this._ensure();
    const title = document.createElement("div");
    title.textContent = `Autofill preview — ${items.length} field${items.length === 1 ? "" : "s"}`;
    Object.assign(title.style, { fontWeight: "600", marginBottom: "8px" });
    el.appendChild(title);

    const rows = items.map((item) => {
      const r = this._row(item);
      const block = this._button("🚫", "transparent");
      block.title = "Never fill this here";
      Object.assign(block.style, { flex: "0 0 auto", padding: "2px 4px" });
      block.addEventListener("click", () => {
        r.blocked = true;
        r.el.remove();
        if (onBlock) onBlock(item);
      });
      r.el.appendChild(block);
      return r;
    });
    for (const r of rows) el.appendChild(r.el);

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      gap: "8px",
      marginTop: "10px",
    });
    const fillBtn = this._button("Fill selected", "#2563eb");
    const cancelBtn = this._button("Cancel", "#374151");
    fillBtn.addEventListener("click", () => {
      // Spread the original item (field, info, source, concept) and override the
      // value with what's in the input, so edits are what get filled and learned.
      const selected = rows
        .filter((r) => !r.blocked && r.checkbox.checked)
        .map((r) => ({ ...r.item, value: r.input.value }));
      this.close();
      onFill(selected);
    });
    cancelBtn.addEventListener("click", () => this.close());
    footer.append(fillBtn, cancelBtn);
    el.appendChild(footer);
  }

  // Ask the user for required fields the AI couldn't fill. items: [{field, info}];
  // onAnswer([{field, value}]) for the ones they answered.
  ask(items, onAnswer) {
    this.close();
    const el = this._ensure();
    const title = document.createElement("div");
    title.textContent = `A few details needed — ${items.length} field${items.length === 1 ? "" : "s"}`;
    Object.assign(title.style, { fontWeight: "600", marginBottom: "8px" });
    el.appendChild(title);

    const rows = items.map((item) => {
      const row = document.createElement("div");
      Object.assign(row.style, { margin: "8px 0" });
      const name = document.createElement("div");
      // Prefer the AI's own question for the user over the raw field label.
      name.textContent = item.question || item.info.label || item.info.key;
      Object.assign(name.style, {
        fontSize: "11px",
        color: "#94a3b8",
        marginBottom: "2px",
      });
      const input = this._answerControl(item.info);
      row.append(name, input);
      el.appendChild(row);
      return { input, item };
    });

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      gap: "8px",
      marginTop: "10px",
    });
    const ok = this._button("Fill & remember", "#2563eb");
    const skip = this._button("Skip", "#374151");
    ok.addEventListener("click", () => {
      const answers = rows
        .map((r) => ({ r, value: PreviewPanel._read(r.input).trim() }))
        .filter(({ value }) => value)
        .map(({ r, value }) => ({
          field: r.item.field,
          value,
          item: r.item, // carries the concept so the answer saves reusably
        }));
      this.close();
      onAnswer(answers);
    });
    skip.addEventListener("click", () => this.close());
    footer.append(ok, skip);
    el.appendChild(footer);
  }

  _row(item) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      margin: "6px 0",
    });
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    // Pages often style every `input` (e.g. width: 100%); that would stretch
    // the checkbox across the row and squeeze the value out of sight.
    Object.assign(checkbox.style, {
      flex: "0 0 auto",
      width: "auto",
      height: "auto",
      margin: "0",
      padding: "0",
    });
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { flex: "1", minWidth: "0" });
    const name = document.createElement("div");
    name.textContent = item.info.label || item.info.key;
    Object.assign(name.style, {
      fontSize: "11px",
      color: "#94a3b8",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    // Essays get a textarea: a text input would strip their line breaks,
    // and those paragraphs are exactly what gets filled.
    const input = this._styled(
      AIFF.FieldInfo.isLongForm(item.info) || /\n/.test(item.value)
        ? this._textarea()
        : document.createElement("input"),
    );
    input.value = item.value;
    wrap.append(name, input);
    const badge = document.createElement("span");
    badge.textContent = item.source === "ai" ? "AI" : "memory";
    Object.assign(badge.style, {
      fontSize: "10px",
      color: "#94a3b8",
      flex: "0 0 auto",
    });
    row.append(checkbox, wrap, badge);
    return { el: row, checkbox, input, item };
  }

  // Where the user answers a missing field: the field's own options when it
  // has fixed ones (a free-typed "yes" may match none of them), a textarea
  // for open questions, else a text input.
  _answerControl(info) {
    const options = info.options || [];
    if (options.length) {
      const select = document.createElement("select");
      select.multiple = info.type === "checkbox_group";
      if (select.multiple) select.size = Math.min(options.length, 5);
      else select.appendChild(new Option("", ""));
      for (const o of options) select.appendChild(new Option(o, o));
      return this._styled(select);
    }
    const input = AIFF.FieldInfo.isLongForm(info)
      ? this._textarea()
      : document.createElement("input");
    if (info.placeholder) input.placeholder = info.placeholder;
    return this._styled(input);
  }
  // A multi-select answers a checkbox group as "a, b" (what its fill() takes).
  static _read(control) {
    if (!control.multiple) return control.value;
    return [...control.selectedOptions].map((o) => o.value).join(", ");
  }
  _textarea() {
    const t = document.createElement("textarea");
    t.rows = PreviewPanel.TEXTAREA_ROWS;
    t.style.resize = "vertical";
    return t;
  }
  _styled(control) {
    Object.assign(control.style, {
      width: "100%",
      boxSizing: "border-box",
      background: "#111827",
      color: "#e5e7eb",
      border: "1px solid #374151",
      borderRadius: "5px",
      padding: "4px 6px",
      font: "inherit",
    });
    return control;
  }
  _button(label, bg) {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      flex: "1",
      background: bg,
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      padding: "7px",
      cursor: "pointer",
      font: "inherit",
    });
    return b;
  }
};

// Watches for fields added after load (wizard steps, lazily rendered forms)
// and fires the callback when genuinely new ones appear. The extension's own
// panels never count — the scanner skips [data-aiff-ui].
// Page-side progress for a fill. The popup closes as soon as the user clicks
// away, so without this a 10-30s AI call looks like nothing happened.
AIFF.StatusToast = class StatusToast {
  static DONE_MS = 4000;
  static ERROR_MS = 8000;
  constructor() {
    this.el = null;
    this.timer = null;
  }
  _ensure() {
    if (this.el) return this.el;
    const el = document.createElement("div");
    el.setAttribute("data-aiff-ui", ""); // never scanned as a form field
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.title = "Click to dismiss";
    Object.assign(el.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: 2147483647,
      maxWidth: "320px",
      background: "#0f172a",
      color: "#e5e7eb",
      border: "1px solid #1f2937",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,.4)",
      font: "13px system-ui, sans-serif",
      padding: "8px 12px",
      cursor: "pointer",
    });
    el.addEventListener("click", () => this.hide());
    document.body.appendChild(el);
    this.el = el;
    return el;
  }
  show(text) {
    clearTimeout(this.timer);
    this._ensure().textContent = text;
  }
  done(text, ms = StatusToast.DONE_MS) {
    this.show(text);
    this.timer = setTimeout(() => this.hide(), ms);
  }
  error(text) {
    this.done(text, StatusToast.ERROR_MS);
  }
  hide() {
    clearTimeout(this.timer);
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }
};

AIFF.FormObserver = class FormObserver {
  static DEBOUNCE_MS = 800;

  constructor(scanner, onNewFields) {
    this.scanner = scanner;
    this.onNewFields = onNewFields;
    this.seen = new WeakSet();
    this.timer = null;
  }

  start() {
    this._mark(this.scanner.fields());
    new MutationObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this._scan(), FormObserver.DEBOUNCE_MS);
    }).observe(document.body, { childList: true, subtree: true });
  }

  _mark(fields) {
    for (const f of fields) for (const el of f.els || [f.el]) this.seen.add(el);
  }

  _scan() {
    const fresh = this.scanner
      .fields()
      .filter((f) => (f.els || [f.el]).some((el) => !this.seen.has(el)));
    if (!fresh.length) return;
    this._mark(fresh);
    this.onNewFields(fresh);
  }
};

AIFF.ContentApp = class ContentApp {
  constructor(settingsStore) {
    this.settings = settingsStore;
    this.scanner = new AIFF.FormScanner();
    this.capture = new AIFF.MemoryCapture();
    this.chip = new AIFF.SuggestionChip();
    this.preview = new AIFF.PreviewPanel();
    this.toast = new AIFF.StatusToast();
    this.observer = new AIFF.FormObserver(this.scanner, () => this._autofill());
    this._running = null; // the in-flight autofill promise
    // Field keys already shown in an ask prompt this page load, so the same
    // missing field isn't asked again (e.g. on every form mutation).
    this._asked = new Set();
  }

  start() {
    this._registerMessages();
    this._registerCapture();
    this._registerChip();
    this._maybeAutoFill();
  }

  // Auto-fill on page load when this site is set to fill automatically, and
  // keep filling as wizard steps / lazy fields appear. After filling, any
  // required or AI-flagged field still missing is asked once (see _finish).
  async _maybeAutoFill() {
    const cfg = (await this.settings.load()).resolvePublic(location.hostname);
    if (!cfg.autoFill) return;
    await this._autofill();
    this.observer.start();
  }

  // Ask the AI/memory for proposed values for every fillable field.
  async _collectProposals() {
    // Only empty fields: a re-run (next wizard step, second click) must never
    // overwrite what the user already typed or edited.
    const fields = this.scanner.fields().filter((f) => f.isEmpty());
    if (!fields.length) return { items: [], total: 0 };
    this.toast.show(`Filling ${AIFF.Text.count(fields.length, "field")}…`);
    const pairs = fields.map((field) => ({ field, info: field.describe() }));
    const resp = await chrome.runtime.sendMessage({
      action: "aiAutofill",
      domain: location.hostname,
      fields: pairs.map((p) => p.info),
      // The page itself (job posting, product page…) so answers are tailored.
      page: AIFF.PageContext.collect(),
    });
    if (!resp || resp.error)
      return { error: resp ? resp.error : "No response" };
    const items = [];
    for (const { field, info } of pairs) {
      const value = resp.values[info.key];
      if (value != null && value !== "")
        items.push({
          field,
          info,
          value: String(value),
          source: resp.sources[info.key],
          concept: (resp.concepts && resp.concepts[info.key]) || info.key,
        });
    }
    return {
      items,
      total: pairs.length,
      usedAI: resp.usedAI,
      questions: resp.questions || {},
      concepts: resp.concepts || {},
    };
  }

  async _apply(items) {
    let filled = 0;
    const unmatched = [];
    for (const it of items) {
      if (it.field.fill(it.value)) filled++;
      else if ((it.info.options || []).length) unmatched.push(it);
    }
    // The proposed value matched no option verbatim ("USA" vs "United States"):
    // ask the AI to pick the closest allowed option and fill that instead.
    if (!unmatched.length) return filled;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        action: "aiPickOptions",
        domain: location.hostname,
        picks: unmatched.map((it) => ({ field: it.info, value: it.value })),
      });
    } catch (e) {
      console.warn("AIFF option pick failed", e);
      return filled;
    }
    const options = (resp && resp.options) || {};
    for (const it of unmatched) {
      const option = options[it.info.key];
      if (option && it.field.fill(option)) {
        it.value = option; // commit what was actually filled
        filled++;
      }
    }
    return filled;
  }

  async _autofill() {
    // A call that arrives mid-fill (popup click right after the injection
    // started an auto-fill) shares that run's result instead of failing.
    if (!this._running)
      this._running = this._autofillLocked()
        .catch((e) => {
          this.toast.error(`Autofill failed: ${e.message}`);
          throw e;
        })
        .finally(() => {
          this._running = null;
        });
    return this._running;
  }

  async _autofillLocked() {
    const proposals = await this._collectProposals();
    if (proposals.error) {
      this.toast.error(`Autofill failed: ${proposals.error}`);
      return { error: proposals.error };
    }
    if (!proposals.items.length) {
      // Replace the "Filling…" of this run; a run with no empty fields never
      // showed one, so it leaves an earlier result on screen.
      if (proposals.total) this.toast.done("Nothing more I could fill.");
      // Nothing to fill, but required/AI-flagged fields may still need asking.
      await this._finish(proposals.questions, proposals.concepts);
      return { filled: 0, total: proposals.total, message: "Nothing to fill." };
    }

    const cfg = (await this.settings.load()).resolvePublic(location.hostname);
    if (cfg.autoFill) {
      const filled = await this._apply(proposals.items);
      // Semantic pass before committing, so corrections are what get learned.
      await this._review(proposals.items);
      await this._commit(proposals.items);
      await this._finish(proposals.questions, proposals.concepts);
      this.toast.done(`Filled ${filled} of ${AIFF.Text.count(proposals.total, "field")}.`);
      return { filled, total: proposals.total, usedAI: proposals.usedAI };
    }
    // Default: let the user review and confirm. Learning happens here, on
    // confirm — not at proposal time — so Cancel/uncheck/edits are respected.
    this.toast.hide();
    this.preview.show(
      proposals.items,
      async (selected) => {
        this.toast.show(`Filling ${AIFF.Text.count(selected.length, "field")}…`);
        const filled = await this._apply(selected);
        await this._commit(selected);
        await this._finish(proposals.questions, proposals.concepts);
        this.toast.done(`Filled ${filled} of ${AIFF.Text.count(selected.length, "field")}.`);
      },
      (item) => this._block(item),
    );
    return { preview: true, total: proposals.items.length };
  }

  // Ask the AI to re-read what it filled: does each value answer its field,
  // and are the answers consistent? Applies returned corrections in place.
  async _review(items) {
    const aiItems = items.filter((it) => it.source === "ai");
    if (!aiItems.length) return;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        action: "aiReview",
        domain: location.hostname,
        fields: aiItems.map((it) => ({
          ...it.info,
          currentValue: it.field.value,
        })),
      });
    } catch (e) {
      console.warn("AIFF review failed", e);
      return;
    }
    if (!resp || resp.error || !resp.values) return;
    for (const it of aiItems) {
      const v = resp.values[it.info.key];
      if (v != null && v !== "" && v !== it.value && it.field.fill(v))
        it.value = v;
    }
  }

  // Persist confirmed values (and teach the field-map index for AI guesses).
  // Skips sensitive fields; the worker is the single writer.
  async _commit(items) {
    const payload = items
      .filter((it) => it.value && it.field && !it.field.isSensitive())
      .map((it) => ({
        info: it.info,
        value: it.value,
        source: it.source,
        concept: it.concept,
      }));
    if (!payload.length) return;
    try {
      await chrome.runtime.sendMessage({
        action: "commitLearn",
        domain: location.hostname,
        items: payload,
      });
    } catch (e) {
      console.warn("AIFF commit failed", e);
    }
  }

  // Agent loop after filling: fix validation failures, then ask the user for
  // anything still missing (required fields, or fields the AI flagged a
  // question for) so their answers can be saved to the knowledge base.
  async _finish(questions, concepts) {
    await this._verifyAndCorrect();
    this._askForMissing(questions || {}, concepts || {});
  }

  // Re-read the form; for fields failing native validation, ask the AI for a
  // corrected value and re-fill. Capped at 2 rounds; stops when no progress.
  async _verifyAndCorrect() {
    for (let round = 0; round < 2; round++) {
      const problems = this.scanner.fields().filter((f) => f.isInvalid());
      if (!problems.length) return;
      const pairs = problems.map((field) => ({
        field,
        info: {
          ...field.describe(),
          currentValue: field.value,
          problem: field.validationMessage(),
        },
      }));
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({
          action: "aiCorrect",
          domain: location.hostname,
          fields: pairs.map((p) => p.info),
        });
      } catch (e) {
        console.warn("AIFF correct failed", e);
        return;
      }
      if (!resp || resp.error || !resp.values) return;
      let fixed = 0;
      for (const { field, info } of pairs) {
        const v = resp.values[info.key];
        if (v != null && v !== "" && field.fill(v)) fixed++;
      }
      if (!fixed) return; // no progress — stop
    }
  }

  // ask_user: when information is missing, ask the user for it and save their
  // answer to the knowledge base. A field qualifies when it's required-and-empty
  // or the AI flagged a question for it. Each is asked at most once per page
  // load, never for sensitive fields, and the answer is saved under the AI's
  // canonical concept (teaching the field-map index) so it reuses on later forms.
  _askForMissing(questions = {}, concepts = {}) {
    if (this.preview.el) return; // don't clobber a panel that's already open
    const missing = [];
    for (const f of this.scanner.fields()) {
      if (!f.isEmpty() || f.isSensitive()) continue;
      const info = f.describe();
      const question = questions[info.key] || "";
      if (!f.isRequired() && !question) continue;
      if (this._asked.has(info.key)) continue;
      missing.push({
        field: f,
        info,
        question,
        concept: concepts[info.key] || "",
      });
    }
    if (!missing.length) return;
    for (const m of missing) this._asked.add(m.info.key);
    this.preview.ask(missing, (answers) => {
      const items = [];
      for (const { field, value, item } of answers) {
        if (!value || field.isSensitive() || !field.fill(value)) continue;
        items.push({
          info: field.describe(),
          value: value.trim(),
          // The AI's concept for what it asked about, so the worker saves the
          // answer under a reusable key (and, as source "ai", learns the
          // field-map mapping for next time). Without one it keys by signature.
          concept: item.concept || "",
          source: item.concept ? "ai" : "memory",
        });
      }
      if (items.length)
        chrome.runtime
          .sendMessage({
            action: "commitLearn",
            domain: location.hostname,
            items,
          })
          .catch((e) => console.warn("AIFF remember failed", e));
    });
  }

  // Harvest values already on the page (browser-autofilled or otherwise present)
  // into memory, keyed canonically so they reuse across sites. Skips sensitive.
  async _importAutofill() {
    const present = this.scanner
      .fields()
      .filter((f) => f.value && f.value.trim() && !f.isSensitive());
    const fields = present.map((f) => ({
      info: f.describe(),
      value: f.value.trim(),
      fromBrowser: f.isAutofilled(),
    }));
    if (!fields.length) return { imported: 0, fromBrowser: 0 };
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        action: "rememberValues",
        domain: location.hostname,
        fields,
      });
    } catch (e) {
      return { error: e.message };
    }
    return {
      imported: resp ? resp.remembered : 0,
      fromBrowser: resp ? resp.fromBrowser : 0,
    };
  }

  // Disable this fill on this site so it never happens again. Block the raw
  // field key as well as the concept: an AI-classified concept is only learned
  // on commit, so on the next visit the field may resolve back to its raw key —
  // which must still match the block.
  _block(item) {
    for (const key of new Set([item.concept || item.info.key, item.info.key]))
      chrome.runtime.sendMessage({
        action: "blockFill",
        domain: location.hostname,
        key,
      });
  }

  async _suggest(field) {
    const resp = await chrome.runtime.sendMessage({
      action: "aiSuggest",
      domain: location.hostname,
      field: field.describe(),
      page: AIFF.PageContext.collect(),
    });
    if (!resp || resp.error) throw new Error(resp ? resp.error : "No response");
    return resp.value;
  }

  _registerMessages() {
    const handlers = {
      autofill: () => this._autofill(),
      importAutofill: () => this._importAutofill(),
    };
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const run = handlers[msg.action];
      if (!run) return;
      run()
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    });
  }

  _registerCapture() {
    const queue = (e) =>
      e.target && this.capture.queue(new AIFF.FormField(e.target));
    document.addEventListener("input", queue, true);
    document.addEventListener(
      "focusout",
      (e) => {
        queue(e);
        this.capture.flush();
      },
      true,
    );
    document.addEventListener("submit", () => this.capture.flush(), true);
  }

  _registerChip() {
    document.addEventListener("focusin", async (e) => {
      const field = new AIFF.FormField(e.target);
      if (!field.isFillable() || field.value) return;
      // The worker resolves the stored value by the same canonical key as
      // autofill, and reports whether a key exists — without exposing it here.
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({
          action: "fieldLookup",
          domain: location.hostname,
          field: field.describe(),
        });
      } catch {
        return;
      }
      if (!resp) return;
      // The lookup was async: don't pop the chip if the user already moved on
      // or typed something meanwhile.
      if (document.activeElement !== e.target || field.value) return;
      const memValue = resp.memValue || "";
      if (!memValue && !resp.hasKey) return;
      const suggestFn = resp.hasKey ? (f) => this._suggest(f) : null;
      this.chip.render(field, memValue, suggestFn);
    });
    document.addEventListener(
      "focusout",
      () => setTimeout(() => this.chip.maybeHide(), 200),
      true,
    );
    window.addEventListener("scroll", () => this.chip.hide(), true);
  }
};

// May be loaded twice on a granted site (registered script + activeTab
// injection); guard so listeners are registered only once per page.
if (!self.__aiffStarted) {
  self.__aiffStarted = true;
  new AIFF.ContentApp(new AIFF.SettingsStore()).start();
}
