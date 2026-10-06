// End-to-end harness: the real extension in a real Chromium, with no new
// dependency in the repo. Playwright is resolved from the npx cache (or
// PLAYWRIGHT_PATH). The AI providers are replaced by a scripted fake inside the
// service worker, so every call can be asserted and nothing costs money.
//
// Hosts (mapped to 127.0.0.1 by the browser):
//   shop.test:8731    top pages, access granted
//   forms.test:8732   cross-origin iframe host, access granted
//   blocked.test:8732 cross-origin iframe host, NO access
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const REPO = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures");
const PORTS = [8731, 8732];
const GRANTED_HOSTS = ["*://shop.test/*", "*://forms.test/*"];
const SHOP = "http://shop.test:8731";
const FORMS = "http://forms.test:8732";
const EXTENSION_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "formdom.js",
  "shared.js",
  "providers.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "icon16.png",
  "icon48.png",
  "icon128.png",
];

function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  const npx = path.join(os.homedir(), ".npm/_npx");
  if (fs.existsSync(npx))
    for (const d of fs.readdirSync(npx))
      candidates.push(path.join(npx, d, "node_modules/playwright"));
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const pw = require(dir);
    // Only a Playwright whose bundled Chromium is downloaded can launch.
    if (fs.existsSync(pw.chromium.executablePath())) return pw;
  }
  throw new Error(
    "No usable Playwright found. Run `npx playwright install chromium` once, " +
      "or set PLAYWRIGHT_PATH to a playwright package directory.",
  );
}

function startServers() {
  const types = { ".html": "text/html", ".css": "text/css" };
  const servers = PORTS.map((port) =>
    http
      .createServer((req, res) => {
        const name = path.basename(new URL(req.url, "http://x").pathname);
        const file = path.join(FIXTURES, name);
        if (!fs.existsSync(file)) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, {
          "content-type": types[path.extname(file)] || "text/plain",
        });
        res.end(fs.readFileSync(file));
      })
      .listen(port),
  );
  return () => servers.forEach((s) => s.close());
}

// Copy of the extension whose manifest grants the test hosts up front: the
// popup's activeTab grant cannot be produced by a script.
function buildExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiff-ext-"));
  for (const f of EXTENSION_FILES)
    fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json")));
  manifest.host_permissions.push(...GRANTED_HOSTS);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

