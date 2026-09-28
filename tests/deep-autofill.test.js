// Deep end-to-end autofill test (real browser, real extension code).
//
// Runs the REAL content script + REAL background services + REAL stores against
// the rendered test-form.html. Only two things are faked:
//   - chrome.* (storage = in-memory KB; runtime.sendMessage = a bus that routes
//     content -> the real background MessageRouter, exactly like the extension);
//   - window.fetch (the LLM network call), returning KB-grounded answers and a
//     question for the one field the knowledge base can't answer.
//
// It asserts:
//   1. fills come from the actual knowledge base (memory-path fields equal the
//      exact seeded values; change the KB and the fill changes);
//   2. missing info -> the plugin asks; after the user provides it, a second
//      autofill REUSES it (the mock LLM still won't answer that field, so a fill
//      can only come from the saved knowledge base);
//   3. every field is filled, including radio / checkbox / select controls.
//
// Requires Playwright (`npm i -D playwright`). Serve the repo first, e.g.
//   python3 -m http.server 8731
// then: node tests/deep-autofill.test.js
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:8731";

// The injected page program: wires the fake worker, seeds the KB, loads the real
// extension scripts, and exposes helpers on window for the test to drive.
async function setup() {
  // --- in-memory storage = the knowledge base -------------------------------
  const store = {
    settings: {
      providerKeys: { anthropic: "test-key" },
      defaultProvider: "anthropic",
      autoFill: true, // auto-apply (no manual preview) so fills happen directly
      sites: {},
    },
    // Learned values (the knowledge base), keyed by canonical concept.
    memory: {
      full_name: { value: "Alex Rivera" },
      first_name: { value: "Alex" },
      last_name: { value: "Rivera" },
      email: { value: "alex.rivera@example.com" },
      phone: { value: "+1 415 555 0148" },
      organization: { value: "Acme Search" },
      address_line1: { value: "500 Market Street" },
      address_line2: { value: "Suite 400" },
      city: { value: "San Francisco" },
      state: { value: "California" },
      postal_code: { value: "94105" },
      country: { value: "United States" },
      linkedin: { value: "https://linkedin.com/in/alexrivera" },
      github: { value: "https://github.com/alexrivera" },
      website: { value: "https://alexrivera.dev" },
    },
    fieldMap: {},
    blocks: {},
  };
  window.__store = store;
  window.__sent = [];

  // --- chrome stub: storage + a message bus to the real background router ----
  const listeners = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (msg) =>
        new Promise((resolve) => {
          window.__sent.push(msg.action);
          let done = false;
          const sendResponse = (r) => {
            if (!done) {
              done = true;
              resolve(r);
            }
          };
          for (const fn of listeners) {
            try {
              fn(msg, {}, sendResponse);
            } catch (e) {
              /* a listener that isn't for this action */
            }
          }
          setTimeout(() => sendResponse(undefined), 0);
        }),
    },
    storage: {
      local: {
        get: (key) => Promise.resolve({ [key]: store[key] }),
        set: (obj) => {
          Object.assign(store, obj);
          return Promise.resolve();
        },
      },
    },
    scripting: {
      registerContentScripts: () => Promise.resolve(),
      unregisterContentScripts: () => Promise.resolve(),
    },
    permissions: {
      request: () => Promise.resolve(true),
      remove: () => Promise.resolve(true),
    },
  };

  // --- mock the LLM endpoint -------------------------------------------------
  // The salary field is deliberately left unanswered (no question key for it on
  // the second pass either) so that any later fill of it proves KB reuse.
  function autofillAnswers() {
    return {
      values: {
        work_auth: "Yes",
        work_mode: "Remote",
        skills: "Python, Go, Elasticsearch",
        relocate: "yes",
        role: "Backend",
        langs: "English",
        cover_letter: "Dear hiring team, I build production semantic search.",
        experience_search:
          "Built OpenSearch semantic search (1.2B vectors) and a RAG pipeline at 3k QPS.",
        planned_time_off: "None planned.",
        best_candidate:
          "Deep production retrieval experience with measurable wins.",
        third_person_pitch: "Alex Rivera is a senior search engineer.",
        opaque_title_8842001: "Senior Search Engineer",
        opaque_company_8842002: "Acme Search",
      },
      concepts: {
        work_auth: "work_authorization",
        work_mode: "work_mode",
        skills: "skills",
        relocate: "willing_to_relocate",
        cover_letter: "cover_letter",
        experience_search: "search_experience",
        planned_time_off: "planned_time_off",
        best_candidate: "candidacy",
        third_person_pitch: "pitch",
        opaque_title_8842001: "job_title",
        opaque_company_8842002: "organization",
        desired_annual_salary_usd: "desired_salary",
      },
      questions: {
        desired_annual_salary_usd: "What is your desired annual salary (USD)?",
      },
    };
  }
  window.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    // The Anthropic provider sends system as cacheable text blocks.
    const sys = [].concat(body.system || "").map((b) => b.text ?? b).join("");
    const hasTools = !!body.tools;
    let input = {};
    let text = "";
    if (/help a user fill web forms/.test(sys)) input = autofillAnswers();
    else if (/review a web form/.test(sys))
      input = {}; // no corrections
    else if (/fix web-form fields/.test(sys))
      input = {}; // no validation fixes
    else if (/match a desired value/.test(sys)) text = ""; // no option-pick needed
    const content = hasTools
      ? [{ type: "tool_use", input }]
      : [{ type: "text", text }];
    return { ok: true, status: 200, json: async () => ({ content }) };
  };

  // --- load the real extension scripts --------------------------------------
  window.importScripts = () => {}; // background.js calls this; files already loaded
  window.__aiffStarted = true; // suppress content.js auto-start; we drive the app
  const bust = "?b=" + Math.random().toString(36).slice(2);
  const load = (s) =>
    new Promise((res, rej) => {
      const e = document.createElement("script");
      e.src = s + bust;
      e.onload = () => res(1);
      e.onerror = () => rej(new Error("load " + s));
      document.head.appendChild(e);
    });
  await load("shared.js");
  await load("providers.js");
  await load("formdom.js");
  await load("background.js"); // composition root registers the real MessageRouter
  await load("content.js");

  window.__app = new window.AIFF.ContentApp(new window.AIFF.SettingsStore());
  return { bgReady: typeof window.AIFF.AutofillService === "function" };
}

