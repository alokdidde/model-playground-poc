// Rate-limit stress test: many people comparing at once.
//
// Fires --compares parallel compares (each with every model in --models)
// through the app's own API, like a crowd of users pressing Run together, then
// prints the rate-event summary for that window: how many calls waited for
// capacity and how long, how many 429s came back, how long each retry slept,
// what the AIMD factor did, and how many compares ended with failed models.
//
//   node scripts/stress-compare.mjs --base http://localhost:3000 --compares 40 \
//        --models mistral-3-14B,glm-5.3-flash --stagger-ms 100
//
// Each compare is a few paid calls per model (answer only: judge and synthesis
// are off unless --judge is passed), so 40 compares x 2 models is 80 short calls.
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const base = args.base ?? "http://localhost:3000";
const compares = Number(args.compares ?? 20);
const models = (args.models ?? "mistral-3-14B,glm-5.3-flash").split(",");
const maxTokens = Number(args["max-tokens"] ?? 256);
const staggerMs = Number(args["stagger-ms"] ?? 0);
const judge = args.judge === "on";

const topics = ["photosynthesis", "TCP slow start", "the French revolution", "black holes", "vaccines", "inflation", "recursion", "plate tectonics", "the Krebs cycle", "public key cryptography"];

const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function compare(i) {
  await new Promise((r) => setTimeout(r, i * staggerMs));
  const started = Date.now();
  const res = await fetch(base + "/api/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: `In two sentences: explain ${topics[i % topics.length]}. (#${i})`,
      models,
      maxTokens,
      judge: { enabled: judge },
      synthesize: false,
    }),
  });
  const text = await res.text();
  const count = (name) => (text.match(new RegExp(`"type":"${name}"`, "g")) ?? []).length;
  return {
    status: res.status,
    ms: Date.now() - started,
    completed: count("model.completed"),
    failed: count("model.failed"),
    waits: count("model.waiting"),
    retries: count("model.retrying"),
  };
}

log(`${compares} compares x ${models.length} models (${compares * models.length} answer calls), max_tokens ${maxTokens}`);
const since = new Date();
const results = await Promise.all(Array.from({ length: compares }, (_, i) => compare(i).catch((e) => ({ status: 0, error: e.message }))));
const ok = results.filter((r) => r.failed === 0 && r.completed === models.length).length;
const ms = results.map((r) => r.ms ?? 0).sort((a, b) => a - b);
log(`${ok}/${compares} compares fully answered; ${results.reduce((s, r) => s + (r.failed ?? 0), 0)} model answers failed`);
log(`compare wall time p50 ${ms[Math.floor(ms.length / 2)]} ms, max ${ms.at(-1)} ms; ${results.reduce((s, r) => s + (r.waits ?? 0), 0)} waits, ${results.reduce((s, r) => s + (r.retries ?? 0), 0)} retries seen by users`);

await new Promise((r) => setTimeout(r, 2_000)); // let the event sink flush
const minutes = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 60_000) + 1);
const { summary } = await (await fetch(`${base}/api/ops/rate-events?minutes=${minutes}`)).json();
console.table(summary.map((s) => ({ model: s.model, leases: s.granted, waited: s.waited, waitP95: s.waitP95Ms, timeouts: s.timeouts, "429s": s.rateLimited, retries: s.retries, retryP50: s.retryDelayP50Ms, retryMax: s.retryDelayMaxMs, failed: s.attemptsFailed, minFactor: s.minFactor })));
log(`timeline: ${base}/ops/rate-limits?minutes=${minutes}`);
