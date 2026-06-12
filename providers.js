// AI provider strategies. Loaded in the background worker only. Each provider
// honors the same contract: complete({ apiKey, model, system, user }) -> text.
// Adding a provider means adding one registry entry, nothing else changes.

var AIFF = (self.AIFF = self.AIFF || {}); // shared global scope; see shared.js

// Transport with a request timeout, injected into providers (DIP).
AIFF.HttpClient = class HttpClient {
  constructor(timeoutMs = 30000) {
    this.timeoutMs = timeoutMs;
  }
  async postJson(url, headers, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === "AbortError")
        throw new Error(`AI request timed out after ${this.timeoutMs / 1000}s`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `AI request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return res.json();
  }

  async getText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (e) {
      if (e.name === "AbortError")
        throw new Error(`Fetch timed out after ${this.timeoutMs / 1000}s`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Could not fetch page (${res.status}).`);
    return res.text();
  }
};

AIFF.Provider = class Provider {
  constructor(http) {
    this.http = http;
  }
  // Free-text completion.
  async complete(_request) {
    throw new Error("Provider.complete not implemented");
  }
  // Structured completion: returns a parsed JS object. Optional JSON-schema
  // shapes the output. Default falls back to best-effort parsing of complete();
  // providers override with native JSON mode.
  async completeJson(request, _schema) {
    return AIFF.JsonExtractor.parse(await this.complete(request));
  }
};

AIFF.AnthropicProvider = class AnthropicProvider extends AIFF.Provider {
  _headers(apiKey) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  async complete({ apiKey, model, system, user, maxTokens }) {
    const data = await this.http.postJson(
      "https://api.anthropic.com/v1/messages",
      this._headers(apiKey),
      {
        model,
        max_tokens: maxTokens || 2048,
        system,
        messages: [{ role: "user", content: user }],
      },
    );
    return (data.content || []).map((b) => b.text || "").join("");
  }
  // Force a tool call whose input is the structured result — Anthropic's reliable
  // way to get structured output. Uses the given schema, else a flat string map.
  async completeJson({ apiKey, model, system, user, maxTokens }, schema) {
    const tool = {
      name: "result",
      description: "Return the structured result.",
      input_schema: schema || {
        type: "object",
        additionalProperties: { type: "string" },
      },
    };
    const data = await this.http.postJson(
      "https://api.anthropic.com/v1/messages",
      this._headers(apiKey),
      {
        model,
        max_tokens: maxTokens || 2048,
        system,
        messages: [{ role: "user", content: user }],
        tools: [tool],
        tool_choice: { type: "tool", name: "result" },
      },
    );
    const block = (data.content || []).find((b) => b.type === "tool_use");
    if (block && block.input) return block.input;
    return AIFF.JsonExtractor.parse(
      (data.content || []).map((b) => b.text || "").join(""),
    );
  }
};

// OpenAI and OpenRouter share the OpenAI chat/completions wire format; the only
// difference is the endpoint, so one class is parameterized by URL.
AIFF.OpenAICompatibleProvider = class OpenAICompatibleProvider extends (
  AIFF.Provider
) {
  constructor(http, url) {
    super(http);
    this.url = url;
  }
  _chat({ apiKey, model, system, user, maxTokens }, extra) {
    return this.http.postJson(
      this.url,
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...extra,
      },
    );
  }
  _text(data) {
    return data.choices?.[0]?.message?.content || "";
  }
  async complete(request) {
    return this._text(await this._chat(request, {}));
  }
  // Use JSON mode; if the model rejects it, fall back to a plain call. The shape
  // is driven by the prompt, so the schema arg isn't needed here.
  async completeJson(request, _schema) {
    let content;
    try {
      content = this._text(
        await this._chat(request, { response_format: { type: "json_object" } }),
      );
    } catch (e) {
      if (!/response_format|json/i.test(e.message)) throw e;
      content = this._text(await this._chat(request, {}));
    }
    try {
      return JSON.parse(content);
    } catch {
      return AIFF.JsonExtractor.parse(content);
    }
  }
};

AIFF.ProviderRegistry = class ProviderRegistry {
  constructor(http) {
    this.providers = {
      anthropic: new AIFF.AnthropicProvider(http),
      openai: new AIFF.OpenAICompatibleProvider(
        http,
        "https://api.openai.com/v1/chat/completions",
      ),
      openrouter: new AIFF.OpenAICompatibleProvider(
        http,
        "https://openrouter.ai/api/v1/chat/completions",
      ),
    };
  }
  get(name) {
    return this.providers[name] || this.providers.anthropic;
  }
};
