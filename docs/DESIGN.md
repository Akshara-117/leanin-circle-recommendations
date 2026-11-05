# Technical Design: Circle Recommendation Engine

## 1. Overview
Built a recommendation API using **Node.js and SQLite** that returns ranked Lean In Circles with member-friendly explanations.

**Endpoint:** `GET /users/:id/recommendations`

**Pipeline:** Build user interest profile → Filter ineligible Circles → Score candidates → Diversify results → Generate explanations.

## 2. Recommendation Strategy
User interests are derived from stated topics (weight 1.0), profile text (0.45), and existing Circle memberships (0.4). A small curated topic graph identifies related interests.

Eligible Circles are ranked using five weighted signals:

| Signal | Weight | Purpose |
|---|---:|---|
| Topic relevance | 50% | Match primary, tagged, and related interests |
| Circle health | 25% | Evaluate recent activity, engagement, and participation |
| Peer similarity | 10% | Measure shared interests among existing members |
| Joinability | 10% | Consider capacity, joining rules, size, and format |
| Listing quality | 5% | Reward informative Circle descriptions and metadata |

**Hard filters:** Exclude Circles the user already belongs to, unlisted Circles, full Circles, and dormant Circles (no activity for 60 days or insufficient activity in the last 30 days).

**Diversity:** Collapse near-duplicate Circles into the strongest recommendation and reduce repeated same-topic recommendations.

## 3. Edge Cases and Explainability
- **Cold-start users:** Recommend healthy, joinable Circles across different topics without inventing personalized matches.
- **Strong interest matches:** Prioritize relevant topics while considering Circle health.
- **Near-duplicates:** Surface the strongest option and identify similar alternatives.
- **Full or inactive Circles:** Remove them before ranking.

Explanations use deterministic templates grounded in actual scoring signals. They reference aggregate activity and shared interests without exposing private member information.

## 4. Data Model and Performance
SQLite stores users, topics, Circles, memberships, and activity records. Relational keys and indexes support membership checks, topic matching, and activity lookups. See `docs/SCHEMA.md` for the complete schema and indexing rationale.

The current implementation scores the seeded dataset directly. For larger datasets, topic-based candidate retrieval, precomputed Circle-health metrics, and cached recommendations would reduce latency.

## 5. Tradeoffs and Future Improvements
- **Rule-based ranking over machine learning:** Explainable and testable without historical recommendation outcomes.
- **Keyword-based topic matching:** Simple and transparent; embeddings could improve semantic matching and duplicate detection.
- **Activity-based health:** Helps avoid dormant communities but may disadvantage new Circles; production ranking should include exploration and fairness checks.
- **Capacity and location:** Recheck capacity when joining; add geographic filtering when location data becomes available.

Future improvements include learning weights from joins and retention, authentication, rate limiting, and monitoring recommendation quality.

**Validation:** Automated tests cover cold-start users, obvious matches, duplicate Circles, full/inactive Circles, and recommendations across all 100 seeded users.