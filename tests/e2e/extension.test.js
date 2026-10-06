// End-to-end checks of every feature in a real Chromium with the real
// extension loaded. The AI is a scripted fake (see harness.js), so this costs
// nothing and runs offline. Run: node --test tests/e2e/extension.test.js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Harness, ui, SHOP, FORMS } = require("./harness");

const h = new Harness();
before(() => h.start(), { timeout: 60000 });
after(() => h.stop());

const JOB = `${SHOP}/job.html`;
const KEYED = {
  providerKeys: { anthropic: "test-key" },
  defaultProvider: "anthropic",
};
const MEMORY = {
  first_name: { value: "Alex", count: 3, lastUsed: 1 },
  last_name: { value: "Rivera", count: 3, lastUsed: 1 },
  email: { value: "alex@example.com", count: 3, lastUsed: 1 },
  phone: { value: "+1 415 555 0148", count: 2, lastUsed: 1 },
  country: { value: "USA", count: 1, lastUsed: 1 },
  city: { value: "Austin", count: 1, lastUsed: 1 },
  postal_code: { value: "78701", count: 1, lastUsed: 1 },
};
const COVER = "Dear Acme,\n\nI build payments systems in Go.";
const JOB_PLAN = {
  values: [
    ["authorized", "Yes"],
    ["languages", "Go, Python"],
    ["job alerts", "yes"],
    ["Referral", "abc123"],
    ["Cover letter", COVER],
    ["Why Acme", "Payments at scale."],
  ],
  questions: [
    ["start date", "When can you start?"],
    ["Notice period", "What is your notice period?"],
  ],
  concepts: [
    ["start date", "start_date"],
    ["Notice period", "notice_period"],
  ],
  pick: [["Country", "United States"]],
  correctRounds: [[["Referral", "ABC-123"]]],
};
const JOB_FIELDS = {
  first: "#fn",
  last: "#ln",
  email: "#em",
  phone: "#ph",
  country: "#country",
  password: "#pw",
  ssn: "#ssn",
  auth: "input[name=auth]",
  langs: "input[name=langs]",
  alerts: "input[name=alerts]",
  referral: "#ref",
  cover: "#cover",
  why: "#why",
  start: "#start",
  notice: "#notice",
};

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const previewPanel = (page) =>
  page.locator("[data-aiff-ui]").filter({ hasText: "Autofill preview" });
const previewRow = (page, label) =>
  previewPanel(page)
    .locator(":scope > div")
    .filter({ has: page.locator("div", { hasText: new RegExp(`^${label}$`) }) });

async function registerSite(host) {
  await h.swEval((host) => siteScripts.register(host), host);
}

// ---------------------------------------------------------------- A. trigger

test("A1 popup button opens the preview and reports the count", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  const popup = await h.popupFill(JOB);
  const rows = await ui.previewRows(page);
  assert.equal(
    await popup.textContent("#status"),
    `Review the preview on the page (${rows.length} fields).`,
  );
  assert.equal(rows.length, 11);
});

test("A2 popup toggle turns on auto-fill: access asked, script registered, fills on load", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  await h.open(JOB);
  const popup = await h.popup(JOB);
  await popup.waitForFunction(() => document.querySelector("#meta").textContent);
  await popup.check("#auto");
  await settle();
  assert.deepEqual(await popup.evaluate(() => window.__permCalls), [
    { origins: ["*://shop.test/*"] },
  ]);
  const scripts = await h.swEval(() =>
    chrome.scripting.getRegisteredContentScripts(),
  );
  assert.deepEqual(
    scripts.map((s) => [s.id, s.allFrames]),
    [["site-shop.test", true]],
  );
  assert.equal((await h.storage("settings")).sites["shop.test"].autoFill, true);

  const page = await h.open(JOB);
  await page.waitForFunction(() => document.querySelector("#ref").value === "ABC-123");
  assert.equal(await page.inputValue("#fn"), "Alex");
  assert.equal(await ui.panelText(page).then((t) => t.includes("Autofill preview")), false);
  await page.waitForFunction(() =>
    /^Filled/.test(document.querySelector('[data-aiff-ui][role="status"]')?.textContent),
  );
  assert.match(await ui.toast(page), /^Filled \d+ of 13 fields\.$/);
  assert.equal((await h.calls("review")).length, 1);

  await popup.uncheck("#auto");
  await settle();
  assert.deepEqual(
    await h.swEval(() => chrome.scripting.getRegisteredContentScripts()),
    [],
  );
  assert.equal((await h.storage("settings")).sites["shop.test"].autoFill, false);
});

test("A2b auto-fill toggle stays off when access is refused", async () => {
  await h.reset({ settings: KEYED });
  await h.open(JOB);
  const popup = await h.popup(JOB, { grant: false });
  await popup.waitForFunction(() => document.querySelector("#meta").textContent);
  await popup.click("#auto");
  await settle();
  assert.equal(await popup.isChecked("#auto"), false);
  assert.equal(await popup.textContent("#status"), "Auto-fill needs access to this site.");
});