// Runs inside the service worker. Replaces fetch for the three provider hosts
// with a fake model driven by `plan`; every other URL goes to the network.
// Must be self-contained: Playwright ships only this function's source.
function installFakeAI(plan) {
  self.__plan = plan;
  self.__calls = self.__calls || [];
  self.__realFetch = self.__realFetch || self.fetch.bind(self);
  if (self.__fakeInstalled) return;
  self.__fakeInstalled = true;

  const KINDS = [
    ["autofill", "You help a user fill web forms"],
    ["suggest", "You suggest a single value"],
    ["correct", "You fix web-form fields"],
    ["review", "You review a web form"],
    ["pick", "You match a desired value"],
    ["consolidate", "You normalize a personal autofill memory"],
    ["enrich", "You extract a person's details"],
  ];
  const kindOf = (system) =>
    (KINDS.find(([, prefix]) => system.startsWith(prefix)) || ["unknown"])[0];
  const fieldsOf = (user) => {
    const at = user.lastIndexOf("Fields:\n");
    if (at === -1) return [];
    const m = user.slice(at + 8).match(/^\[[\s\S]*?\n\]/);
    return m ? JSON.parse(m[0]) : [];
  };
  // rules: [[regexSource, value], ...] matched against the field's label (its
  // key when unlabelled). Question/context text is not used: the extension
  // can attach a neighbouring field's text there.
  const answer = (rules, fields) => {
    const out = {};
    for (const f of fields) {
      const text = f.label || f.key;
      const hit = (rules || []).find(([re]) => new RegExp(re, "i").test(text));
      if (hit) out[f.key] = hit[1];
    }
    return out;
  };
  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal)
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
    });
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    });

  self.fetch = async (url, init = {}) => {
    const u = String(url);
    const provider = u.startsWith("https://api.anthropic.com")
      ? "anthropic"
      : u.startsWith("https://api.openai.com")
        ? "openai"
        : u.startsWith("https://openrouter.ai")
          ? "openrouter"
          : null;
    if (!provider) return self.__realFetch(url, init);
    const plan = self.__plan || {};
    const body = JSON.parse(init.body);
    const blocks =
      provider === "anthropic" ? body.system : body.messages[0].content;
    const system =
      typeof blocks === "string" ? blocks : blocks.map((b) => b.text).join("");
    const user =
      provider === "anthropic"
        ? body.messages[0].content
        : body.messages[1].content;
    const kind = kindOf(system);
    const fields = fieldsOf(user);
    const call = {
      provider,
      url: u,
      headers: init.headers,
      kind,
      model: body.model,
      maxTokens: body.max_tokens,
      cacheControl: typeof blocks === "string" ? null : blocks[0].cache_control,
      responseFormat: body.response_format || null,
      labels: fields.map((f) => f.label),
      fields,
      system,
      user,
    };
    self.__calls.push(call);

    if (plan.delayMs) await sleep(plan.delayMs, init.signal);
    if (plan.fail && (!plan.fail.kinds || plan.fail.kinds.includes(kind)))
      return new Response(plan.fail.text || "fail", { status: plan.fail.status });
    if (plan.rejectJsonMode && body.response_format)
      return new Response("Invalid parameter: response_format", { status: 400 });

    let result;
    if (kind === "autofill")
      result = {
        values: answer(plan.values, fields),
        concepts: answer(plan.concepts, fields),
        questions: answer(plan.questions, fields),
      };
    else if (kind === "review") result = answer(plan.review, fields);
    else if (kind === "correct") {
      const round = self.__calls.filter((c) => c.kind === "correct").length - 1;
      const rules = Array.isArray(plan.correct && plan.correct[0])
        ? plan.correct
        : (plan.correctRounds || [])[round];
      result = answer(rules, fields);
    } else if (kind === "pick") result = answer(plan.pick, fields);
    else if (kind === "consolidate") result = plan.consolidate || {};
    else if (kind === "enrich") result = plan.enrich || {};
    else if (kind === "suggest") result = plan.suggest || "";
    if (plan.malformed) result = "this is not json at all";

    const text = typeof result === "string" ? result : JSON.stringify(result);
    if (provider === "anthropic")
      return json(200, {
        content:
          body.tools && typeof result !== "string"
            ? [{ type: "tool_use", name: "result", input: result }]
            : [{ type: "text", text }],
      });
    return json(200, { choices: [{ message: { content: text } }] });
  };
}

