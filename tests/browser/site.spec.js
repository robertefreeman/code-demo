import { test, expect } from "@playwright/test";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><rect width="640" height="640" fill="#174fc7"/></svg>';
const API = "https://studio-api.example/generate";
const MODELS_API = "https://studio-api.example/models";
async function configure(page, models = ["demo-model", "second-model"]) {
  await page.route("**/config.json", route => route.fulfill({
    json: { apiUrl: API, turnstileSiteKey: "test-site-key" },
  }));
  await page.route(MODELS_API, route => route.fulfill({ json: { models } }));
  await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.turnstile = {
      render: (selector, options) => { window.testTurnstile = options; options.callback("verified-token"); return "test-widget"; },
      reset: () => window.testTurnstile.callback("fresh-token")
    };`,
  }));
}

test("unconfigured site shows an honest setup state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("SVG Studio");
  await expect(page.locator(".wordmark")).toHaveText("SVG Studio / code-demo");
  await expect(page.locator("#status")).toContainText("isn't configured yet");
  await expect(page.locator("#generate")).toBeDisabled();
  await expect(page.locator("#art")).toBeVisible();
  await expect(page.locator("#download")).toBeHidden();
});

test("generates, displays, and downloads sanitized SVG", async ({ page }) => {
  await configure(page);
  let submitted;
  await page.route(API, route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { svg: SVG } });
  });
  await page.goto("/");
  await page.locator("#prompt").fill("A blue square");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("Your art is ready");
  await expect(page.locator("#art")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("#caption")).toHaveText("A blue square");
  expect(submitted).toEqual({ prompt: "A blue square", token: "verified-token", model: "demo-model" });
  const download = page.waitForEvent("download");
  await page.locator("#download").click();
  expect((await download).suggestedFilename()).toBe("svg-studio.svg");
  await expect(page.locator("#generate")).toBeEnabled();
});

test("lists both models, defaults to the existing model, and uses the user's selection", async ({ page }) => {
  await configure(page);
  const submitted = [];
  await page.route(API, route => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: { svg: SVG } });
  });
  await page.goto("/");
  const model = page.getByLabel("Model", { exact: true });
  await expect(model).toHaveValue("demo-model");
  await expect(model.locator("option")).toHaveText(["demo-model", "second-model"]);
  await model.selectOption("second-model");
  await page.getByLabel("Your idea").fill("A tree");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("Your art is ready");
  expect(submitted[0].model).toBe("second-model");
  await expect(model).toHaveValue("second-model");
  await expect(model).toBeEnabled();
  await model.selectOption("demo-model");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("Your art is ready");
  expect(submitted[1].model).toBe("demo-model");
});

test("supports a deployment with only the existing model", async ({ page }) => {
  await configure(page, ["demo-model"]);
  await page.goto("/");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("demo-model");
  await expect(page.locator("#model option")).toHaveCount(1);
  await page.getByLabel("Your idea").fill("A tree");
  await expect(page.locator("#generate")).toBeEnabled();
});

for (const failure of ["unavailable", "invalid"]) {
  test(`blocks generation when the model list is ${failure}`, async ({ page }) => {
    await configure(page);
    await page.route(MODELS_API, route => route.fulfill(failure === "unavailable"
      ? { status: 503, json: { error: "Not configured" } }
      : { json: { models: [] } }));
    await page.goto("/");
    await expect(page.locator("#status")).toContainText(failure === "unavailable" ? "couldn't be loaded" : "invalid model list");
    await expect(page.locator("#model")).toBeDisabled();
    await expect(page.locator("#model")).toHaveText("Models unavailable");
    await page.getByLabel("Your idea").fill("A tree");
    await expect(page.locator("#generate")).toBeDisabled();
  });
}

test("shows API errors and keeps previous artwork", async ({ page }) => {
  await configure(page);
  await page.route(API, route => route.fulfill({ status: 429, json: { error: "Too many requests. Wait a minute before trying again." } }));
  await page.goto("/");
  await page.locator("#prompt").fill("A tree");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("Too many requests");
  await expect(page.locator("#art")).toHaveAttribute("src", "sample.svg");
  await expect(page.locator("#generate")).toBeEnabled();
});

test("reports an unavailable bot check", async ({ page }) => {
  await configure(page);
  await page.route("https://challenges.cloudflare.com/**", route => route.abort());
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("bot check couldn't load");
  await expect(page.locator("#generate")).toBeDisabled();
});

test("expired verification disables generation until refreshed", async ({ page }) => {
  await configure(page);
  await page.goto("/");
  await page.locator("#prompt").fill("A tree");
  await expect(page.locator("#generate")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
  await page.evaluate(() => window.testTurnstile["expired-callback"]());
  await expect(page.locator("#generate")).toBeDisabled();
  await page.evaluate(() => window.testTurnstile.callback("refreshed-token"));
  await expect(page.locator("#generate")).toBeEnabled();
});

test("keeps the last generated artwork after a failed retry", async ({ page }) => {
  await configure(page);
  let attempts = 0;
  await page.route(API, route => route.fulfill(++attempts === 1
    ? { json: { svg: SVG } }
    : { status: 502, json: { error: "The AI service is unavailable. Try again later." } }));
  await page.goto("/");
  await page.locator("#prompt").fill("A square");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("Your art is ready");
  const src = await page.locator("#art").getAttribute("src");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("unavailable");
  await expect(page.locator("#art")).toHaveAttribute("src", src);
  await expect(page.locator("#download")).toHaveAttribute("href", src);
  await expect(page.locator("#caption")).toHaveText("A square");
});

test("blocks unsafe artwork and leaves the canvas intact", async ({ page }) => {
  await configure(page);
  await page.route(API, route => route.fulfill({ json: { svg: SVG.replace("</svg>", '<script>alert("bad")</script></svg>') } }));
  await page.goto("/");
  await page.locator("#prompt").fill("A tree");
  await page.locator("#generate").click();
  await expect(page.locator("#status")).toContainText("unsupported SVG elements");
  await expect(page.locator("#art")).toHaveAttribute("src", "sample.svg");
  await expect(page.locator("#download")).toBeHidden();
});

test("sanitizer rejects active content, remote references, and malformed SVG", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async (svg) => {
    const { sanitizeSvg } = await import("/svg.js");
    const bad = [
      svg.replace("<rect ", '<rect onclick="alert(1)" '),
      svg.replace("<rect ", '<rect style="fill:red" '),
      svg.replace("</svg>", '<image href="https://evil.example/image.svg"/></svg>'),
      svg.replace("#174fc7", "url(https://evil.example/paint)"),
      svg.replace("#174fc7", "url(&quot;https://evil.example/paint&quot;)"),
      svg.replace("#174fc7", "u\\72l(https://evil.example/paint)"),
      svg.replace("</svg>", "<foreignObject/></svg>"),
      svg.replace("</svg>", '<g xmlns="http://www.w3.org/1999/xhtml"/></svg>'),
      "<!DOCTYPE svg [<!ENTITY remote SYSTEM 'https://evil.example'>]>" + svg,
      "<svg><broken></svg>",
      svg.replace("0 0 640 640", "0 0 0 640"),
    ];
    return {
      valid: sanitizeSvg(svg),
      rejected: bad.map(source => { try { sanitizeSvg(source); return false; } catch { return true; } }),
    };
  }, SVG);
  expect(results.valid).toContain('fill="#174fc7"');
  expect(results.rejected.every(Boolean)).toBe(true);
});

test("supports gradients and text without external resources", async ({ page }) => {
  await page.goto("/");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="a"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="100" fill="url(#a)"/><text x="5" y="20">Hello &amp; goodbye</text></svg>';
  const output = await page.evaluate(async source => (await import("/svg.js")).sanitizeSvg(source), svg);
  expect(output).toContain("url(#a)");
  expect(output).toContain("Hello &amp; goodbye");
});

test("prevents duplicate submissions while generating", async ({ page }) => {
  await configure(page);
  let resolveResponse;
  const waiting = new Promise(resolve => { resolveResponse = resolve; });
  await page.route(API, async route => {
    await waiting;
    await route.fulfill({ json: { svg: SVG } });
  });
  await page.goto("/");
  await page.locator("#prompt").fill("A square");
  await page.locator("#generate").click();
  await expect(page.locator("#generate")).toBeDisabled();
  await expect(page.locator("#prompt")).toBeDisabled();
  await expect(page.locator("#model")).toBeDisabled();
  await expect(page.locator("#canvas")).toHaveAttribute("aria-busy", "true");
  resolveResponse();
  await expect(page.locator("#status")).toContainText("Your art is ready");
  await expect(page.locator("#model")).toBeEnabled();
});

for (const width of [1280, 375]) {
  test(`layout fits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(page, ["demo-model", "a-second-model-with-a-long-name-for-svg-generation"]);
    await page.goto("/");
    await expect(page.locator("#model")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`site-${width}.png`), fullPage: true });
  });
}