test("A3 wizard: fields added after load are filled too", async () => {
  await h.reset({
    settings: { ...KEYED, sites: { "shop.test": { autoFill: true } } },
    memory: MEMORY,
  });
  await registerSite("shop.test");
  const page = await h.open(`${SHOP}/wizard.html`);
  await page.waitForFunction(() => document.querySelector("#fn").value === "Alex");
  await page.click("#next");
  await page.waitForFunction(
    () => document.querySelector("#zip") && document.querySelector("#zip").value,
    null,
    { timeout: 10000 },
  );
  assert.deepEqual(await ui.values(page, { city: "#city", zip: "#zip" }), {
    city: "Austin",
    zip: "78701",
  });
});

test("A4 popup click during an auto-fill run shares the run instead of failing", async () => {
  await h.reset({
    settings: { ...KEYED, sites: { "shop.test": { autoFill: true } } },
    memory: MEMORY,
    plan: { ...JOB_PLAN, delayMs: 1500 },
  });
  await registerSite("shop.test");
  await h.open(JOB);
  const popup = await h.popupFill(JOB);
  assert.match(await popup.textContent("#status"), /^Filled \d+\/13 fields \(AI \+ saved values\)\.$/);
  assert.equal((await h.calls("autofill")).length, 1);
});

test("A5 popup on a page it cannot run on says so", async () => {
  await h.reset({ settings: KEYED });
  const url = `chrome-extension://${h.extensionId}/options.html`;
  await h.open(url);
  const popup = await h.popupFill(url);
  assert.equal(
    await popup.textContent("#status"),
    "Can't run on this page (try a normal website).",
  );
});

// ----------------------------------------------------------------- B. frames

test("B1 popup fills a cross-origin and a same-origin iframe", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY });
  const url = `${SHOP}/embed-granted.html`;
  const page = await h.open(url);
  const popup = await h.popupFill(url);
  assert.equal(
    await popup.textContent("#status"),
    "Review the preview on the page (6 fields).",
  );
  for (const host of [/forms\.test/, /shop\.test:8731\/mini/]) {
    const frame = page.frame({ url: host });
    await frame.locator("[data-aiff-ui] button", { hasText: "Fill selected" }).click();
    await frame.waitForFunction(() => document.querySelector("#city").value);
    assert.deepEqual(
      await ui.values(frame, { email: "#em", phone: "#ph", city: "#city" }),
      { email: "alex@example.com", phone: "+1 415 555 0148", city: "Austin" },
    );
  }
});

test("B2 blocked iframe: popup offers access for exactly that origin", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY });
  const url = `${SHOP}/embed-blocked.html`;
  await h.open(url);
  const popup = await h.popupFill(url, { grant: false });
  // The offer is appended after the fill result, by a second injection.
  await popup.waitForFunction(() =>
    /embedded form from blocked\.test\.$/.test(document.querySelector("#status").textContent),
  );
  assert.equal(
    await popup.textContent("#status"),
    "Nothing to fill. Part of this page is an embedded form from blocked.test.",
  );
  assert.equal(await popup.isVisible("#allow-frames"), true);
  await popup.click("#allow-frames");
  await settle();
  assert.deepEqual(await popup.evaluate(() => window.__permCalls), [
    { origins: ["http://blocked.test:8732/*"] },
  ]);
  assert.equal(
    await popup.textContent("#status"),
    "The embedded form needs access to fill it.",
  );
});

test("B3 known gap: auto-fill site fills its own iframes on load, not a cross-origin one", async () => {
  await h.reset({
    settings: { ...KEYED, sites: { "shop.test": { autoFill: true } } },
    memory: MEMORY,
  });
  await registerSite("shop.test");
  const page = await h.open(`${SHOP}/embed-granted.html`);
  const same = page.frame({ url: /shop\.test:8731\/mini/ });
  await same.waitForFunction(() => document.querySelector("#city").value === "Austin");
  await settle(1500);
  const cross = page.frame({ url: /forms\.test/ });
  assert.equal(await cross.inputValue("#city"), "");
});

// ------------------------------------------- C/D/E. field kinds, sources, flow

