var AIFF = (self.AIFF = self.AIFF || {});

// Sidebar tab switching: toggles which [data-panel] section is visible.
AIFF.TabNav = class TabNav {
  constructor(navEl, panelsEl) {
    this.navEl = navEl;
    this.panelsEl = panelsEl;
    navEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (btn) this.select(btn.dataset.tab);
    });
  }
  select(name) {
    for (const b of this.navEl.querySelectorAll("[data-tab]"))
      b.classList.toggle("active", b.dataset.tab === name);
    for (const p of this.panelsEl.querySelectorAll("[data-panel]"))
      p.hidden = p.dataset.panel !== name;
  }
};

// One per-website override card.
AIFF.SiteCard = class SiteCard {
  static providerOptions(blankLabel) {
    const head = blankLabel ? `<option value="">${blankLabel}</option>` : "";
    return (
      head +
      Object.entries(AIFF.PROVIDERS)
        .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
        .join("")
    );
  }

  constructor(domain, cfg = {}) {
    this.domain = domain;
    this.cfg = cfg; // retained so collect() preserves fields not shown here (autoFill)
    this.el = document.createElement("div");
    this.el.className = "card";
    this.el.dataset.domain = domain;
    this.el.innerHTML = `
      <div class="card-head">
        <strong class="s-domain"></strong>
        <button class="secondary remove">Remove</button>
      </div>
      <label>Provider <span class="hint">(blank = default)</span></label>
      <select class="s-provider">${SiteCard.providerOptions("Default")}</select>
      <label>Model <span class="hint">(blank = default)</span></label>
      <input class="s-model" type="text" list="models" />
      <label>Instructions</label>
      <textarea class="s-prompt"></textarea>
      <label>Knowledge base</label>
      <textarea class="s-knowledge"></textarea>
    `;
    this.el.querySelector(".s-domain").textContent = domain;
    this.el.querySelector(".s-provider").value = cfg.provider || "";
    this.el.querySelector(".s-model").value = cfg.model || "";
    this.el.querySelector(".s-prompt").value = cfg.prompt || "";
    this.el.querySelector(".s-knowledge").value = cfg.knowledge || "";
    this.el
      .querySelector(".remove")
      .addEventListener("click", () => this.el.remove());
  }

  collect() {
    return {
      ...this.cfg,
      provider: this.el.querySelector(".s-provider").value,
      model: this.el.querySelector(".s-model").value.trim(),
      prompt: this.el.querySelector(".s-prompt").value.trim(),
      knowledge: this.el.querySelector(".s-knowledge").value.trim(),
    };
  }
};

