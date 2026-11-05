import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DB_PATH = join(ROOT, "db", "circles.db");
const readJson = (f) => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));

const DAY = 86400000;

/** Create (or recreate) the database from schema.sql + data/*.json. Returns an open handle. */
export function seed(path = DEFAULT_DB_PATH) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return buildSync(path);
}

function buildSync(path) {
  if (path !== ":memory:") for (const s of ["", "-wal", "-shm"]) { try { unlinkSync(path + s); } catch {} }
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(ROOT, "src", "schema.sql"), "utf8"));

  const topics = readJson("topics.json");
  const users = readJson("users.json");
  const circles = readJson("circles.json");
  const memberships = readJson("memberships.json");
  const posts = readJson("activity.json");
  const topicId = new Map(topics.map((t) => [t.slug, t.id]));

  const tx = (fn) => { db.exec("BEGIN"); try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } };
  tx(() => {
    const insTopic = db.prepare("INSERT INTO topics VALUES (?,?,?,?)");
    for (const t of topics) insTopic.run(t.id, t.slug, t.label, t.domain);

    const insUser = db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insUT = db.prepare("INSERT INTO user_topics VALUES (?,?)");
    for (const u of users) {
      insUser.run(u.id, u.first_name, u.last_name, u.has_photo ? 1 : 0, u.bio, u.job_title, u.company,
        u.industry, u.location, u.joined_at, u.profile_completeness);
      for (const slug of u.topic_interests) {
        if (!topicId.has(slug)) throw new Error(`unknown topic ${slug} for user ${u.id}`);
        insUT.run(u.id, topicId.get(slug));
      }
    }

    const insCircle = db.prepare("INSERT INTO circles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insTag = db.prepare("INSERT OR IGNORE INTO circle_tags VALUES (?,?)");
    for (const c of circles) {
      insCircle.run(c.id, c.slug, c.name, c.description, c.topic ? topicId.get(c.topic) : null,
        c.cover_image_url, c.format, c.access, c.join_policy, c.max_members, c.member_count,
        c.created_at, c.last_activity_at, c.feed_posts_30d, c.chat_messages_30d);
      for (const tag of c.tags) insTag.run(c.id, tag);
    }

    const insM = db.prepare("INSERT INTO memberships VALUES (?,?,?,?)");
    for (const m of memberships) insM.run(m.user_id, m.circle_id, m.role, m.joined_at);

    const insP = db.prepare("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?)");
    for (const p of posts) insP.run(p.id, p.circle_id, p.author_user_id, p.body, p.reaction_count,
      p.comment_count, p.save_count, p.created_at);
  });

  // Sanity: denormalized member_count must agree with memberships.
  const drift = db.prepare(`SELECT c.id, c.member_count, COUNT(m.user_id) n FROM circles c
    LEFT JOIN memberships m ON m.circle_id = c.id GROUP BY c.id HAVING n != c.member_count`).all();
  if (drift.length) console.warn(`warning: member_count drift on circles ${drift.map((d) => d.id)}`);

  computeFeatures(db);
  return db;
}

/** The dataset's reference "now": the newest timestamp in the snapshot (see README: AS_OF). */
export function snapshotTime(db) {
  const r = db.prepare(`SELECT MAX(t) AS t FROM (
      SELECT MAX(last_activity_at) t FROM circles UNION ALL SELECT MAX(created_at) FROM posts
      UNION ALL SELECT MAX(joined_at) FROM memberships)`).get();
  return new Date(r.t);
}

/** Precompute per-Circle aggregates from raw posts/memberships (nightly job in production). */
export function computeFeatures(db, asOf = snapshotTime(db)) {
  const since = new Date(asOf.getTime() - 30 * DAY).toISOString();
  db.exec("DELETE FROM circle_features");
  db.prepare(`
    INSERT INTO circle_features (circle_id, posts_window, engagement_per_post, distinct_posters,
                                 poster_share, joins_30d, computed_at)
    SELECT c.id,
           COALESCE(p.n, 0),
           COALESCE(p.eng, 0),
           COALESCE(p.authors, 0),
           CASE WHEN c.member_count > 0 THEN COALESCE(p.authors, 0) * 1.0 / c.member_count ELSE 0 END,
           COALESCE(j.n, 0),
           ?
    FROM circles c
    LEFT JOIN (SELECT circle_id, COUNT(*) n, COUNT(DISTINCT author_user_id) authors,
                      AVG(reaction_count + 2.0 * comment_count + 1.5 * save_count) eng
               FROM posts WHERE created_at >= ? GROUP BY circle_id) p ON p.circle_id = c.id
    LEFT JOIN (SELECT circle_id, COUNT(*) n FROM memberships WHERE joined_at >= ? GROUP BY circle_id) j
           ON j.circle_id = c.id`).run(asOf.toISOString(), since, since);
}

export function openDb(path = DEFAULT_DB_PATH) {
  if (path !== ":memory:" && !existsSync(path)) return seed(path);
  return new DatabaseSync(path);
}