test("C1+E3+E4 full job form: every field kind, option pick, correction, ask panel", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  await ui.clickPanel(page, "Fill selected");
  await ui.waitPanel(page, "A few details needed");

  assert.deepEqual(await ui.values(page, JOB_FIELDS), {
    first: "Alex",
    last: "Rivera",
    email: "alex@example.com",
    phone: "+1 415 555 0148",
    country: "United States", // memory said "USA": resolved by the pick call
    password: "",
    ssn: "",
    auth: "yes",
    langs: "go,python",
    alerts: "on",
    referral: "ABC-123", // AI said "abc123": fixed by the correct call
    cover: COVER, // paragraphs survive the preview textarea
    why: "Payments at scale.",
    start: "",
    notice: "",
  });
  const picks = await h.calls("pick");
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0].labels, ["Country"]);
  assert.ok((await h.calls("correct"))[0].labels.includes("Referral code"));

  // Ask panel: the AI's own questions; fixed choices get the field's options.
  const asked = await ui.panelText(page);
  assert.match(asked, /When can you start\?/);
  assert.match(asked, /What is your notice period\?/);
  const panel = page.locator("[data-aiff-ui]").filter({ hasText: "A few details needed" });
  assert.deepEqual(
    await panel.locator("select option").allTextContents(),
    ["", "Immediately", "2 weeks", "1 month"],
  );
  await panel.locator("input").fill("2026-11-02");
  await panel.locator("select").selectOption("2 weeks");
  await ui.clickPanel(page, "Fill & remember");
  await settle();
  assert.deepEqual(await ui.values(page, { start: "#start", notice: "#notice" }), {
    start: "2026-11-02",
    notice: "2 weeks",
  });
  const memory = await h.storage("memory");
  assert.equal(memory.start_date.value, "2026-11-02");
  assert.equal(memory.notice_period.value, "2 weeks");
  assert.equal(memory.ssn, undefined);
});

test("C2 a second run never overwrites what the user edited", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  await ui.clickPanel(page, "Fill selected");
  await ui.waitPanel(page, "A few details needed");
  await ui.clickPanel(page, "Skip");
  await page.fill("#fn", "Al");
  await page.fill("#ln", "");
  await h.popupFill(JOB);
  const labels = (await ui.previewRows(page)).map((r) => r.label);
  assert.ok(labels.includes("Last name"));
  assert.ok(!labels.includes("First name"));
  assert.equal(await page.inputValue("#fn"), "Al");
});

test("C3 sensitive fields are never sent to the AI", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  await h.open(JOB);
  await h.popupFill(JOB);
  const labels = (await h.calls("autofill")).flatMap((c) => c.labels);
  assert.ok(!labels.includes("Social security number"));
});

test("C4 a select's placeholder option is never offered as an answer", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  await h.open(JOB);
  await h.popupFill(JOB);
  const notice = (await h.calls("autofill"))[0].fields.find((f) => f.label === "Notice period");
  assert.deepEqual(notice.options, ["Immediately", "2 weeks", "1 month"]);
});

test("C5 a field's question text never comes from the field before it", async () => {
  await h.reset({ settings: KEYED, plan: {} });
  await h.open(JOB);
  await h.popupFill(JOB);
  const fields = (await h.calls("autofill"))[0].fields;
  const byLabel = Object.fromEntries(fields.map((f) => [f.label, f]));
  assert.equal(byLabel.Email.question, undefined);
  assert.notEqual(byLabel["Referral code"].context, "Which languages do you use?");
});

test("C6 one confirmed fill counts as one use", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  await ui.clickPanel(page, "Fill selected");
  await settle(1500);
  assert.equal((await h.storage("memory")).first_name.count, 4);
});

test("D1 short fields with saved values fill with zero AI calls", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY });
  const url = `${SHOP}/mini.html`;
  const page = await h.open(url);
  await h.popupFill(url);
  const rows = await ui.previewRows(page);
  assert.deepEqual(rows.map((r) => r.source), ["memory", "memory", "memory"]);
  assert.equal((await h.calls()).length, 0);
});

test("D2 a saved essay is re-written by the AI, and used only if the AI returns nothing", async () => {
  const memory = { ...MEMORY, cover_letter: { value: "Old essay for Globex" } };
  await h.reset({ settings: KEYED, memory, plan: JOB_PLAN });
  let page = await h.open(JOB);
  await h.popupFill(JOB);
  let cover = (await ui.previewRows(page)).find((r) => r.label === "Cover letter");
  assert.deepEqual([cover.value, cover.source], [COVER, "AI"]);
  assert.match((await h.calls("autofill"))[0].user, /cover_letter: Old essay for Globex/);

  await h.reset({ settings: KEYED, memory, plan: { values: [] } });
  page = await h.open(JOB);
  await h.popupFill(JOB);
  cover = (await ui.previewRows(page)).find((r) => r.label === "Cover letter");
  assert.deepEqual([cover.value, cover.source], ["Old essay for Globex", "memory"]);
});

