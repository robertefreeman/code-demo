# code-demo — SVG Studio

A small SVG art generator: describe an idea, generate a picture, and download
the SVG. Plain HTML, CSS, and JavaScript on GitHub Pages; one Cloudflare Worker
calls an OpenAI-compatible API. No frontend framework, database, or accounts.

Site: https://robertefreeman.github.io/code-demo/

The page can be published before generation is configured. It shows an example
and a setup message rather than pretending to generate art.

## Connect generation

1. Create a Cloudflare account and enable your Workers `workers.dev` subdomain.
   Create a Cloudflare API token using the **Edit Cloudflare Workers** template,
   scoped to your account. Note your account ID.
2. In Cloudflare's Turnstile dashboard, add a **Managed** widget allowing
   `robertefreeman.github.io` (hostname only, no path). Note its site key and secret.
3. In this repository's **Settings → Secrets and variables → Actions**, add these
   **repository secrets**. Never put private keys in source files or chat:

   | Secret | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Worker deployment token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
   | `OPENAI_BASE_URL` | HTTPS API base, e.g. `https://llm.example.com/v1` |
   | `OPENAI_MODEL` | Exact model ID supported by your host |
   | `OPENAI_API_KEY` | Your private LLM API key |
   | `TURNSTILE_SECRET_KEY` | Private Turnstile verification key |

4. Run **Actions → Deploy API → Run workflow**. The log shows the Worker URL,
   typically `https://code-demo-api.<your-subdomain>.workers.dev`.
5. Add these **repository variables**, not secrets (both are public):

   | Variable | Value |
   | --- | --- |
   | `SITE_API_URL` | Worker URL with `/generate` appended |
   | `TURNSTILE_SITE_KEY` | Public Turnstile site key |

6. Set **Settings → Pages → Source** to **GitHub Actions**, if not already set.
   Run **Actions → Deploy site → Run workflow**. Subsequent pushes to `main`
   redeploy the page. Rerun **Deploy API** after changing Worker code or secrets.

The host must be reachable from Cloudflare over HTTPS. Requests go to
`<OPENAI_BASE_URL>/chat/completions` using bearer authentication, `model`,
`messages`, `stream: false`, and `max_tokens: 6000`. The response must contain
SVG text in `choices[0].message.content`. It is not a file-upload endpoint;
models using a different protocol will need a small adapter.

### Troubleshooting generation

The message below the Generate button identifies the failing service:
**AI service** or **Bot verification service**. For HTTP failures it includes
the upstream status, but never the provider's response body or credentials.
Cloudflare's Worker logs contain the same service label and safe error category.

- **Rejected authentication (401/403):** check the corresponding secret and
  rerun **Deploy API**. Editing a GitHub secret does not update the deployed
  Worker until that workflow runs.
- **Redirected request:** use the final API base URL, not a login page or
  redirecting endpoint. The proxy will not forward credentials through redirects.
- **Non-JSON response:** the endpoint must return a JSON chat-completions
  response, not HTML or a streaming response.
- **Could not connect:** the host must accept HTTPS connections from Cloudflare,
  with valid TLS and public DNS. Check host firewall and access restrictions.
- **Invalid SVG:** try a simpler prompt; the model must follow the static SVG
  output format.

The page uses system fonts and allows Turnstile's documented script and iframe
origins. Font, GPU-adapter, and sandbox warnings inside a Turnstile frame do not
by themselves explain an API 502. Do not disable bot verification or relax the
page's security policy to work around an upstream API error.

## Safety and limits

- The API key lives in the Worker, not the browser. GitHub Actions installs it
  from repository secrets.
- Each generation verifies a single-use Turnstile token, including its hostname
  and `generate` action. CORS allows only `https://robertefreeman.github.io`.
  CORS alone is not authentication.
- Defaults are 3 attempts per IP per minute and 20 verified generations per
  minute per Cloudflare location. Adjust `wrangler.jsonc` if needed. These are
  approximate abuse controls, **not hard quotas or billing caps**. Shared IPs
  share the limit. Set spending limits at your LLM host where available.
- Rate-limit namespace IDs `1001` and `1002` must not conflict with other Workers
  in your Cloudflare account; change them if those IDs are already in use.
- The browser parses and reconstructs an allowlisted static SVG before showing
  it as a blob-backed image or allowing download. Scripts, event handlers,
  external resources, embedded HTML, CSS, and animations are rejected.
  Complex model output may need a simpler prompt.
- The proxy accepts one complete SVG surrounded by model commentary or Markdown;
  it extracts that document without repairing markup. Multiple or incomplete
  SVG documents, XML declarations, and entity declarations are rejected.
- Prompts are sent to Cloudflare for processing and to your configured LLM
  provider for generation. The app has no gallery or saved prompt history and
  does not log prompts or keys. Provider retention policies still apply.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4173. Without configuration, it shows the example canvas
and a disabled Generate button. `site/config.json` contains public configuration
only; use a deployed Worker for real generation. Local generation requires
opening the page at `http://localhost:4173`, temporarily setting the Worker's
`ALLOWED_ORIGIN` to `http://localhost:4173`, and adding `localhost` to the
Turnstile widget. Restore the production origin before publishing. Never
disable server-side verification in production.

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Browser tests use mocked API responses and verification; they never spend LLM
credits. To build a configured copy, provide `SITE_API_URL` and
`TURNSTILE_SITE_KEY` as environment variables. `dist/` is the Pages artifact.
