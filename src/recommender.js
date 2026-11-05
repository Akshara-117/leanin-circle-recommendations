import { CONFIG } from "./config.js";
import { inferFromProfile } from "./taxonomy.js";
import { snapshotTime } from "./db.js";
import { ineligibleReason, healthScore, welcomingScore, qualityScore, relevance, peerScore } from "./scoring.js";
import { buildReasons, summarize } from "./explain.js";

const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

export class UserNotFound extends Error {}

/** Reference "now". Defaults to the snapshot's newest timestamp so a static dataset doesn't look dormant. */
export function resolveAsOf(db, override = process.env.AS_OF) {
  if (!override) return snapshotTime(db);
  if (override === "now") return new Date();
  const d = new Date(override);
  if (isNaN(d)) throw new Error(`Invalid AS_OF: ${override}`);
  return d;
}

function loadCircles(db) {
  const rows = db.prepare(`
    SELECT c.*, t.slug AS topic_slug, t.label AS topic_label,
           f.engagement_per_post, f.poster_share, f.joins_30d, f.distinct_posters
    FROM circles c
    LEFT JOIN topics t ON t.id = c.topic_id
    JOIN circle_features f ON f.circle_id = c.id`).all();
  const tags = db.prepare("SELECT circle_id, tag FROM circle_tags").all();
  const byId = new Map(rows.map((r) => [r.id, { ...r, tags: [] }]));
  for (const t of tags) byId.get(t.circle_id).tags.push(t.tag);
  return [...byId.values()];
}

function loadLeaders(db) {
  const rows = db.prepare(`SELECT m.circle_id, u.first_name, u.last_name, u.job_title, u.company
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'leader' ORDER BY m.joined_at`).all();
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.circle_id)) out.set(r.circle_id, []);
    out.get(r.circle_id).push({ name: `${r.first_name} ${r.last_name[0]}.`, job_title: r.job_title, company: r.company });
  }
  return out;
}

/** Build the member's interest-affinity map: stated > Circles they joined > profile text. */
function buildAffinity(db, user, topicLabels) {
  const A = CONFIG.affinity;
  const affinity = new Map(); // slug -> {weight, source, phrase?}
  const put = (slug, weight, source, phrase) => {
    const cur = affinity.get(slug);
    if (!cur || weight > cur.weight) affinity.set(slug, { weight, source, phrase });
  };
  const stated = db.prepare("SELECT t.slug FROM user_topics ut JOIN topics t ON t.id = ut.topic_id WHERE ut.user_id = ?").all(user.id);
  for (const s of stated) put(s.slug, A.stated, "stated");

  const joined = db.prepare(`SELECT c.id, c.name, t.slug topic FROM memberships m JOIN circles c ON c.id = m.circle_id
    LEFT JOIN topics t ON t.id = c.topic_id WHERE m.user_id = ?`).all(user.id);
  const memberCircleNames = new Map();
  for (const j of joined) if (j.topic) { put(j.topic, A.membership, "membership"); if (!memberCircleNames.has(j.topic)) memberCircleNames.set(j.topic, j.name); }

  for (const p of inferFromProfile(user)) if (topicLabels.has(p.topic)) put(p.topic, A.profile, "profile", p.phrase);
  return { affinity, memberCircleIds: new Set(joined.map((j) => j.id)), memberCircleNames, statedCount: stated.length };
}

