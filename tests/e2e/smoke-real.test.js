// Smoke test against the REAL provider APIs (costs a few cents). One preview
// fill of job.html per provider whose key is in the environment; providers
// without a key are skipped. Anthropic also fills twice to see whether the
// cached system prompt is read back on the second call.
//
//   ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY   (any subset)
//   AIFF_MODEL_ANTHROPIC / AIFF_MODEL_OPENAI / AIFF_MODEL_OPENROUTER (optional)
//
// Run: node --test tests/e2e/smoke-real.test.js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Harness, ui, SHOP } = require("./harness");

const JOB = `${SHOP}/job.html`;
const ENV_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

// Long enough (well over 1024 tokens) for Anthropic to cache the system prompt.
const KNOWLEDGE = [
  "# Personal",
  "Full name: Alex Rivera",
  "First name: Alex",
  "Last name: Rivera",
  "Email: alex.rivera@example.com",
  "Phone: +1 415 555 0148",
  "Country: United States",
  "# Job application preferences",
  "Work authorization: US citizen, authorized to work in the US",
  "Require visa sponsorship: No",
  "Notice period: 2 weeks",
  "Earliest start date: 2026-11-16",
  "# Work",
  "Current title: Senior Software Engineer",
  "Current company: Initech",
  "Top skills: Go, Python, PostgreSQL, Kafka, Kubernetes",
  "# Essay material",
  ...Array.from(
    { length: 40 },
    (_, i) =>
      `Project ${i + 1}: built and ran a payments service (ledger, retries, ` +
      `idempotency keys) in Go that handled ${1000 + i * 250} requests per ` +
      `second with p99 latency under ${40 + i} ms; owned on-call and the ` +
      `incident reviews for it.`,
  ),
].join("\n");

// Pass-through spy: records each provider call and its token usage.
function installSpy() {
  self.__calls = [];
  self.__realFetch = self.__realFetch || self.fetch.bind(self);
  self.fetch = async (url, init) => {
    const res = await self.__realFetch(url, init);
    const u = String(url);
    if (!/anthropic\.com|openai\.com|openrouter\.ai/.test(u)) return res;
    const copy = res.clone();
    let usage = null;
    try {
      usage = (await copy.json()).usage || null;
    } catch {
      // not JSON (error page)
    }
    const body = JSON.parse(init.body);
    self.__calls.push({ url: u, status: res.status, model: body.model, usage });
    return res;
  };
}

const h = new Harness();
before(() => h.start(), { timeout: 60000 });
after(() => h.stop());

for (const [provider, envName] of Object.entries(ENV_KEYS)) {
  const key = process.env[envName];
  test(`real ${provider}: preview proposes grounded values`, { skip: !key && `${envName} not set` }, async () => {
    const model = process.env[`AIFF_MODEL_${provider.toUpperCase()}`];
    await h.reset({
      settings: {
        providerKeys: { [provider]: key },
        defaultProvider: provider,
        ...(model ? { defaultModel: model } : {}),
        globalKnowledge: KNOWLEDGE,
      },
    });
    await h.swEval(installSpy);

    const fill = async () => {
      const page = await h.open(JOB);
      const popup = await h.popupFill(JOB);
      const status = await popup.textContent("#status");
      assert.match(status, /^Review the preview/, status);
      return Object.fromEntries((await ui.previewRows(page)).map((r) => [r.label, r]));
    };

    const rows = await fill();
    console.log(`[${provider}]`, JSON.stringify((await h.swEval(() => self.__calls))));
    for (const [label, row] of Object.entries(rows))
      console.log(`  ${label} [${row.source}]: ${row.value.slice(0, 90).replace(/\n/g, " / ")}`);

    assert.equal(rows.Email.value, "alex.rivera@example.com");
    assert.equal(rows["Are you authorized to work in the US?"].value, "Yes");
    const cover = rows["Cover letter"];
    assert.ok(cover && cover.value.length > 200, `cover letter missing or short: ${cover && cover.value}`);
    assert.equal(rows["Social security number"], undefined, "invented an SSN");

    if (provider === "anthropic") {
      await fill();
      const usage = (await h.swEval(() => self.__calls)).map((c) => c.usage || {});
      console.log("  cache:", JSON.stringify(usage.map((u) => [u.cache_creation_input_tokens, u.cache_read_input_tokens])));
      assert.ok(usage.at(-1).cache_read_input_tokens > 0, "second call did not read the cache");
    }
  });
}
