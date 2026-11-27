// Rate-limit stress test (see docs/RATE_LIMITS.md).
//
// 1. Starts a batch eval through the app's own API.
// 2. Optionally fires a burst of tiny calls on the same access key and model,
//    straight at DO (not through our limiter), like a noisy neighbour sharing
//    the key, so DO's per-minute counter runs out and the app gets real 429s.
// 3. Optionally starts an interactive compare during the burst.
// 4. Waits for the run, then prints the rate-event summary for it.
//
//   node scripts/stress-batch.mjs --base http://localhost:3000 --prompts 100 \
//        --models mistral-3-14B,glm-5.3-flash --burst mistral-3-14B --burst-at 45 --burst-size 130
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const base = args.base ?? "http://localhost:3000";
const prompts = Number(args.prompts ?? 100);
const models = (args.models ?? "mistral-3-14B,glm-5.3-flash").split(",");
const maxTokens = Number(args["max-tokens"] ?? 1024);
const burstModel = args.burst;
const burstAt = Number(args["burst-at"] ?? 45);
const burstSize = Number(args["burst-size"] ?? 130);
const compareAt = args["compare-at"] ? Number(args["compare-at"]) : undefined;

const topics = ["photosynthesis", "TCP slow start", "the French revolution", "black holes", "vaccines", "inflation", "recursion", "plate tectonics", "the Krebs cycle", "public key cryptography"];
const asks = ["Explain {t} in two sentences.", "Give one surprising fact about {t}.", "What is a common misconception about {t}?", "Explain {t} to a ten year old in one sentence.", "Name two key terms related to {t} and define them briefly.", "Why does {t} matter? One sentence.", "Write a one-line analogy for {t}.", "What question would an expert ask about {t}?", "Summarise {t} in under 20 words.", "What is the history of {t} in one sentence?"];
const promptList = Array.from({ length: prompts }, (_, i) => ({ prompt: asks[Math.floor(i / topics.length) % asks.length].replace("{t}", topics[i % topics.length]) + (i >= 100 ? ` (variant ${i})` : "") }));

const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function json(path, init) {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const run = await json("/api/evals", { method: "POST", body: JSON.stringify({ name: `stress ${new Date().toISOString()}`, models, prompts: promptList, maxTokens }) });
const runId = run.id ?? run.run?.id;
log(`eval run ${runId}: ${prompts} prompts x ${models.length} models`);

async function burst() {
  const key = process.env.DO_MODEL_ACCESS_KEY;
  const statuses = {};
  await Promise.all(Array.from({ length: burstSize }, async (_, i) => {
    await new Promise((r) => setTimeout(r, i * 15));
    const res = await fetch("https://inference.do-ai.run/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: burstModel, messages: [{ role: "user", content: "Say ok" }], max_tokens: 3 }),
    });
    await res.text();
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
  }));
  log(`noisy neighbour burst on ${burstModel}: ${JSON.stringify(statuses)}`);
}

async function compare() {
  const started = Date.now();
  const res = await fetch(base + "/api/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "In one sentence: what is a token bucket?", models, maxTokens: 512, judge: { enabled: false }, synthesize: false }) });
  const text = await res.text();
  const waits = (text.match(/model\.waiting/g) ?? []).length;
  const retries = (text.match(/model\.retrying/g) ?? []).length;
  const done = (text.match(/model\.completed/g) ?? []).length;
  log(`interactive compare during the batch: ${done}/${models.length} completed in ${Date.now() - started} ms, ${waits} wait events, ${retries} retries`);
}

// DO counts requests per calendar minute, so the burst starts 3 s into a minute
// (the first such moment after --burst-at seconds): that leaves ~55 s of exhausted window.
const burstDelay = (() => {
  const earliest = Date.now() + burstAt * 1000;
  const minute = Math.ceil((earliest - 3_000) / 60_000) * 60_000 + 3_000;
  return minute - Date.now();
})();
if (burstModel) setTimeout(() => { log(`firing ${burstSize}-call burst on ${burstModel}`); void burst(); }, burstDelay);
// --compare-at is seconds after the burst starts (or after the run starts, without a burst).
if (compareAt !== undefined) setTimeout(() => void compare().catch((e) => log(`compare failed: ${e.message}`)), (burstModel ? burstDelay : 0) + compareAt * 1000);

for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  const detail = await json(`/api/evals/${runId}`);
  const p = detail.progress ?? detail.run?.progress;
  log(`status ${detail.status ?? detail.run?.status}: ${p?.completedCalls}/${p?.totalCalls} calls, ${p?.failedCalls} failed`);
  if (!["QUEUED", "RUNNING"].includes(detail.status ?? detail.run?.status)) break;
}
await new Promise((r) => setTimeout(r, 2_000)); // let the event sink flush
const { summary } = await json(`/api/ops/rate-events?tag=${runId}`);
console.table(summary.map((s) => ({ model: s.model, leases: s.granted, waited: s.waited, waitP95: s.waitP95Ms, timeouts: s.timeouts, "429s": s.rateLimited, retries: s.retries, retryP50: s.retryDelayP50Ms, retryMax: s.retryDelayMaxMs, failed: s.attemptsFailed, minFactor: s.minFactor })));
log(`timeline: ${base}/ops/rate-limits?tag=${runId}`);
