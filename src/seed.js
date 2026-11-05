import { seed, DEFAULT_DB_PATH, snapshotTime } from "./db.js";
const db = seed(process.env.DB_PATH || DEFAULT_DB_PATH);
const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
console.log(`Seeded ${process.env.DB_PATH || DEFAULT_DB_PATH}: users=${n("users")} circles=${n("circles")} ` +
  `memberships=${n("memberships")} posts=${n("posts")} (snapshot ${snapshotTime(db).toISOString()})`);