test("D3 without an API key only saved values fill and no call is made", async () => {
  await h.reset({ settings: {}, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  const popup = await h.popupFill(JOB);
  assert.match(await popup.textContent("#meta"), /no anthropic key set, only saved values will fill/);
  const rows = await ui.previewRows(page);
  assert.ok(rows.length > 0 && rows.every((r) => r.source === "memory"));
  assert.equal((await h.calls()).length, 0);
});

test("D4 essays go to the long-form model with 8192 tokens, short fields stay on the default", async () => {
  await h.reset({
    settings: { ...KEYED, defaultModel: "small-model", longFormModel: "big-model" },
    memory: MEMORY,
    plan: JOB_PLAN,
  });
  await h.open(JOB);
  await h.popupFill(JOB);
  const calls = await h.calls("autofill");
  const byModel = Object.fromEntries(calls.map((c) => [c.model, c]));
  assert.deepEqual(Object.keys(byModel).sort(), ["big-model", "small-model"]);
  assert.deepEqual(byModel["big-model"].labels.sort(), ["Cover letter", "Why Acme?"]);
  assert.equal(byModel["big-model"].maxTokens, 8192);
  assert.equal(byModel["small-model"].maxTokens, 2048);
});

test("E1 preview: uncheck, edit, block and hostile page CSS", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  let page = await h.open(JOB);
  await h.popupFill(JOB);

  const box = await previewRow(page, "Phone").locator("input[type=checkbox]").boundingBox();
  assert.ok(box.width < 40, `checkbox stretched by page CSS: ${box.width}px`);
  const valueBox = await previewRow(page, "Phone").locator("input:not([type=checkbox])").boundingBox();
  assert.ok(valueBox.width > 150, `value squeezed: ${valueBox.width}px`);
  assert.equal(
    await previewRow(page, "Cover letter").locator("textarea").count(),
    1,
  );

  await previewRow(page, "Phone").locator("input[type=checkbox]").uncheck();
  await previewRow(page, "First name").locator("input:not([type=checkbox])").fill("Alexander");
  await previewRow(page, "Email").locator("button").click();
  await ui.clickPanel(page, "Fill selected");
  await settle();
  assert.deepEqual(await ui.values(page, { first: "#fn", phone: "#ph", email: "#em" }), {
    first: "Alexander",
    phone: "",
    email: "",
  });
  assert.equal((await h.storage("memory")).first_name.value, "Alexander");
  assert.equal((await h.storage("blocks"))["shop.test"].email, true);

  page = await h.open(JOB);
  await h.popupFill(JOB);
  const labels = (await ui.previewRows(page)).map((r) => r.label);
  assert.ok(!labels.includes("Email"), "blocked field proposed again");
  assert.ok(labels.includes("Phone"));
});

test("E1b Cancel fills nothing and learns nothing", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  await ui.clickPanel(page, "Cancel");
  await settle();
  assert.equal(await page.inputValue("#fn"), "");
  assert.deepEqual(await h.storage("memory"), MEMORY);
});

test("E2 auto-fill mode: the review pass corrects AI answers before they are saved", async () => {
  await h.reset({
    settings: { ...KEYED, sites: { "shop.test": { autoFill: true } } },
    memory: MEMORY,
    plan: { ...JOB_PLAN, values: [["languages", "Go"]], review: [["languages", "Go, Python"]] },
  });
  await registerSite("shop.test");
  const page = await h.open(JOB);
  await page.waitForFunction(() =>
    document.querySelectorAll("input[name=langs]:checked").length === 2,
  );
  const review = (await h.calls("review"))[0];
  assert.deepEqual(review.labels, ["Which languages do you use?"]);
  assert.equal(review.fields[0].currentValue, "Go");
  await settle();
  assert.equal((await h.storage("memory")).langs.value, "Go, Python");
});

test("E3b the correction loop stops after two rounds", async () => {
  await h.reset({
    settings: KEYED,
    memory: MEMORY,
    plan: { ...JOB_PLAN, correctRounds: [], correct: [["Referral", "still-bad"]] },
  });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  await ui.clickPanel(page, "Fill selected");
  await ui.waitPanel(page, "A few details needed");
  assert.equal((await h.calls("correct")).length, 2);
  assert.equal(await page.inputValue("#ref"), "still-bad");
});

test("E4b open questions are answered in a textarea", async () => {
  await h.reset({
    settings: KEYED,
    plan: {
      questions: [["About you", "Tell us about yourself"]],
      concepts: [["About you", "bio"]],
    },
  });
  const url = `${SHOP}/contact.html`;
  const page = await h.open(url);
  await h.popupFill(url);
  await ui.waitPanel(page, "Tell us about yourself");
  const panel = page.locator("[data-aiff-ui]").filter({ hasText: "A few details needed" });
  await panel.locator("textarea").fill("Line one\nLine two");
  await ui.clickPanel(page, "Fill & remember");
  await settle();
  assert.equal(await page.inputValue("#bio"), "Line one\nLine two");
  assert.equal((await h.storage("memory")).bio.value, "Line one\nLine two");
});

