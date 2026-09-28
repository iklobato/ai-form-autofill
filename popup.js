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
    this.$allowFrames = document.querySelector("#allow-frames");
    this.$fill.addEventListener("click", () => this._fill());
    this.$allowFrames.addEventListener("click", () => this._allowFrames());
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
  // All frames, since embedded forms (Greenhouse, Lever…) live in iframes;
  // frames without host access are skipped. Returns the reached frame ids.
  async _inject(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: AIFF.CONTENT_SCRIPT_FILES,
    });
    return results.map((r) => r.frameId);
  }

  // One message to every reached frame; a frame that fails just drops out.
  async _sendAll(tabId, frameIds, message) {
    const settled = await Promise.allSettled(
      frameIds.map((frameId) =>
        chrome.tabs.sendMessage(tabId, message, { frameId }),
      ),
    );
    return settled
      .filter((s) => s.status === "fulfilled" && s.value)
      .map((s) => s.value);
  }

  // Origins of iframes on the page that the injection could not reach (no
  // host access yet), so the user can grant them with one click.
  async _blockedFrameOrigins(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        origin: location.origin,
        frames: [...document.querySelectorAll("iframe[src]")].map((f) => {
          try {
            return new URL(f.src, location.href).origin;
          } catch {
            return "";
          }
        }),
      }),
    });
    const found = results.map((r) => r.result).filter(Boolean);
    const reached = new Set(found.map((r) => r.origin));
    const framed = found.flatMap((r) => r.frames);
    return [
      ...new Set(
        framed.filter((o) => /^https?:/.test(o) && !reached.has(o)),
      ),
    ];
  }

  async _fill() {
    const t = await this._activeTab();
    this.$status.textContent = "Filling…";
    this.$allowFrames.hidden = true;
    try {
      const frameIds = await this._inject(t.id);
      const replies = await this._sendAll(t.id, frameIds, {
        action: "autofill",
      });
      const resp = AIFF.FrameReplies.fill(replies);
      this.$status.textContent = this._statusText(resp);
      // Only when nothing was found to fill: every page has ad/video iframes,
      // and asking for access to those would be noise.
      if (resp && !resp.total)
        this._offerBlockedFrames(await this._blockedFrameOrigins(t.id));
    } catch {
      this.$status.textContent =
        "Can't run on this page (try a normal website).";
    }
  }

  _offerBlockedFrames(origins) {
    this.blockedOrigins = origins;
    if (!origins.length) return;
    const hosts = origins.map((o) => new URL(o).hostname).join(", ");
    this.$status.textContent += ` Part of this page is an embedded form from ${hosts}.`;
    this.$allowFrames.hidden = false;
  }

  // Runs straight from the button click: permissions.request needs the gesture.
  async _allowFrames() {
    const origins = (this.blockedOrigins || []).map((o) => `${o}/*`);
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      this.$status.textContent = "The embedded form needs access to fill it.";
      return;
    }
    await this._fill();
  }

  async _import() {
    const t = await this._activeTab();
    this.$status.textContent = "Importing…";
    try {
      const frameIds = await this._inject(t.id);
      const resp = AIFF.FrameReplies.import(
        await this._sendAll(t.id, frameIds, { action: "importAutofill" }),
      );
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
