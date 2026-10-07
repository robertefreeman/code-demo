import { SYSTEM_PROMPT } from "../worker/index.js";

for (const name of ["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"]) {
  if (!process.env[name]) throw new Error(`Missing secret: ${name}`);
}
const base = new URL(process.env.OPENAI_BASE_URL);
if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
  throw new Error("OPENAI_BASE_URL must be an HTTPS API base without embedded credentials.");
}
try {
  const response = await fetch(`${base.href.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      stream: false,
      max_tokens: 6000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "A single blue circle centered on a white background. Use only SVG." },
      ],
    }),
    signal: AbortSignal.timeout(85_000),
  });
  console.log("Upstream HTTP status:", response.status);
  if (!response.ok) throw new Error("The API rejected the diagnostic request.");
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The API returned a non-JSON response.");
  }
  const choice = result?.choices?.[0];
  const content = choice?.message?.content;
  const source = typeof content === "string" ? content.trim() : "";
  const normalized = source.replace(/^```(?:svg|xml)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  console.log("Response format (no response text or credentials):", JSON.stringify({
    finishReason: ["stop", "length", "content_filter"].includes(choice?.finish_reason) ? choice.finish_reason : "other",
    hasTextContent: typeof content === "string",
    textLength: source.length,
    startsWithCodeFence: source.startsWith("```"),
    startsWithXmlDeclaration: /^<\?xml\b/i.test(normalized),
    containsSvgRoot: /<svg[\s>]/i.test(normalized),
    startsWithSvg: /^<svg[\s>]/.test(normalized),
    endsWithSvg: /<\/svg>$/.test(normalized),
    hasDoctypeOrEntity: /<!DOCTYPE|<!ENTITY/i.test(normalized),
    hasProcessingInstruction: /<\?/.test(normalized),
  }, null, 2));
} catch (error) {
  // Do not print fetch exceptions: their messages can include private endpoint details.
  console.error(error instanceof TypeError || error.name === "TimeoutError" ? `API diagnostic failed: ${error.name}` : error.message);
  process.exitCode = 1;
}