// Read the live DOM state of every scanned field, by canonical key.
function readForm() {
  const out = {};
  for (const f of new window.AIFF.FormScanner().fields()) {
    const info = f.describe();
    out[info.key] = {
      type: info.type,
      sensitive: f.isSensitive(),
      value: String(f.value || ""),
    };
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/test-form.html`);
  await page.evaluate(setup);

  const fails = [];
  const ok = (name, cond, detail) => {
    if (!cond) fails.push(`${name}${detail ? " — " + detail : ""}`);
  };

  // === Round 1: autofill from the knowledge base ============================
  await page.evaluate(() => window.__app._autofill());
  const r1 = await page.evaluate(readForm);

  // (1) memory-path fills equal the exact seeded knowledge-base values.
  const kb = {
    email: "alex.rivera@example.com",
    tel: "+1 415 555 0148",
    given_name: "Alex",
    family_name: "Rivera",
    organization: "Acme Search",
    postal_code: "94105",
    country_name: "United States",
    linkedin_profile_url: "https://linkedin.com/in/alexrivera",
  };
  for (const [k, v] of Object.entries(kb))
    ok(
      `KB fill ${k}`,
      r1[k] && r1[k].value === v,
      `got "${r1[k] && r1[k].value}"`,
    );

  // (3) radio / checkbox / select controls are filled.
  ok(
    "radio work_auth",
    r1.work_auth && r1.work_auth.value === "Yes",
    r1.work_auth && r1.work_auth.value,
  );
  ok(
    "radio work_mode",
    r1.work_mode && r1.work_mode.value === "Remote",
    r1.work_mode && r1.work_mode.value,
  );
  ok(
    "checkbox group skills",
    r1.skills && /Python/.test(r1.skills.value) && /Go/.test(r1.skills.value),
    r1.skills && r1.skills.value,
  );
  ok(
    "checkbox relocate",
    r1.relocate && /relocate/i.test(r1.relocate.value),
    r1.relocate && r1.relocate.value,
  );
  ok(
    "select country",
    r1.country && r1.country.value === "United States",
    r1.country && r1.country.value,
  );
  ok(
    "select role",
    r1.role && r1.role.value === "Backend",
    r1.role && r1.role.value,
  );

  // essays / contenteditable / unlabeled all filled.
  for (const k of [
    "experience_search",
    "planned_time_off",
    "best_candidate",
    "third_person_pitch",
    "cover_letter",
    "opaque_title_8842001",
  ])
    ok(`filled ${k}`, r1[k] && r1[k].value.length > 0, "empty");

  // sensitive fields never filled.
  for (const [k, f] of Object.entries(r1))
    if (f.sensitive)
      ok(`sensitive empty ${k}`, f.value === "", `got "${f.value}"`);

  // (2a) the field with no KB data is NOT filled, and is asked.
  ok(
    "salary empty round1",
    r1.desired_annual_salary_usd && r1.desired_annual_salary_usd.value === "",
    r1.desired_annual_salary_usd && r1.desired_annual_salary_usd.value,
  );
  const asked = await page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-aiff-ui]")].find(
      (e) => /details needed/i.test(e.textContent) && e.querySelector("input"),
    );
    return p ? p.textContent : "";
  });
  ok("salary asked", /desired annual salary/i.test(asked), asked.slice(0, 80));

  // === Round 2: user provides the missing info via the ask panel ===========
  const saved = await page.evaluate(() => {
    const panel = [...document.querySelectorAll("[data-aiff-ui]")].find(
      (e) => /details needed/i.test(e.textContent) && e.querySelector("input"),
    );
    for (const row of panel.children) {
      const input = row.querySelector("input");
      if (input && /salary/i.test(row.textContent)) input.value = "$215,000";
    }
    [...panel.querySelectorAll("button")]
      .find((b) => /fill & remember/i.test(b.textContent))
      .click();
    return new Promise((res) =>
      setTimeout(
        () =>
          res({
            memory: window.__store.memory,
            fieldMap: window.__store.fieldMap,
          }),
        80,
      ),
    );
  });
  ok(
    "answer saved under concept",
    saved.memory.desired_salary &&
      saved.memory.desired_salary.value === "$215,000",
    JSON.stringify(saved.memory.desired_salary),
  );
  ok(
    "field-map learned the concept",
    saved.fieldMap["desired_annual_salary_usd|text"] === "desired_salary",
    JSON.stringify(saved.fieldMap),
  );

  // === Round 3: autofill again — the new info must be reused ================
  // Clear the salary field, then refill. The mock LLM still won't answer it, so
  // any value can only come from the saved knowledge base.
  await page.evaluate(() => {
    document.querySelector('input[name="comp_expectation_9001"]').value = "";
    return window.__app._autofill();
  });
  const r3 = await page.evaluate(readForm);
  ok(
    "salary reused from KB round3",
    r3.desired_annual_salary_usd &&
      r3.desired_annual_salary_usd.value === "$215,000",
    r3.desired_annual_salary_usd && r3.desired_annual_salary_usd.value,
  );

  // --- report ---------------------------------------------------------------
  const filled = Object.values(r1).filter((f) => f.value).length;
  console.log(
    `Fields scanned: ${Object.keys(r1).length}, filled round 1: ${filled}`,
  );
  if (fails.length) {
    console.log(`\n${fails.length} FAILED:`);
    for (const f of fails) console.log("  - " + f);
  } else {
    console.log("ALL ASSERTIONS PASSED");
  }
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
