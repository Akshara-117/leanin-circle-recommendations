// All tunables live here so the ranking is easy to reason about, explain and adjust.
export const CONFIG = {
  // Eligibility (hard filters) --------------------------------------------------
  maxDaysSinceActivity: 60,            // older than this => dormant, never recommended
  minRecentActivity: { posts: 1, chat: 5 }, // 30d: below BOTH => dormant even if last_activity is fresh-ish

  // Score weights (each component is normalised to 0..1) ------------------------
  weights: {
    personalized: { relevance: 0.5, health: 0.25, peers: 0.1, welcoming: 0.1, quality: 0.05 },
    cold_start:   { relevance: 0,   health: 0.6,  peers: 0,   welcoming: 0.3, quality: 0.1  },
  },

  // Interest affinity by evidence source (max of sources, not sum) --------------
  affinity: { stated: 1.0, profile: 0.45, membership: 0.4 },
  // How a Circle's topic evidence is weighted (adjacent topics use taxonomy.js closeness)
  circleTopic: { primary: 1.0, tag: 0.6 },
  secondInterestBonus: 0.15,

  // Health sub-weights -----------------------------------------------------------
  health: { posts: 0.30, chat: 0.25, recency: 0.20, engagement: 0.15, breadth: 0.10 },
  recencyHalfLifeDays: 14,

  // Diversity ---------------------------------------------------------------------
  sameTopicPenalty: 0.6,               // each already-picked Circle on the same topic multiplies by this
  defaultLimit: 5,
  maxLimit: 20,
};