test("E5 toast shows progress, then the error; an AI failure fills nothing", async () => {
  await h.reset({
    settings: KEYED,
    memory: MEMORY,
    plan: { delayMs: 1200, fail: { status: 401, text: "invalid x-api-key" } },
  });
  const page = await h.open(JOB);
  const popup = await h.popup(JOB);
  await popup.click("#fill");
  await page.waitForFunction(() =>
    /Filling 13 fields/.test(document.querySelector('[data-aiff-ui][role="status"]')?.textContent),
  );
  await popup.waitForFunction(() => /^Error/.test(document.querySelector("#status").textContent));
  assert.equal(
    await popup.textContent("#status"),
    "Error: AI request failed (401): invalid x-api-key",
  );
  assert.equal(await ui.toast(page), "Autofill failed: AI request failed (401): invalid x-api-key");
  // Saved values are lost with the AI error: the whole proposal fails.
  assert.equal(await page.inputValue("#fn"), "");
});

// --------------------------------------------------------------- F. learning

test("F2 typed values are captured; passwords, sensitive and 1-char values are not", async () => {
  await h.reset({ settings: KEYED });
  await registerSite("shop.test");
  const page = await h.open(`${SHOP}/contact.html`);
  await settle();
  await page.fill("#em", "pat@example.org");
  await page.fill("#org", "Initech");
  await page.fill("#mi", "Q");
  await page.fill("#pw", "hunter22");
  await page.fill("#ssn", "123-45-6789");
  await page.click("h1");
  await settle(1000);
  const memory = await h.storage("memory");
  assert.deepEqual(Object.keys(memory).sort(), ["email", "organization"]);
  assert.equal(memory.email.domain, "shop.test");
});

test("F5 typing inside the extension's own panels is never captured", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: JOB_PLAN });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  await ui.clickPanel(page, "Fill selected");
  await ui.waitPanel(page, "A few details needed");
  const panel = page.locator("[data-aiff-ui]").filter({ hasText: "A few details needed" });
  await panel.locator("input").focus();
  await settle();
  assert.equal(
    await page.locator("[data-aiff-ui] button", { hasText: "✨ AI" }).isVisible(),
    false,
    "chip offered on the extension's own panel",
  );
  // Typed (trusted) input, as a person answers the panel.
  await panel.locator("input").pressSequentially("2026-11-02");
  await panel.locator("select").selectOption("2 weeks");
  await ui.clickPanel(page, "Fill & remember");
  await settle(1500);
  const junk = Object.keys(await h.storage("memory")).filter((k) => k.startsWith("field_"));
  assert.deepEqual(junk, []);
});

test("F3 import saves values already on the page, never secrets", async () => {
  await h.reset({ settings: KEYED });
  const url = `${SHOP}/prefilled.html`;
  await h.open(url);
  const popup = await h.popup(url);
  await popup.click("#import");
  await popup.waitForFunction(() => /^Imported/.test(document.querySelector("#status").textContent));
  assert.equal(await popup.textContent("#status"), "Imported 2 values.");
  const memory = await h.storage("memory");
  assert.deepEqual(
    Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, v.value])),
    { email: "pat@example.org", city: "Lisbon" },
  );
});

test("F4 'Learn on all sites' asks for every site and captures anywhere", async () => {
  await h.reset({ settings: KEYED });
  const options = await h.extensionPage("options.html");
  await options.check("#learnAll");
  await settle();
  assert.deepEqual(await options.evaluate(() => window.__permCalls), [
    { origins: ["*://*/*"] },
  ]);
  assert.equal((await h.storage("settings")).learnAllSites, true);
  const page = await h.open(`${FORMS}/contact.html`);
  await settle();
  await page.fill("#org", "Initech");
  await page.click("h1");
  await settle(1000);
  assert.equal((await h.storage("memory")).organization.domain, "forms.test");

  await options.uncheck("#learnAll");
  await settle();
  assert.deepEqual(await h.swEval(() => chrome.scripting.getRegisteredContentScripts()), []);
  assert.equal((await h.storage("settings")).learnAllSites, false);
});

// ------------------------------------------------------------------ G. chip

test("G inline chip: saved value, AI suggestion, and nothing without a key", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: { suggest: "Initech" } });
  await registerSite("shop.test");
  const url = `${SHOP}/contact.html`;
  let page = await h.open(url);
  await settle();
  const chip = page.locator("[data-aiff-ui] button");

  await page.focus("#em");
  await chip.filter({ hasText: "↩ alex@example.com" }).click();
  assert.equal(await page.inputValue("#em"), "alex@example.com");

  // From outside any field: moving between fields hides the chip (see G2).
  await page.click("h1");
  await settle(400);
  await page.focus("#ssn");
  await settle();
  assert.equal(await chip.filter({ hasText: "✨ AI" }).isVisible(), false, "chip offered on SSN");

  await page.focus("#org");
  await chip.filter({ hasText: "✨ AI" }).click();
  await chip.filter({ hasText: "↩ Initech" }).click();
  assert.equal(await page.inputValue("#org"), "Initech");
  assert.equal((await h.calls("suggest")).length, 1);

  await h.reset({ settings: {}, memory: MEMORY });
  await registerSite("shop.test");
  page = await h.open(url);
  const chipNoKey = page.locator("[data-aiff-ui] button");
  await settle();
  await page.focus("#org");
  await settle();
  assert.equal(await page.locator("[data-aiff-ui] button:visible").count(), 0);
  await page.focus("#em");
  await chipNoKey.filter({ hasText: "↩ alex@example.com" }).waitFor();
  assert.equal(await chipNoKey.filter({ hasText: "✨ AI" }).count(), 0);
});

