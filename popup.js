var AIFF = (self.AIFF = self.AIFF || {});

AIFF.PopupController = class PopupController {
  constructor() {
    this.settings = new AIFF.SettingsStore();
  }

  init() {
    this.$fill = document.querySelector("#fill");
    this.$status = document.querySelector("#status");
    this.$meta = document.querySelector("#meta");
    this.$auto = document.querySelector("#auto");
    this.$fill.addEventListener("click", () => this._fill());
    document
      .querySelector("#import")
      .addEventListener("click", () => this._import());
    document
      .querySelector("#options")
      .addEventListener("click", () => chrome.runtime.openOptionsPage());
    this._initSite();
  }

  async _activeTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t;
  }

  async _initSite() {
    const t = await this._activeTab();
    try {
      this.host = new URL(t.url).hostname;
    } catch {
      return;
    }
    const settings = await this.settings.load();
    const cfg = settings.resolve(this.host);
    const note = cfg.hasKey
      ? ""
      : ` — no ${cfg.provider} key set, only saved values will fill`;
    this.$meta.textContent = `${this.host} · ${cfg.provider} · ${cfg.model}${note}`;
    this.$auto.checked = cfg.autoFill;
    this.$auto.addEventListener("change", () => this._setAutoFill());
  }

  // Enabling auto-fill needs always-on access to this site (so the content
  // script can run on load); request it, then (un)register the script.
  async _setAutoFill() {
    const on = this.$auto.checked;
    const origin = `*://${this.host}/*`;
    if (on) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        this.$auto.checked = false;
        this.$status.textContent = "Auto-fill needs access to this site.";
        return;
      }
      await chrome.runtime.sendMessage({
        action: "registerSite",
        host: this.host,
      });
    } else {
      await chrome.runtime.sendMessage({
        action: "unregisterSite",
        host: this.host,
      });
      chrome.permissions.remove({ origins: [origin] }).catch(() => {});
    }
    const raw = (await this.settings.load()).raw;
    raw.sites = raw.sites || {};
    raw.sites[this.host] = { ...(raw.sites[this.host] || {}), autoFill: on };
    await this.settings.save(raw);
  }

  // activeTab lets us inject into the current tab on the user's click without
  // a persistent host permission. Idempotent thanks to content.js's guard.
  async _inject(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: AIFF.CONTENT_SCRIPT_FILES,
    });
  }

  async _fill() {
    const t = await this._activeTab();
    this.$status.textContent = "Filling…";
    try {
      await this._inject(t.id);
      const resp = await chrome.tabs.sendMessage(t.id, { action: "autofill" });
      this.$status.textContent = this._statusText(resp);
    } catch {
      this.$status.textContent =
        "Can't run on this page (try a normal website).";
    }
  }

  async _import() {
    const t = await this._activeTab();
    this.$status.textContent = "Importing…";
    try {
      await this._inject(t.id);
      const resp = await chrome.tabs.sendMessage(t.id, {
        action: "importAutofill",
      });
      if (!resp) {
        this.$status.textContent = "Open a normal web page, then try again.";
      } else if (resp.error) {
        this.$status.textContent = "Error: " + resp.error;
      } else if (!resp.imported) {
        this.$status.textContent =
          "No filled fields found. Let the browser autofill the form first.";
      } else {
        this.$status.textContent =
          `Imported ${resp.imported} value${resp.imported === 1 ? "" : "s"}` +
          (resp.fromBrowser
            ? ` (${resp.fromBrowser} from browser autofill).`
            : ".");
      }
    } catch {
      this.$status.textContent =
        "Could not reach this page. Reload it and retry.";
    }
  }

  _statusText(resp) {
    if (!resp) return "Open a normal web page with a form, then try again.";
    if (resp.error) return "Error: " + resp.error;
    if (resp.preview)
      return `Review the preview on the page (${resp.total} field${resp.total === 1 ? "" : "s"}).`;
    if (resp.message) return resp.message;
    return (
      `Filled ${resp.filled}/${resp.total} fields ` +
      (resp.usedAI ? "(AI + saved values)." : "(from saved values).")
    );
  }
};

new AIFF.PopupController().init();
