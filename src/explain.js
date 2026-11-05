// Member-facing explanations. Deterministic templates over the same signals that produced the score,
// so the text can never claim something the ranking didn't use. Only aggregate, non-identifying
// facts are shown (no member names, no chat content).
import { daysBetween } from "./scoring.js";

const plural = (n, s, p = s + "s") => `${n} ${n === 1 ? s : p}`;

function ago(ts, asOf) {
  const d = Math.floor(daysBetween(ts, asOf));
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function buildReasons({ circle, rel, peers, features, asOf, topicLabel, coldStart, memberCircleNames }) {
  const reasons = [];
  const top = rel.hits[0];

  if (top) {
    const label = topicLabel(top.interest);
    if (top.source === "stated") {
      reasons.push({
        type: "interest",
        text: top.kind === "related"
          ? `Related to your interest in ${label}`
          : top.kind === "tag"
            ? `Covers ${label.toLowerCase()}, one of your interests`
            : `Matches your interest in ${label}`,
      });
    } else if (top.source === "membership") {
      reasons.push({ type: "membership", text: `Pairs well with ${memberCircleNames.get(top.interest) ?? "a Circle you've joined"}, which you're already in` });
    } else {
      const how = top.kind === "primary" ? "is focused on" : top.kind === "tag" ? "covers" : "is related to";
      reasons.push({ type: "profile", text: `Your bio mentions ${top.phrase}, and this Circle ${how} ${label.toLowerCase()}` });
    }
  }

  if (peers && peers.n >= 3 && peers.n / peers.of >= 0.2) {
    reasons.push({ type: "peers", text: `${peers.n} of its ${plural(peers.of, "member")} share your interests` });
  }

  const idle = daysBetween(circle.last_activity_at, asOf);
  if (circle.feed_posts_30d >= 8 || circle.chat_messages_30d >= 100) {
    reasons.push({ type: "activity", text: `Very active: ${plural(circle.feed_posts_30d, "post")} this month and a busy group chat` });
  } else if (circle.feed_posts_30d >= 3 && idle <= 14) {
    reasons.push({ type: "activity", text: `Active: ${plural(circle.feed_posts_30d, "post")} this month, last activity ${ago(circle.last_activity_at, asOf)}` });
  } else if (idle <= 14) {
    reasons.push({ type: "activity", text: `Recently active (last activity ${ago(circle.last_activity_at, asOf)})` });
  }

  const spots = circle.max_members == null ? null : circle.max_members - circle.member_count;
  if (features.joins_30d >= 2) reasons.push({ type: "welcoming", text: `${plural(features.joins_30d, "member")} joined this month` });
  if (spots != null && spots <= 3) reasons.push({ type: "availability", text: `Only ${plural(spots, "spot")} left` });
  reasons.push({
    type: "join",
    text: circle.join_policy === "open" ? "Open to join right away" : "Join by request; the Circle's leaders approve new members",
  });

  if (coldStart && !reasons.some((r) => r.type === "interest")) {
    reasons.unshift({ type: "popular", text: circle.topic_label ? `A welcoming, active place to start, with conversation on ${circle.topic_label.toLowerCase()}` : "A welcoming, active community to start with" });
  } else if (!top && !reasons.some((r) => r.type === "popular")) {
    reasons.unshift({ type: "popular", text: "Popular right now with members like you" });
  }
  return reasons;
}

/** One short paragraph: strongest reason first, then at most two supporting facts. */
export function summarize(reasons) {
  const lead = reasons[0].text;
  const rest = reasons.slice(1).filter((r) => r.type !== "join").slice(0, 2).map((r) => r.text);
  const parts = [lead, ...rest];
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join("; ") + ".";
}
