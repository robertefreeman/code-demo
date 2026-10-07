import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { extractSvg } from "../worker/index.js";

const ORIGIN = "https://robertefreeman.github.io";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><circle cx="320" cy="320" r="200" fill="blue"/></svg>';

function environment(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    OPENAI_BASE_URL: "https://llm.example.com/v1",
    OPENAI_MODEL: "demo-model",
    OPENAI_API_KEY: "test-key-not-real",
    TURNSTILE_SECRET_KEY: "test-secret-not-real",
    PER_IP_LIMITER: { limit: async () => ({ success: true }) },
    SITE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

function request(body = { prompt: "Blue circle", token: "token" }, options = {}) {
  return new Request("https://api.example.com/generate", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
    body: JSON.stringify(body),
    ...options,
  });
}

function upstream(t, overrides = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url.includes("siteverify")) {
      if (overrides.verificationRaw !== undefined) return new Response(overrides.verificationRaw);
      return Response.json({ success: true, hostname: new URL(ORIGIN).hostname, action: "generate", ...overrides.verification });
    }
    if (overrides.httpStatus) return new Response("private upstream details", { status: overrides.httpStatus });
    if (overrides.failure) return new Response("private upstream details", { status: 401 });
    if (overrides.raw) return new Response(overrides.raw);
    return Response.json({ choices: [{ finish_reason: overrides.finish || "stop", message: { content: overrides.svg ?? SVG } }] });
  });
  return calls;
}

test("generates art using a verified token and server-side credentials", async (t) => {
  const calls = upstream(t);
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { svg: SVG });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://llm.example.com/v1/chat/completions");
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-key-not-real");
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.model, "demo-model");
  assert.equal(payload.messages[1].content, "Blue circle");
  assert.equal(payload.stream, false);
});