test("G2 the chip stays when focus moves from one field to the next", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY });
  await registerSite("shop.test");
  const page = await h.open(`${SHOP}/contact.html`);
  await settle();
  await page.focus("#em");
  await page.focus("#org");
  await settle(800);
  assert.equal(await page.locator("[data-aiff-ui] button", { hasText: "✨ AI" }).isVisible(), true);

  // Moving on to a field with nothing to offer still hides the old chip.
  await h.reset({ settings: {}, memory: MEMORY });
  await registerSite("shop.test");
  const noKey = await h.open(`${SHOP}/contact.html`);
  await settle();
  await noKey.focus("#em");
  const memChip = noKey.locator("[data-aiff-ui] button", { hasText: "↩ alex@example.com" });
  await memChip.waitFor();
  await noKey.focus("#org");
  await settle(800);
  assert.equal(await memChip.isVisible(), false, "stale chip left on the previous field");
});

// --------------------------------------------------------------- H. settings

test("H1 settings: template, unsaved marker, Cmd/Ctrl+S saves", async () => {
  await h.reset({});
  const options = await h.extensionPage("options.html");
  await options.waitForFunction(() => document.querySelector("#globalKnowledge").value);
  assert.match(await options.inputValue("#globalKnowledge"), /^# Personal/);
  await options.fill("#keyOpenai", "sk-test");
  await options.selectOption("#defaultProvider", "openai");
  await options.fill("#defaultModel", "gpt-test");
  await options.fill("#longFormModel", "gpt-long");
  assert.equal(await options.textContent("#saved"), "Unsaved changes");
  await options.keyboard.press("ControlOrMeta+s");
  await options.waitForFunction(() => document.querySelector("#saved").textContent === "Saved.");
  const s = await h.storage("settings");
  assert.deepEqual(
    [s.providerKeys.openai, s.defaultProvider, s.defaultModel, s.longFormModel],
    ["sk-test", "openai", "gpt-test", "gpt-long"],
  );
  await options.reload();
  assert.equal(await options.inputValue("#defaultModel"), "gpt-test");
});

test("H2 per-site override: other provider, its own default model, blank fields inherit", async () => {
  await h.reset({ settings: { ...KEYED, defaultModel: "claude-x" } });
  const options = await h.extensionPage("options.html");
  await options.click("[data-tab=sites]");
  await options.fill("#newDomain", "Forms.test");
  await options.click("#addSite");
  const card = options.locator(".card[data-domain='forms.test']");
  await card.locator(".s-provider").selectOption("openai");
  await card.locator(".s-prompt").fill("Be brief.");
  await options.click("#save");
  await options.waitForFunction(() => document.querySelector("#saved").textContent === "Saved.");
  assert.deepEqual((await h.storage("settings")).sites["forms.test"], {
    provider: "openai",
    model: "",
    longFormModel: "",
    prompt: "Be brief.",
    knowledge: "",
  });
  const url = `${FORMS}/mini.html`;
  await h.open(url);
  const popup = await h.popup(url);
  await popup.waitForFunction(() => document.querySelector("#meta").textContent);
  assert.match(await popup.textContent("#meta"), /^forms\.test · openai · gpt-4o-mini/);
});

test("H2b a site's long-form model is saved and used for its essays", async () => {
  await h.reset({
    settings: { ...KEYED, sites: { "shop.test": { longFormModel: "site-long" } } },
    memory: MEMORY,
    plan: JOB_PLAN,
  });
  const options = await h.extensionPage("options.html");
  await options.click("[data-tab=sites]");
  const field = options.locator(".card[data-domain='shop.test'] .s-long-model");
  assert.equal(await field.inputValue(), "site-long");
  await field.fill("site-long-2");
  await options.click("#save");
  await options.waitForFunction(() => document.querySelector("#saved").textContent === "Saved.");
  assert.equal((await h.storage("settings")).sites["shop.test"].longFormModel, "site-long-2");

  await h.open(JOB);
  await h.popupFill(JOB);
  const essay = (await h.calls("autofill")).find((c) => c.labels.includes("Cover letter"));
  assert.equal(essay.model, "site-long-2");
});

test("H3 knowledge base from a URL, and its failure messages", async () => {
  await h.reset({
    settings: KEYED,
    plan: { enrich: { "First Name": "Pat", email: "pat.morgan@example.org", city: "" } },
  });
  const options = await h.extensionPage("options.html");
  await options.click("[data-tab=knowledge]");
  const fetchKb = async (url) => {
    await options.fill("#kbUrl", url);
    await options.evaluate(() => (document.querySelector("#kbStatus").textContent = ""));
    await options.click("#kbFetch");
    await options.waitForFunction(() => {
      const t = document.querySelector("#kbStatus").textContent;
      return t && !/^Fetching/.test(t);
    });
    return options.textContent("#kbStatus");
  };

  assert.equal(await fetchKb(`${SHOP}/profile.html`), "Added 2 values to your Saved data (Saved data tab).");
  assert.deepEqual(await options.evaluate(() => window.__permCalls), [
    { origins: ["http://shop.test:8731/*"] },
  ]);
  const memory = await h.storage("memory");
  assert.deepEqual([memory.first_name.value, memory.first_name.domain], ["Pat", "shop.test"]);
  assert.match((await h.calls("enrich"))[0].user, /Staff Engineer at Initech/);

  assert.equal(await fetchKb("http://"), "That doesn't look like a valid URL.");
  assert.equal(await fetchKb(`${SHOP}/blank.html`), "Error: Could not read any text from that page.");
  assert.equal(await fetchKb(`${SHOP}/missing.html`), "Error: Could not fetch page (404).");

  await h.reset({ settings: {} });
  const noKey = await h.extensionPage("options.html");
  await noKey.click("[data-tab=knowledge]");
  await noKey.fill("#kbUrl", `${SHOP}/profile.html`);
  await noKey.click("#kbFetch");
  await noKey.waitForFunction(() => /^Error/.test(document.querySelector("#kbStatus").textContent));
  assert.equal(await noKey.textContent("#kbStatus"), "Error: No API key set for anthropic (see General).");

  const denied = await h.extensionPage("options.html", { grant: false });
  await denied.click("[data-tab=knowledge]");
  await denied.fill("#kbUrl", `${SHOP}/profile.html`);
  await denied.click("#kbFetch");
  await denied.waitForFunction(() => document.querySelector("#kbStatus").textContent);
  assert.equal(await denied.textContent("#kbStatus"), "Access to that site was denied.");
});

// ------------------------------------------------------------- I. saved data

test("I saved data: scrub, group, search, edit, remove, merge, clear, unblock", async () => {
  await h.reset({
    settings: KEYED,
    memory: {
      ...MEMORY,
      email: { value: "alex@example.com", count: 3, lastUsed: 2 },
      e_mail: { value: "old@example.com", count: 2, lastUsed: 1, domain: "shop.test" },
      otp_code: { value: "123456" },
      middle_initial: { value: "Q" },
      city: { value: "Lisbon", domain: "forms.test" },
    },
    blocks: { "shop.test": { email: true } },
    plan: { consolidate: { e_mail: "email", first_name: "otp_code" } },
  });
  const options = await h.extensionPage("options.html");
  await options.click("[data-tab=data]");
  await options.waitForFunction(() => document.querySelector("#memCount").textContent);

  const memory = await h.storage("memory");
  assert.equal(memory.otp_code, undefined, "sensitive key scrubbed on load");
  assert.equal(memory.middle_initial, undefined, "1-char value scrubbed on load");
  assert.equal(await options.textContent("#memCount"), "8 saved.");
  const groups = () => options.locator(".mem-group-name:visible").allTextContents();
  assert.deepEqual(await groups(), ["forms.test", "shop.test", "No website"]);
  await options.selectOption("#memGroupBy", "category");
  assert.deepEqual(await groups(), ["Personal", "Contact", "Address"]);

  await options.fill("#memSearch", "lisbon");
  assert.deepEqual(await options.locator("#memList .mem-row:visible .mem-key").allTextContents(), ["city"]);
  await options.fill("#memSearch", "");

  await options.locator(".mem-row[data-key=phone] .mem-remove").click();
  await settle();
  assert.equal((await h.storage("memory")).phone, undefined, "remove is saved at once");

  await options.locator(".mem-row[data-key=last_name] .mem-value").fill("Rivera-Lopez");
  await options.click("#save");
  await options.waitForFunction(() => document.querySelector("#saved").textContent === "Saved.");
  assert.equal((await h.storage("memory")).last_name.value, "Rivera-Lopez");

  await options.click("#memMerge");
  await options.waitForFunction(() => /^Merged|^No dup|^Error/.test(document.querySelector("#mergeStatus").textContent));
  assert.equal(await options.textContent("#mergeStatus"), "Merged 1 duplicate entry.");
  const merged = await h.storage("memory");
  assert.equal(merged.e_mail, undefined);
  assert.deepEqual([merged.email.value, merged.email.count], ["alex@example.com", 5]);
  assert.equal(merged.first_name.value, "Alex", "never merged into a sensitive key");

  await options.locator("#blockList .mem-remove").click();
  await settle();
  assert.deepEqual(await h.storage("blocks"), {});

  await options.click("#clearMem");
  await settle();
  assert.deepEqual(await h.storage("memory"), {});
  assert.equal(await options.textContent("#memCount"), "0 saved.");
});

// ------------------------------------------------------- J. providers, errors

test("J1 Anthropic wire format: key header, browser access header, cached system prompt", async () => {
  await h.reset({
    settings: { ...KEYED, globalKnowledge: "KB: I live in Austin." },
    plan: JOB_PLAN,
  });
  await h.open(JOB);
  await h.popupFill(JOB);
  const [call] = await h.calls("autofill");
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(call.headers["x-api-key"], "test-key");
  assert.equal(call.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.deepEqual(call.cacheControl, { type: "ephemeral" });
  assert.match(call.system, /KB: I live in Austin\./);
  assert.doesNotMatch(call.user, /KB: I live in Austin\./);
  assert.match(call.user, /Senior Backend Engineer at Acme/, "page context sent");
});

for (const [provider, url] of [
  ["openai", "https://api.openai.com/v1/chat/completions"],
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions"],
]) {
  test(`J2 ${provider}: bearer key, JSON mode, values applied`, async () => {
    await h.reset({
      settings: { providerKeys: { [provider]: "sk-x" }, defaultProvider: provider },
      plan: JOB_PLAN,
    });
    const page = await h.open(JOB);
    await h.popupFill(JOB);
    const [call] = await h.calls("autofill");
    assert.equal(call.url, url);
    assert.equal(call.headers.authorization, "Bearer sk-x");
    assert.deepEqual(call.responseFormat, { type: "json_object" });
    const cover = (await ui.previewRows(page)).find((r) => r.label === "Cover letter");
    assert.equal(cover.value, COVER);
  });
}

test("J2b OpenRouter Claude models get a cacheable system prompt, others do not", async () => {
  for (const [model, cache] of [
    ["anthropic/claude-x", { type: "ephemeral" }],
    ["openai/gpt-x", null],
  ]) {
    await h.reset({
      settings: {
        providerKeys: { openrouter: "sk-or" },
        defaultProvider: "openrouter",
        defaultModel: model,
        globalKnowledge: "KB: I live in Austin.",
      },
      plan: JOB_PLAN,
    });
    await h.open(JOB);
    await h.popupFill(JOB);
    const [call] = await h.calls("autofill");
    assert.deepEqual(call.cacheControl, cache, model);
    assert.match(call.system, /KB: I live in Austin\./);
  }
});

test("J3 OpenAI model without JSON mode: retried as a plain call", async () => {
  await h.reset({
    settings: { providerKeys: { openai: "sk-x" }, defaultProvider: "openai" },
    plan: { ...JOB_PLAN, rejectJsonMode: true },
  });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  const calls = await h.calls("autofill");
  assert.deepEqual(calls.map((c) => !!c.responseFormat), [true, false]);
  assert.ok((await ui.previewRows(page)).some((r) => r.value === COVER));
});

test("J4 a reply that is not JSON: AI fills nothing, saved values still offered", async () => {
  await h.reset({ settings: KEYED, memory: MEMORY, plan: { ...JOB_PLAN, malformed: true } });
  const page = await h.open(JOB);
  await h.popupFill(JOB);
  const rows = await ui.previewRows(page);
  assert.ok(rows.length > 0 && rows.every((r) => r.source === "memory"));
});

test("J5 server error and timeout reach the user as messages", async () => {
  await h.reset({ settings: KEYED, plan: { fail: { status: 500, text: "overloaded" } } });
  let popup;
  await h.open(JOB);
  popup = await h.popupFill(JOB);
  assert.equal(await popup.textContent("#status"), "Error: AI request failed (500): overloaded");

  await h.reset({ settings: KEYED, plan: { delayMs: 2500 } });
  await h.swEval(() => (http.timeoutMs = 1000));
  try {
    await h.open(JOB);
    popup = await h.popupFill(JOB);
    assert.equal(await popup.textContent("#status"), "Error: AI request timed out after 1s");
  } finally {
    await h.swEval(() => (http.timeoutMs = 30000));
  }
});

// -------------------------------------------------------------- K. migration

test("K update migration turns on allFrames for scripts registered without it", async () => {
  await h.reset({});
  const after = await h.swEval(async () => {
    await chrome.scripting.registerContentScripts([
      { id: "site-old.test", matches: ["*://shop.test/*"], js: AIFF.CONTENT_SCRIPT_FILES },
    ]);
    await siteScripts.enableAllFramesOnExisting();
    return chrome.scripting.getRegisteredContentScripts();
  });
  assert.deepEqual(after.map((s) => [s.id, s.allFrames]), [["site-old.test", true]]);
});