/** Per-Circle share of members whose stated interests overlap the member's affinity topics (aggregate only). */
function peerOverlap(db, userId, topicSlugs) {
  if (!topicSlugs.length) return new Map();
  const ph = topicSlugs.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT m.circle_id,
           COUNT(DISTINCT m.user_id) AS n
    FROM memberships m
    JOIN user_topics ut ON ut.user_id = m.user_id
    JOIN topics t ON t.id = ut.topic_id
    WHERE t.slug IN (${ph}) AND m.user_id != ?
    GROUP BY m.circle_id`).all(...topicSlugs, userId);
  return new Map(rows.map((r) => [r.circle_id, r.n]));
}

const normDesc = (s) => (s ? s.trim().toLowerCase().replace(/\s+/g, " ") : null);

/**
 * Greedy diversity re-rank.
 *  - near-duplicates (same topic + same description) collapse into the best one, exposed as `similar`
 *  - same-topic repeats are down-weighted so the list covers more of the member's interests
 */
function diversify(scored, limit) {
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const picked = [];
  const perTopic = new Map();
  const dupKey = (s) => (s.circle.topic_slug && normDesc(s.circle.description) ? `${s.circle.topic_slug}|${normDesc(s.circle.description)}` : null);
  while (picked.length < limit && pool.length) {
    let bestI = 0, bestAdj = -1;
    pool.forEach((s, i) => {
      const adj = s.score * Math.pow(CONFIG.sameTopicPenalty, perTopic.get(s.circle.topic_slug ?? `c${s.circle.id}`) || 0);
      if (adj > bestAdj) { bestAdj = adj; bestI = i; }
    });
    const [win] = pool.splice(bestI, 1);
    const k = dupKey(win);
    win.similar = [];
    if (k) for (let i = pool.length - 1; i >= 0; i--) if (dupKey(pool[i]) === k) win.similar.unshift(pool.splice(i, 1)[0]);
    win.adjScore = bestAdj;
    const tk = win.circle.topic_slug ?? `c${win.circle.id}`;
    perTopic.set(tk, (perTopic.get(tk) || 0) + 1);
    picked.push(win);
  }
  return picked;
}

export function recommend(db, userId, { limit = CONFIG.defaultLimit, debug = false, asOf = resolveAsOf(db) } = {}) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) throw new UserNotFound(`user ${userId} not found`);

  const topics = db.prepare("SELECT slug, label FROM topics").all();
  const topicLabels = new Map(topics.map((t) => [t.slug, t.label]));
  const { affinity, memberCircleIds, memberCircleNames, statedCount } = buildAffinity(db, user, topicLabels);
  const coldStart = affinity.size === 0;
  const mode = coldStart ? "cold_start" : statedCount > 0 ? "personalized" : "inferred";
  const W = CONFIG.weights[coldStart ? "cold_start" : "personalized"];

  const circles = loadCircles(db);
  const leaders = loadLeaders(db);
  const peerN = peerOverlap(db, user.id, [...affinity.keys()]);

  const excluded = [];
  const scored = [];
  for (const c of circles) {
    const why = ineligibleReason(c, memberCircleIds, asOf);
    if (why) { excluded.push({ id: c.id, name: c.name, reason: why }); continue; }
    const f = c;
    const rel = relevance(c, affinity);
    const health = healthScore(c, f, asOf);
    const welcoming = welcomingScore(c, f, user);
    const quality = qualityScore(c);
    const peers = peerN.has(c.id) ? { n: peerN.get(c.id), of: c.member_count } : null;
    const peerS = peers ? peerScore(peers.n, peers.of) : 0;
    const score = W.relevance * rel.score + W.health * health + W.peers * peerS + W.welcoming * welcoming + W.quality * quality;
    scored.push({ circle: c, rel, peers, score, parts: { relevance: rel.score, health, peers: peerS, welcoming, quality } });
  }

  const picked = diversify(scored, Math.min(limit, CONFIG.maxLimit));
  const recommendations = picked.map((s, i) => {
    const c = s.circle;
    const reasons = buildReasons({
      circle: c, rel: s.rel, peers: s.peers, features: c, asOf, coldStart,
      topicLabel: (slug) => topicLabels.get(slug) ?? slug, memberCircleNames,
    });
    const out = {
      rank: i + 1,
      circle: {
        id: c.id, name: c.name, description: c.description, topic: c.topic_slug, topic_label: c.topic_label,
        format: c.format, join_policy: c.join_policy, cover_image_url: c.cover_image_url,
        member_count: c.member_count, max_members: c.max_members,
        spots_left: c.max_members == null ? null : c.max_members - c.member_count,
        leaders: leaders.get(c.id) ?? [],
      },
      score: round(s.adjScore),
      explanation: summarize(reasons),
      reasons,
      similar_circles: s.similar.map((x) => ({ id: x.circle.id, name: x.circle.name })),
    };
    if (debug) out.debug = { raw_score: round(s.score), components: Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, round(v)])),
      matched: s.rel.hits.slice(0, 3).map((h) => ({ interest: h.interest, via: h.kind, source: h.source, score: round(h.score) })) };
    return out;
  });

  const res = {
    user_id: user.id,
    as_of: asOf.toISOString(),
    personalization: {
      mode, // personalized | inferred (only from profile/memberships) | cold_start
      signals: [...affinity].map(([topic, a]) => ({ topic, source: a.source })),
      ...(coldStart && { note: "No interests, memberships or profile text yet; ranked by Circle health and how welcoming it is. Ask the member to pick topics to personalize." }),
    },
    recommendations,
  };
  if (debug) res.debug = { excluded, candidates_considered: scored.length };
  return res;
}