test("allows preflight only for the configured origin", async () => {
  const allowed = await worker.fetch(request(undefined, { method: "OPTIONS", body: undefined }), environment());
  assert.equal(allowed.status, 204);
  const denied = await worker.fetch(request(undefined, { headers: { Origin: "https://evil.example" } }), environment());
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("rejects incorrect paths and HTTP methods", async () => {
  const response = await worker.fetch(new Request("https://api.example.com/", { headers: { Origin: ORIGIN } }), environment());
  assert.equal(response.status, 404);
  const get = await worker.fetch(request(undefined, { method: "GET", body: undefined }), environment());
  assert.equal(get.status, 405);
});

test("fails closed when generation is unconfigured", async () => {
  assert.equal((await worker.fetch(request(), environment({ OPENAI_API_KEY: "" }))).status, 503);
});

test("rejects invalid input without contacting the upstream", async (t) => {
  const calls = upstream(t);
  for (const body of [null, {}, { prompt: "", token: "x" }, { prompt: "a".repeat(1001), token: "x" }, { prompt: "hi", token: "" }]) {
    assert.equal((await worker.fetch(request(body), environment())).status, 400);
  }
  assert.equal((await worker.fetch(request(undefined, { body: "{" }), environment())).status, 400);
  assert.equal((await worker.fetch(request(undefined, { body: "x".repeat(8193) }), environment())).status, 413);
  assert.equal((await worker.fetch(request(undefined, { headers: { Origin: ORIGIN, "Content-Type": "text/plain" } }), environment())).status, 415);
  assert.equal(calls.length, 0);
});

test("per-IP limiter rejects before bot verification", async (t) => {
  const calls = upstream(t);
  const response = await worker.fetch(request(), environment({ PER_IP_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(calls.length, 0);
});

test("site limiter rejects before generating art", async (t) => {
  const calls = upstream(t);
  const response = await worker.fetch(request(), environment({ SITE_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(response.status, 429);
  assert.equal(calls.length, 1);
});

for (const verification of [
  { success: false },
  { hostname: "evil.example" },
  { action: "other-action" },
]) {
  test(`rejects invalid verification ${JSON.stringify(verification)}`, async (t) => {
    const calls = upstream(t, { verification });
    assert.equal((await worker.fetch(request(), environment())).status, 403);
    assert.equal(calls.length, 1);
  });
}

test("accepts fenced SVG, but rejects oversized, non-SVG, and truncated output", async (t) => {
  upstream(t, { svg: "```svg\n" + SVG + "\n```" });
  const response = await worker.fetch(request(), environment());
  assert.equal((await response.json()).svg, SVG);
});

test("extracts one SVG from explanatory text and Markdown", () => {
  for (const source of [
    SVG,
    `Here is a picture:\n${SVG}\nHope you like it!`,
    `Here is your art:\n\`\`\`html\n${SVG}\n\`\`\`\nA blue circle.`,
    `\`\`\`SVG\r\n${SVG}\r\n\`\`\``,
  ]) {
    assert.equal(extractSvg(source), SVG);
  }
});

test("does not repair broken markup or accept multiple SVG documents", () => {
  for (const source of [
    `${SVG}\n${SVG}`,
    SVG.replace("</svg>", ""),
    `<!DOCTYPE svg>${SVG}`,
    `<?xml version="1.0"?>${SVG}`,
    `${SVG}<!ENTITY unsafe SYSTEM "https://evil.example">`,
  ]) {
    assert.throws(() => extractSvg(source), error => error.status === 502);
  }
  // The browser, not a regex, rejects malformed markup inside a complete root.
  const malformed = SVG.replace("</svg>", "<broken></svg>");
  assert.equal(extractSvg(malformed), malformed);
});

test("returns the extracted document, not model commentary", async (t) => {
  upstream(t, { svg: `Here is your cabin:\n${SVG}\nEnjoy!` });
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { svg: SVG });
});

for (const output of [
  { svg: "Here is your art" },
  { svg: "<svg>" + " ".repeat(100001) + "</svg>" },
  { svg: SVG, finish: "length" },
  { raw: "not json" },
]) {
  test(`reports invalid model response ${Object.keys(output).join(",")}`, async (t) => {
    upstream(t, output);
    const response = await worker.fetch(request(), environment());
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
  });
}

test("does not forward upstream error details or secrets", async (t) => {
  upstream(t, { failure: true });
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.doesNotMatch(body, /private upstream details|test-key/);
  assert.match(body, /AI service rejected authentication \(HTTP 401\)/);
});

test("aborted upstream requests report a timeout", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Timed out", "TimeoutError"); });
  assert.equal((await worker.fetch(request(), environment())).status, 504);
});

test("invalid API configuration fails clearly", async (t) => {
  const calls = upstream(t);
  for (const base of ["not-a-url", "http://llm.example.com/v1", "https://user:password@llm.example.com/v1"]) {
    assert.equal((await worker.fetch(request(), environment({ OPENAI_BASE_URL: base }))).status, 503);
  }
  assert.ok(calls.every(call => call.url.includes("siteverify")));
});

test("identifies a non-JSON bot-verification response without exposing its body", async (t) => {
  const calls = upstream(t, { verificationRaw: "<html>private details</html>" });
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /Bot verification service returned a non-JSON response/);
  assert.doesNotMatch(body, /private details/);
  assert.equal(calls.length, 1);
});

test("identifies a non-JSON AI response", async (t) => {
  upstream(t, { raw: "data: streaming instead of JSON" });
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /AI service returned a non-JSON response/);
});

test("identifies an AI connection failure separately from bot verification", async (t) => {
  const original = upstream(t);
  const mockedFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.includes("siteverify")) return mockedFetch(url, options);
    throw new TypeError("Private connection details");
  });
  const response = await worker.fetch(request(), environment());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /Could not connect to the ai service/);
  assert.doesNotMatch(body, /Private connection details/);
  assert.equal(original.length, 1);
});

for (const httpStatus of [307, 400, 404, 429, 503]) {
  test(`reports upstream HTTP ${httpStatus} safely`, async (t) => {
    const calls = upstream(t, { httpStatus });
    const response = await worker.fetch(request(), environment());
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, new RegExp(`HTTP ${httpStatus}`));
    assert.doesNotMatch(body, /private upstream details/);
    assert.equal(calls[1].options.redirect, "manual");
  });
}
