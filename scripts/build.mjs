import { cp, mkdir, writeFile } from "node:fs/promises";

const apiUrl = process.env.SITE_API_URL || "";
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || "";
if (Boolean(apiUrl) !== Boolean(turnstileSiteKey)) {
  throw new Error("Set both SITE_API_URL and TURNSTILE_SITE_KEY, or leave both unset for an unconfigured preview.");
}
if (apiUrl) {
  const url = new URL(apiUrl);
  if (url.protocol !== "https:" || url.pathname !== "/generate" || url.search || url.hash || url.username || url.password) {
    throw new Error("SITE_API_URL must be an HTTPS Worker URL ending in /generate.");
  }
}
await mkdir("dist", { recursive: true });
await cp("site", "dist", { recursive: true });
await writeFile("dist/config.json", JSON.stringify({ apiUrl, turnstileSiteKey }, null, 2) + "\n");
console.log(apiUrl ? "Built site with generation configured." : "Built preview. Set repository variables to enable generation.");