// The editable list of saved values (the learned knowledge base).
AIFF.MemoryEditor = class MemoryEditor {
  constructor(listEl, countEl, onRemove) {
    this.listEl = listEl;
    this.countEl = countEl;
    this.onRemove = onRemove || (() => {});
    this.loaded = {};
    this.groupBy = "domain"; // "domain" (default) or "category"
  }

  setGroupBy(mode) {
    this.groupBy = mode === "category" ? "category" : "domain";
    this.render(this.loaded);
  }

  // Group saved keys into readable categories by their canonical concept.
  static CATEGORIES = [
    [
      "Personal",
      /(^|_)(first|last|full|middle|given|family)_name$|^name$|surname|dob|birth|gender/,
    ],
    [
      "Contact",
      /email|e_mail|phone|tel|mobile|cell|user_?name|^user(_id)?$|login/,
    ],
    [
      "Address",
      /address|street|city|town|state|province|region|postal|zip|country/,
    ],
    ["Links", /linkedin|github|gitlab|website|portfolio|^url$|twitter/],
    [
      "Work",
      /company|organi[sz]ation|employer|job_title|^title$|position|role|experience|skills|education|salary/,
    ],
  ];
  static GROUP_ORDER = [
    "Personal",
    "Contact",
    "Address",
    "Links",
    "Work",
    "Other",
  ];

  static categorize(key) {
    for (const [name, re] of MemoryEditor.CATEGORIES)
      if (re.test(key)) return name;
    return "Other";
  }

  render(memory) {
    this.loaded = memory;
    this.listEl.innerHTML = "";
    this.listEl.dataset.group = this.groupBy;
    const keys = Object.keys(memory);
    if (!keys.length) {
      this.listEl.innerHTML = `<div class="mem-empty">Nothing saved yet.</div>`;
      this.countEl.textContent = "0 saved.";
      return;
    }
    const groups =
      this.groupBy === "category"
        ? this._byCategory(keys)
        : this._byDomain(keys, memory);
    for (const [name, groupKeys] of groups)
      this.listEl.appendChild(this._group(name, groupKeys.sort(), memory));
    this.countEl.textContent = `${keys.length} saved.`;
  }

  // Returns ordered [groupName, keys[]] pairs.
  _byCategory(keys) {
    const groups = {};
    for (const k of keys) (groups[MemoryEditor.categorize(k)] ||= []).push(k);
    return MemoryEditor.GROUP_ORDER.filter((c) => groups[c]?.length).map(
      (c) => [c, groups[c]],
    );
  }

  _byDomain(keys, memory) {
    const groups = {};
    for (const k of keys) {
      const domain = (memory[k].domain || "").trim() || "No website";
      (groups[domain] ||= []).push(k);
    }
    const order = Object.keys(groups).sort((a, b) => {
      if (a === "No website") return 1;
      if (b === "No website") return -1;
      return a.localeCompare(b);
    });
    return order.map((d) => [d, groups[d]]);
  }

  _group(cat, keys, memory) {
    const g = document.createElement("div");
    g.className = "mem-group";
    const head = document.createElement("div");
    head.className = "mem-group-head";
    const name = document.createElement("span");
    name.className = "mem-group-name";
    name.textContent = cat;
    const count = document.createElement("span");
    count.className = "mem-group-count";
    count.textContent = keys.length;
    head.append(name, count);
    head.addEventListener("click", () => g.classList.toggle("collapsed"));
    const body = document.createElement("div");
    body.className = "mem-group-body";
    for (const k of keys) body.appendChild(this._row(k, memory[k]));
    g.append(head, body);
    return g;
  }

  _row(key, entry) {
    const row = document.createElement("div");
    row.className = "mem-row";
    row.dataset.key = key;
    row.innerHTML = `
      <span class="mem-key"></span>
      <input class="mem-value" type="text" />
      <span class="mem-domain"></span>
      <button class="mem-remove" title="Remove">✕</button>
    `;
    row.querySelector(".mem-key").textContent = key;
    row.querySelector(".mem-key").title = key;
    row.querySelector(".mem-value").value = entry.value || "";
    row.querySelector(".mem-domain").textContent = entry.domain || "";
    row.querySelector(".mem-remove").addEventListener("click", () => {
      row.remove();
      delete this.loaded[key];
      this.countEl.textContent = `${Object.keys(this.loaded).length} saved.`;
      this.onRemove(key); // persist the deletion immediately
    });
    return row;
  }

  // Hide rows that don't match (key, value or domain) and hide empty groups.
  applyFilter(query) {
    const q = (query || "").trim().toLowerCase();
    for (const group of this.listEl.querySelectorAll(".mem-group")) {
      let any = false;
      for (const row of group.querySelectorAll(".mem-row")) {
        const key = row.dataset.key.toLowerCase();
        const value = (
          row.querySelector(".mem-value").value || ""
        ).toLowerCase();
        const domain = (
          row.querySelector(".mem-domain").textContent || ""
        ).toLowerCase();
        const hit =
          !q || key.includes(q) || value.includes(q) || domain.includes(q);
        row.style.display = hit ? "" : "none";
        if (hit) any = true;
      }
      group.style.display = any ? "" : "none";
      if (q) group.classList.remove("collapsed"); // expand so matches show
    }
  }

  // Rebuild memory from the edited rows; an emptied value drops the entry.
  collect() {
    const memory = {};
    for (const row of this.listEl.querySelectorAll(".mem-row")) {
      const key = row.dataset.key;
      const value = row.querySelector(".mem-value").value.trim();
      if (!value) continue;
      const prev = this.loaded[key] || {};
      memory[key] = {
        value,
        lastUsed: prev.lastUsed || Date.now(),
        count: prev.count || 1,
        domain: prev.domain || "",
      };
    }
    return memory;
  }
};

