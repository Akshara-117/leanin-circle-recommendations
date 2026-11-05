import { CONFIG } from "./config.js";
import { RELATED } from "./taxonomy.js";

const DAY = 86400000;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const logNorm = (x, cap) => clamp01(Math.log1p(Math.max(0, x)) / Math.log1p(cap));

export const daysBetween = (a, b) => (b.getTime() - new Date(a).getTime()) / DAY;

/** Hard filters: why a Circle must NOT be shown. Returns a reason string or null if eligible. */
export function ineligibleReason(c, memberCircleIds, asOf) {
  if (memberCircleIds.has(c.id)) return "already_member";
  if (c.access !== "public") return "unlisted";
  if (c.max_members != null && c.member_count >= c.max_members) return "full";
  const idle = daysBetween(c.last_activity_at, asOf);
  const { posts, chat } = CONFIG.minRecentActivity;
  if (idle > CONFIG.maxDaysSinceActivity || (c.feed_posts_30d < posts && c.chat_messages_30d < chat)) return "inactive";
  return null;
}

/** Is the Circle alive and thriving? 0..1, from posts, chat, recency, engagement and participation breadth. */
export function healthScore(c, f, asOf) {
  const w = CONFIG.health;
  const idle = Math.max(0, daysBetween(c.last_activity_at, asOf));
  return clamp01(
    w.posts * logNorm(c.feed_posts_30d, 20) +
    w.chat * logNorm(c.chat_messages_30d, 200) +
    w.recency * Math.pow(0.5, idle / CONFIG.recencyHalfLifeDays) +
    w.engagement * logNorm(f.engagement_per_post, 30) +
    w.breadth * clamp01(f.poster_share / 0.5));
}

/**
 * Would this member plausibly join and stay? Open policy, mid-sized group, room to join,
 * recent joiners, and format fit. Circles carry no location in the data, so an in-person
 * Circle is a gamble for everyone and a poor bet for remote members; virtual/hybrid are safe.
 */
export function welcomingScore(c, f, user) {
  const size = c.member_count;
  // triangular: 3 members is thin (0.4), 10-25 is the sweet spot (1.0), 40+ gets impersonal
  const sizeFit = size < 10 ? 0.4 + 0.6 * clamp01((size - 3) / 7) : size <= 25 ? 1 : clamp01(1 - (size - 25) / 30);
  const spotsLeft = c.max_members == null ? Infinity : c.max_members - c.member_count;
  const remote = /remote/i.test(user.location || "");
  const formatFit = c.format !== "in_person" ? 1 : remote ? 0.15 : 0.4;
  return clamp01(
    0.25 * (c.join_policy === "open" ? 1 : 0.7) +
    0.25 * sizeFit +
    0.10 * (spotsLeft >= 3 ? 1 : 0.5) +
    0.10 * clamp01(f.joins_30d / 3) +
    0.30 * formatFit);
}

/**
 * Share of a Circle's members who share the member's interests, shrunk toward zero for small
 * Circles (3 of 4 is weaker evidence than 12 of 24). 0..1.
 */
export function peerScore(n, of) {
  return clamp01((n / (of + 8)) / 0.35);
}

/** Can a member tell what this Circle is? (description, cover image, topic) */
export function qualityScore(c) {
  return (c.description ? 0.5 : 0) + (c.cover_image_url ? 0.2 : 0) + (c.topic_slug ? 0.3 : 0);
}

/**
 * Topic relevance of a Circle to the member's affinity map (slug -> {weight, source, ...}).
 * Evidence: primary topic (1.0), tags (0.6), adjacent topics (discounted). Best match plus
 * a small bonus for a second, different interest being covered.
 */
export function relevance(circle, affinity) {
  const ev = new Map(); // circle topic slug -> weight
  const put = (slug, w) => ev.set(slug, Math.max(ev.get(slug) || 0, w));
  const T = CONFIG.circleTopic;
  if (circle.topic_slug) put(circle.topic_slug, T.primary);
  for (const t of circle.tags) put(t, T.tag);

  const hits = []; // {interest, circleTopic, score, kind}
  for (const [interest, a] of affinity) {
    let best = null;
    const direct = ev.get(interest);
    // Membership implies the member already has this topic covered: it only seeds *adjacent* topics.
    if (direct && a.source !== "membership") best = { score: a.weight * direct, kind: direct === T.primary ? "primary" : "tag", circleTopic: interest };
    for (const [circleTopic, cw] of ev) {
      const rel = RELATED.get(interest)?.get(circleTopic);
      if (!rel) continue;
      const s = a.weight * cw * rel; // closeness `rel` (<=0.6) is the discount
      if (!best || s > best.score) best = { score: s, kind: "related", circleTopic };
    }
    if (best) hits.push({ interest, source: a.source, phrase: a.phrase, ...best });
  }
  hits.sort((x, y) => y.score - x.score);
  const top = hits[0]?.score || 0;
  // second bonus only for a *different* interest matched by a *different* circle topic
  const second = hits.find((h, i) => i > 0 && h.interest !== hits[0].interest)?.score || 0;
  return { score: clamp01(top + CONFIG.secondInterestBonus * second), hits };
}
