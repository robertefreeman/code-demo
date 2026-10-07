import { sanitizeSvg } from "./svg.js";

const form = document.querySelector("#prompt-form");
const prompt = document.querySelector("#prompt");
const model = document.querySelector("#model");
const generate = document.querySelector("#generate");
const status = document.querySelector("#status");
const canvas = document.querySelector("#canvas");
const art = document.querySelector("#art");
const caption = document.querySelector("#caption");
const download = document.querySelector("#download");
let config;
let token = "";
let widget;
let busy = false;
let artUrl;
let attempted = false;

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function updateButton() {
  generate.disabled = busy || !token || !prompt.value.trim() || model.disabled || !model.value;
  generate.textContent = busy ? "Creating your art…" : "Generate art ↗";
}

prompt.addEventListener("input", updateButton);

async function initialize() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Site configuration could not be loaded. Reload the page.");
    config = await response.json();
    if (!config.apiUrl || !config.turnstileSiteKey) {
      model.replaceChildren(new Option("No models configured", ""));
      showStatus("Generation isn't configured yet. The site owner needs to connect the AI service.");
      return;
    }
    if (new URL(config.apiUrl).protocol !== "https:") {
      throw new Error("The AI service URL must use HTTPS. Contact the site owner.");
    }
    const modelsResponse = await fetch(new URL("/models", config.apiUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!modelsResponse.ok) throw new Error("Available models couldn't be loaded. Check the API deployment and reload.");
    const { models } = await modelsResponse.json();
    if (!Array.isArray(models) || !models.length || models.some(value => typeof value !== "string" || !value.trim())) {
      throw new Error("The AI service returned an invalid model list. Contact the site owner.");
    }
    model.replaceChildren(...models.map(value => new Option(value, value)));
    model.disabled = false;
    showStatus("Complete the bot check, then describe your idea.");
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onerror = () => showStatus("The bot check couldn't load. Check your connection and reload.", true);
    script.onload = () => {
      try {
        widget = window.turnstile.render("#verification", {
        sitekey: config.turnstileSiteKey,
        action: "generate",
        size: "flexible",
        callback: (value) => {
          token = value;
          updateButton();
          if (!busy && !attempted) showStatus("Ready when you are.");
        },
        "expired-callback": () => {
          token = "";
          updateButton();
          if (!busy) showStatus("The bot check expired. Complete it again to generate.");
        },
        "error-callback": () => {
          token = "";
          updateButton();
          showStatus("The bot check failed. Reload the page to retry.", true);
        },
        });
      } catch (error) {
        console.error("Bot check initialization failed", error.name);
        showStatus("The bot check couldn't start. Reload the page to retry.", true);
      }
    };
    document.head.append(script);
  } catch (error) {
    model.replaceChildren(new Option("Models unavailable", ""));
    model.disabled = true;
    updateButton();
    showStatus(error.message || "The site couldn't load. Reload the page.", true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const idea = prompt.value.trim();
  if (busy || !token || !config?.apiUrl || !idea || idea.length > 1000 || model.disabled || !model.value) return;
  busy = true;
  attempted = true;
  const verificationToken = token;
  token = "";
  prompt.disabled = true;
  model.disabled = true;
  updateButton();
  canvas.setAttribute("aria-busy", "true");
  showStatus("Turning your idea into SVG. This may take a minute.");
  let nextUrl;
  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: idea, token: verificationToken, model: model.value }),
      signal: AbortSignal.timeout(100_000),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The AI service returned an unreadable response. Try again later.");
    }
    if (!response.ok) throw new Error(result.error || "Generation failed. Try again.");
    const svg = sanitizeSvg(result.svg);
    nextUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    // Keep the previous artwork if the new SVG cannot be rendered.
    const preview = new Image();
    preview.src = nextUrl;
    await preview.decode();
    art.src = nextUrl;
    art.alt = `Generated artwork: ${idea}`;
    if (artUrl) URL.revokeObjectURL(artUrl);
    artUrl = nextUrl;
    nextUrl = undefined;
    download.href = artUrl;
    download.hidden = false;
    caption.textContent = idea;
    showStatus("Your art is ready. Download it, or try another idea.");
  } catch (error) {
    if (nextUrl) URL.revokeObjectURL(nextUrl);
    const message = error.name === "TimeoutError"
      ? "Generation took too long. Try a simpler prompt."
      : error instanceof TypeError
        ? "Couldn't reach the AI service. Check your connection and try again."
        : error.message || "Generation failed. Try again.";
    showStatus(message, true);
  } finally {
    busy = false;
    prompt.disabled = false;
    model.disabled = false;
    canvas.setAttribute("aria-busy", "false");
    updateButton();
    if (widget !== undefined) window.turnstile.reset(widget);
  }
});

initialize();
