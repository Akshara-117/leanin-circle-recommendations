import http from "node:http";
import { openDb } from "./db.js";
import { recommend, UserNotFound } from "./recommender.js";
import { CONFIG } from "./config.js";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const PAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "index.html");
const SCENARIOS = { 42: "Cold start", 7: "Obvious matches", 15: "Duplicate Circles", 23: "Full / inactive Circles" };

export function createServer(db) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body, null, 2));
    };
    if (req.method !== "GET") return send(405, { error: "method_not_allowed" });
    if (url.pathname === "/health") return send(200, { ok: true });
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(PAGE));
    }
    if (url.pathname === "/users") {
      const rows = db.prepare(`SELECT u.id, u.first_name, u.last_name, u.job_title, u.industry, u.location, u.bio,
        u.profile_completeness, (SELECT group_concat(t.label, ', ') FROM user_topics ut JOIN topics t ON t.id = ut.topic_id
        WHERE ut.user_id = u.id) AS interests, (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS circles_joined
        FROM users u ORDER BY u.id`).all();
      return send(200, rows.map((r) => ({ ...r, scenario: SCENARIOS[r.id] ?? null })));
    }

    const m = url.pathname.match(/^\/users\/(\d+)\/recommendations\/?$/);
    if (!m) return send(404, { error: "not_found", hint: "GET /users/:id/recommendations?limit=5&debug=1" });

    const limitParam = url.searchParams.get("limit");
    const limit = limitParam == null ? CONFIG.defaultLimit : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > CONFIG.maxLimit)
      return send(400, { error: "bad_limit", message: `limit must be an integer 1-${CONFIG.maxLimit}` });
    try {
      send(200, recommend(db, Number(m[1]), { limit, debug: ["1", "true"].includes(url.searchParams.get("debug")) }));
    } catch (e) {
      if (e instanceof UserNotFound) return send(404, { error: "user_not_found", message: e.message });
      console.error(e);
      send(500, { error: "internal_error" });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const db = openDb(process.env.DB_PATH);
  createServer(db).listen(port, () => console.log(`Circle recommendations API on http://localhost:${port}  (try /users/7/recommendations)`));
}
