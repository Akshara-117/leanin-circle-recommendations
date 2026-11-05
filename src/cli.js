// Human-readable output:  npm run recommend -- 23 [limit] [--debug]
import { openDb } from "./db.js";
import { recommend } from "./recommender.js";
const args = process.argv.slice(2);
const debug = args.includes("--debug");
const [id, limit] = args.filter((a) => !a.startsWith("--")).map(Number);
if (!id) { console.error("usage: npm run recommend -- <user_id> [limit] [--debug]"); process.exit(1); }
const r = recommend(openDb(process.env.DB_PATH), id, { limit: limit || 5, debug });
console.log(`User ${r.user_id}  mode=${r.personalization.mode}  signals=${r.personalization.signals.map((s) => `${s.topic}(${s.source})`).join(", ") || "none"}`);
for (const x of r.recommendations) {
  console.log(`\n${x.rank}. #${x.circle.id} ${x.circle.name}  [${x.circle.topic ?? "no topic"}, ${x.circle.format}]  score=${x.score}`);
  console.log(`   ${x.explanation}`);
  if (x.similar_circles.length) console.log(`   (similar: ${x.similar_circles.map((s) => `#${s.id} ${s.name}`).join(", ")})`);
  if (debug) console.log(`   ${JSON.stringify(x.debug)}`);
}
if (debug) console.log("\nexcluded:", r.debug.excluded.map((e) => `#${e.id}:${e.reason}`).join(" "));