AIFF.OptionsController = class OptionsController {
  constructor() {
    this.settings = new AIFF.SettingsStore();
    this.memoryStore = new AIFF.MemoryStore();
    this.blockStore = new AIFF.BlockStore();
    this.siteCards = [];
    this.dirty = false;
  }

  // Inputs Save does not own: search/filter boxes, staged actions, and the
  // learn-everywhere toggle (it saves itself on change).
  static NOT_SETTINGS = new Set([
    "memSearch",
    "memGroupBy",
    "kbUrl",
    "newDomain",
    "learnAll",
  ]);

  init() {
    this.$ = (s) => document.querySelector(s);
    this.memoryEditor = new AIFF.MemoryEditor(
      this.$("#memList"),
      this.$("#memCount"),
      (key) => this._removeMemory(key),
    );
    this.tabs = new AIFF.TabNav(this.$("#tabs"), this.$("#panels"));
    this.$("#addSite").addEventListener("click", () => this._addSite());
    this.$("#kbFetch").addEventListener("click", () => this._fetchKb());
    this.$("#learnAll").addEventListener("change", () => this._setLearnAll());
    this.$("#save").addEventListener("click", () => this._save());
    this._trackChanges();
    this.$("#clearMem").addEventListener("click", () => this._clearMem());
    this.$("#memMerge").addEventListener("click", () => this._mergeMem());
    this.$("#memSearch").addEventListener("input", (e) =>
      this.memoryEditor.applyFilter(e.target.value),
    );
    this.$("#memGroupBy").addEventListener("change", (e) => {
      this.memoryEditor.setGroupBy(e.target.value);
      this.memoryEditor.applyFilter(this.$("#memSearch").value);
    });
    this._load();
  }

  // Drop any stored values that look sensitive or are one-char fragments
  // (e.g. split OTP boxes captured before the rule existed).
  async _scrubMemory(memory) {
    const cleaned = {};
    let removed = 0;
    for (const [key, entry] of Object.entries(memory || {})) {
      const value = entry && entry.value ? String(entry.value).trim() : "";
      if (
        !value ||
        value.length <= 1 ||
        AIFF.SensitivePolicy.isSensitiveKey(key)
      ) {
        removed++;
        continue;
      }
      cleaned[key] = entry;
    }
    if (removed)
      await chrome.runtime.sendMessage({
        action: "setMemory",
        memory: cleaned,
      });
    return cleaned;
  }

  async _load() {
    const [settings, rawMemory] = await Promise.all([
      this.settings.load(),
      this.memoryStore.get(),
    ]);
    const memory = await this._scrubMemory(rawMemory);
    const s = settings.raw;
    const keys = s.providerKeys || {};
    this.$("#keyAnthropic").value = keys.anthropic || "";
    this.$("#keyOpenai").value = keys.openai || "";
    this.$("#keyOpenrouter").value = keys.openrouter || "";
    this.$("#defaultProvider").innerHTML = AIFF.SiteCard.providerOptions();
    this.$("#defaultProvider").value = s.defaultProvider || "anthropic";
    this.$("#defaultModel").value = s.defaultModel || "";
    this.$("#longFormModel").value = s.longFormModel || "";
    this.$("#globalPrompt").value =
      s.globalPrompt ?? AIFF.TEMPLATES.globalPrompt;
    this.$("#globalKnowledge").value =
      s.globalKnowledge ?? AIFF.TEMPLATES.globalKnowledge;
    this.$("#learnAll").checked = !!s.learnAllSites;
    this.$("#sites").innerHTML = "";
    this.siteCards = [];
    for (const [domain, cfg] of Object.entries(s.sites || {}))
      this._appendCard(domain, cfg);
    this._renderMemory(memory || {});
    this._renderBlocks(await this.blockStore.get());
  }

  _renderBlocks(blocks) {
    const el = this.$("#blockList");
    el.innerHTML = "";
    const rows = [];
    for (const [domain, keys] of Object.entries(blocks || {}))
      for (const key of Object.keys(keys)) rows.push([domain, key]);
    if (!rows.length) {
      el.innerHTML = `<div class="mem-empty">No disabled fills.</div>`;
      return;
    }
    rows.sort();
    for (const [domain, key] of rows) {
      const row = document.createElement("div");
      row.className = "mem-row";
      const d = document.createElement("span");
      d.className = "mem-key";
      d.textContent = domain;
      const k = document.createElement("span");
      k.style.flex = "1";
      k.textContent = key;
      const btn = document.createElement("button");
      btn.className = "mem-remove";
      btn.title = "Re-enable this fill";
      btn.textContent = "✕";
      btn.addEventListener("click", () => {
        row.remove();
        chrome.runtime.sendMessage({ action: "unblockFill", domain, key });
      });
      row.append(d, k, btn);
      el.appendChild(row);
    }
  }

  _renderMemory(memory) {
    this.memoryEditor.render(memory);
    this.memoryEditor.applyFilter(this.$("#memSearch").value);
  }

  _appendCard(domain, cfg) {
    const card = new AIFF.SiteCard(domain, cfg);
    this.siteCards.push(card);
    this.$("#sites").appendChild(card.el);
  }

  // Passive capture everywhere needs all-sites access; request it, then
  // (un)register the content script that does the learning.
  async _setLearnAll() {
    const on = this.$("#learnAll").checked;
    if (on) {
      const granted = await chrome.permissions.request({
        origins: ["*://*/*"],
      });
      if (!granted) {
        this.$("#learnAll").checked = false;
        return;
      }
    }
    await chrome.runtime.sendMessage({ action: "setLearnAllSites", on });
    if (!on)
      chrome.permissions.remove({ origins: ["*://*/*"] }).catch(() => {});
    const raw = (await this.settings.load()).raw;
    raw.learnAllSites = on;
    await this.settings.save(raw);
  }

  async _fetchKb() {
    const raw = this.$("#kbUrl").value.trim();
    if (!raw) return;
    let parsed;
    try {
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      this.$("#kbStatus").textContent = "That doesn't look like a valid URL.";
      return;
    }
    const url = parsed.href;
    const status = this.$("#kbStatus");
    // Reading the page requires host access to it; request it on this click.
    const granted = await chrome.permissions.request({
      origins: [`${parsed.origin}/*`],
    });
    if (!granted) {
      status.textContent = "Access to that site was denied.";
      return;
    }
    status.textContent = "Fetching and reading the page…";
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        action: "extractKnowledge",
        url,
      });
    } catch {
      resp = null;
    }
    if (!resp) {
      status.textContent =
        "No response from the extension. Reload it at chrome://extensions (↻) and reopen this page.";
      return;
    }
    if (resp.error) {
      status.textContent = "Error: " + resp.error;
      return;
    }
    const fields = resp.fields || {};
    const keys = Object.keys(fields);
    if (!keys.length) {
      status.textContent = "Nothing useful found on that page.";
      return;
    }

    // Seed memory only (the single source of values). It already feeds the AI,
    // so we don't also copy into the knowledge-base text — that duplication is
    // what made removed values keep filling.
    const entries = keys
      .map((k) => [AIFF.Text.normalize(k), String(fields[k]).trim()])
      .filter(([k, v]) => k && v);
    await chrome.runtime.sendMessage({
      action: "rememberKeyed",
      entries,
      domain: parsed.hostname,
    });
    this._renderMemory(await this.memoryStore.get());

    status.textContent = `Added ${entries.length} values to your Saved data (Saved data tab).`;
  }

  _addSite() {
    const domain = this.$("#newDomain").value.trim().toLowerCase();
    if (!domain) return;
    if (this.siteCards.some((c) => c.el.isConnected && c.domain === domain))
      return;
    this._appendCard(domain, {});
    this.$("#newDomain").value = "";
    this._setDirty(true);
  }

  // Save is manual (it replaces the whole memory store, so it must not race
  // live captures on a timer); instead, never lose an edit silently: show
  // that changes are pending, warn before closing, and save on Cmd/Ctrl+S.
  _trackChanges() {
    const panels = this.$("#panels");
    const onEdit = (e) => {
      if (!OptionsController.NOT_SETTINGS.has(e.target.id)) this._setDirty(true);
    };
    panels.addEventListener("input", onEdit);
    panels.addEventListener("change", onEdit);
    panels.addEventListener("click", (e) => {
      if (e.target.closest(".remove")) this._setDirty(true); // site card removed
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.dirty) e.preventDefault();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this._save();
      }
    });
  }
  _setDirty(dirty) {
    this.dirty = dirty;
    this.$("#saved").textContent = dirty ? "Unsaved changes" : "";
  }

  _collectSites() {
    const sites = {};
    for (const card of this.siteCards)
      if (card.el.isConnected) sites[card.domain] = card.collect();
    return sites;
  }

  async _save() {
    // Spread the stored settings first so keys this page doesn't edit (e.g. a
    // global autoFill) survive the save instead of being silently dropped.
    const raw = {
      ...(await this.settings.load()).raw,
      providerKeys: {
        anthropic: this.$("#keyAnthropic").value.trim(),
        openai: this.$("#keyOpenai").value.trim(),
        openrouter: this.$("#keyOpenrouter").value.trim(),
      },
      defaultProvider: this.$("#defaultProvider").value,
      defaultModel: this.$("#defaultModel").value.trim(),
      longFormModel: this.$("#longFormModel").value.trim(),
      globalPrompt: this.$("#globalPrompt").value.trim(),
      globalKnowledge: this.$("#globalKnowledge").value.trim(),
      learnAllSites: this.$("#learnAll").checked,
      sites: this._collectSites(),
    };
    const memory = this.memoryEditor.collect();
    await Promise.all([
      this.settings.save(raw),
      chrome.runtime.sendMessage({ action: "setMemory", memory }),
    ]);
    this._renderMemory(memory);
    this.dirty = false;
    const saved = this.$("#saved");
    saved.textContent = "Saved.";
    setTimeout(() => (saved.textContent = ""), 1500);
  }

  // Persist a single removal immediately, so a removed value stops filling.
  async _removeMemory(key) {
    await chrome.runtime.sendMessage({ action: "removeMemory", key });
  }

  async _clearMem() {
    await chrome.runtime.sendMessage({ action: "clearMemory" });
    this._renderMemory({});
  }

  // Ask the AI to merge alias keys (e_mail / email_address / …) into one
  // canonical entry each, then re-render the surviving list.
  async _mergeMem() {
    const status = this.$("#mergeStatus");
    status.textContent = "Looking for duplicates…";
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ action: "consolidateMemory" });
    } catch {
      resp = null;
    }
    if (!resp) {
      status.textContent = "No response from the extension.";
      return;
    }
    if (resp.error) {
      status.textContent = "Error: " + resp.error;
      return;
    }
    this._renderMemory(await this.memoryStore.get());
    status.textContent = resp.merged
      ? `Merged ${resp.merged} duplicate ${resp.merged === 1 ? "entry" : "entries"}.`
      : "No duplicates found.";
  }
};

new AIFF.OptionsController().init();
