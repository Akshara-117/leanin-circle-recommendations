// Hand-curated "adjacent topic" graph (symmetric). Gives partial credit when a member's
// interest has no exact Circle (e.g. wants imposter-syndrome help -> confidence Circles).
// Production would learn this from co-membership / co-interest data; see DESIGN.md.
const PAIRS = [
  ["confidence", "imposter-syndrome", 0.6],
  ["confidence", "public-speaking", 0.5],
  ["negotiation", "getting-promoted", 0.5],
  ["getting-promoted", "visibility-recognition", 0.5],
  ["getting-promoted", "sponsorship-mentorship", 0.5],
  ["visibility-recognition", "public-speaking", 0.4],
  ["leadership-skills", "managing-a-team", 0.5],
  ["leadership-skills", "visibility-recognition", 0.3],
  ["managing-a-team", "giving-feedback", 0.5],
  ["managing-up", "communication", 0.5],
  ["communication", "difficult-conversations", 0.5],
  ["communication", "public-speaking", 0.4],
  ["giving-feedback", "difficult-conversations", 0.4],
  ["stress-burnout", "resilience", 0.6],
  ["stress-burnout", "work-life-integration", 0.5],
  ["networking", "sponsorship-mentorship", 0.5],
  ["gender-bias", "allyship", 0.5],
  ["gender-bias", "being-the-only-one", 0.5],
  ["career-breaks", "work-life-integration", 0.4],
  ["working-motherhood", "work-life-integration", 0.6],
  ["working-motherhood", "career-breaks", 0.3],
];
export const RELATED = new Map();
for (const [a, b, w] of PAIRS) {
  if (!RELATED.has(a)) RELATED.set(a, new Map());
  if (!RELATED.has(b)) RELATED.set(b, new Map());
  RELATED.get(a).set(b, w);
  RELATED.get(b).set(a, w);
}

// Weak, transparent profile-text signals for members with few/no stated interests.
// `phrase` is what we show the member ("your bio mentions ..."), so it is always their own words.
const BIO_RULES = [
  { re: /career break|returning to work/i, topics: ["career-breaks"], phrase: "returning to work after a career break" },
  { re: /first-time manager|new manager/i, topics: ["managing-a-team", "giving-feedback"], phrase: "being a first-time manager" },
  { re: /executive presence/i, topics: ["leadership-skills", "visibility-recognition", "public-speaking"], phrase: "executive presence" },
  { re: /leadership/i, topics: ["leadership-skills"], phrase: "leadership" },
  { re: /comp conversation|compensation|salary/i, topics: ["negotiation", "confidence"], phrase: "a compensation conversation" },
  { re: /pay equity/i, topics: ["negotiation", "getting-promoted", "gender-bias"], phrase: "pay equity" },
  { re: /promotion|next level/i, topics: ["getting-promoted"], phrase: "growing into your next role" },
  { re: /career changer|ex-consultant/i, topics: ["networking", "confidence"], phrase: "changing careers" },
  { re: /mentor/i, topics: ["sponsorship-mentorship"], phrase: "mentoring" },
  { re: /confiden/i, topics: ["confidence"], phrase: "confidence" },
];
const TITLE_RULES = [
  { re: /manager|director|head of/i, topics: ["managing-a-team"], phrase: "your role as a manager" },
  { re: /founder|chief|\bvp\b/i, topics: ["leadership-skills"], phrase: "your role as a founder or executive" },
];
export function inferFromProfile(user) {
  const out = []; // {topic, phrase, source}
  for (const [text, rules, source] of [[user.bio, BIO_RULES, "bio"], [user.job_title, TITLE_RULES, "job_title"]]) {
    if (!text) continue;
    for (const r of rules) if (r.re.test(text)) for (const t of r.topics) out.push({ topic: t, phrase: r.phrase, source });
  }
  return out;
}