class Harness {
  async start() {
    const { chromium } = loadPlaywright();
    this.stopServers = startServers();
    this.extDir = buildExtension();
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), "aiff-profile-"));
    this.context = await chromium.launchPersistentContext(this.profile, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${this.extDir}`,
        `--load-extension=${this.extDir}`,
        "--host-resolver-rules=MAP *.test 127.0.0.1",
      ],
    });
    let sw = this.context.serviceWorkers()[0];
    if (!sw) sw = await this.context.waitForEvent("serviceworker");
    this.extensionId = new URL(sw.url()).host;
    await this.sw();
    return this;
  }

  async stop() {
    if (this.context) await this.context.close();
    if (this.stopServers) this.stopServers();
    for (const d of [this.extDir, this.profile])
      if (d) fs.rmSync(d, { recursive: true, force: true });
  }

  // The live worker, after background.js finished composing.
  async sw() {
    let worker = this.context
      .serviceWorkers()
      .find((w) => w.url().includes(this.extensionId || "chrome-extension://"));
    if (!worker) worker = await this.context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      for (let i = 0; i < 100 && !(self.AIFF && self.AIFF.MessageRouter); i++)
        await new Promise((r) => setTimeout(r, 50));
    });
    return worker;
  }

  async swEval(fn, arg) {
    return (await this.sw()).evaluate(fn, arg);
  }

  // Fresh state: storage, registered scripts, fake AI calls, open tabs.
  async reset({ settings = {}, memory = {}, fieldMap = {}, blocks = {}, plan = {} } = {}) {
    for (const p of this.context.pages()) await p.close();
    await this.swEval(
      async (state) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(state);
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        if (scripts.length)
          await chrome.scripting.unregisterContentScripts({
            ids: scripts.map((s) => s.id),
          });
        self.__calls = [];
      },
      { settings, memory, fieldMap, blocks },
    );
    await this.fakeAI(plan);
  }

  async fakeAI(plan) {
    await this.swEval(installFakeAI, plan);
  }

  async calls(kind) {
    const all = await this.swEval(() => self.__calls || []);
    return kind ? all.filter((c) => c.kind === kind) : all;
  }

  async storage(key) {
    return this.swEval((k) => chrome.storage.local.get(k).then((d) => d[k]), key);
  }

  async open(url) {
    const page = await this.context.newPage();
    await page.goto(url);
    return page;
  }

  // By URL when the extension may read it, else the newest active tab (an
  // extension or chrome:// page hides its URL without the "tabs" permission).
  async tabId(url) {
    return this.swEval(async (u) => {
      // The newest tab wins when a test opens the same URL twice.
      const byUrl = (await chrome.tabs.query({})).filter((t) => t.url === u);
      if (byUrl.length) return Math.max(...byUrl.map((t) => t.id));
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return active.id;
    }, url);
  }

  // An extension page whose chrome.permissions.request answers `grant` and is
  // recorded; the real prompt cannot be clicked from a script.
  async extensionPage(file, { tabId, grant = true } = {}) {
    const page = await this.context.newPage();
    await page.addInitScript(
      ({ tabId, grant }) => {
        window.__permCalls = [];
        chrome.permissions.request = async (req) => {
          window.__permCalls.push(req);
          return grant;
        };
        chrome.permissions.remove = async () => true;
        if (tabId != null) {
          const query = chrome.tabs.query.bind(chrome.tabs);
          chrome.tabs.query = async (q) =>
            q && q.active ? [await chrome.tabs.get(tabId)] : query(q);
        }
      },
      { tabId, grant },
    );
    await page.goto(`chrome-extension://${this.extensionId}/${file}`);
    return page;
  }

  // The toolbar popup, pointed at the tab showing `url`.
  async popup(url, opts = {}) {
    return this.extensionPage("popup.html", {
      ...opts,
      tabId: await this.tabId(url),
    });
  }

  async popupFill(url, opts) {
    const popup = await this.popup(url, opts);
    await popup.click("#fill");
    await popup.waitForFunction(
      () => !/^Filling/.test(document.querySelector("#status").textContent),
      null,
      { timeout: 20000 },
    );
    return popup;
  }
}

// Page-side helpers.
const ui = {
  toast: (page) =>
    page.evaluate(() => {
      const t = document.querySelector('[data-aiff-ui][role="status"]');
      return t ? t.textContent : "";
    }),
  panelText: (page) =>
    page.evaluate(() => {
      const p = [...document.querySelectorAll("[data-aiff-ui]")].find(
        (e) => e.getAttribute("role") !== "status" && e.style.position === "fixed",
      );
      return p ? p.innerText : "";
    }),
  waitPanel: (page, text) =>
    page.waitForFunction(
      (t) =>
        [...document.querySelectorAll("[data-aiff-ui]")].some(
          (e) => e.style.position === "fixed" && e.innerText.includes(t),
        ),
      text,
      { timeout: 15000 },
    ),
  clickPanel: (page, label) =>
    page
      .locator("[data-aiff-ui] button", { hasText: label })
      .first()
      .click(),
  // Preview rows: label, value control, source badge, checkbox.
  previewRows: (page) =>
    page.evaluate(() => {
      const panel = [...document.querySelectorAll("[data-aiff-ui]")].find((e) =>
        e.innerText.startsWith("Autofill preview"),
      );
      if (!panel) return [];
      return [...panel.querySelectorAll('input[type="checkbox"]')].map((cb) => {
        const row = cb.parentElement;
        const control = row.querySelector("textarea, input:not([type=checkbox])");
        return {
          label: row.querySelector("div > div").textContent,
          value: control.value,
          control: control.tagName.toLowerCase(),
          source: row.querySelector("span").textContent,
        };
      });
    }),
  values: (page, selectors) =>
    page.evaluate((sels) => {
      const out = {};
      for (const [name, sel] of Object.entries(sels)) {
        const els = [...document.querySelectorAll(sel)];
        const el = els[0];
        if (!el) out[name] = null;
        else if (el.type === "radio" || el.type === "checkbox")
          out[name] = els.filter((e) => e.checked).map((e) => e.value).join(",");
        else if (el.isContentEditable) out[name] = el.innerText;
        else out[name] = el.value;
      }
      return out;
    }, selectors),
};

module.exports = { Harness, ui, SHOP, FORMS, installFakeAI };
