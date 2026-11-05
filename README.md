# Circle Recommendations

`GET /users/:id/recommendations` returns a ranked list of Circles a member should join, each with a
short, member-facing explanation. Zero npm dependencies: Node + SQLite (`node:sqlite`).

- **Design doc (1 page):** [docs/DESIGN.md](docs/DESIGN.md)
- **Schema, relationships, indexes:** [docs/SCHEMA.md](docs/SCHEMA.md) · DDL in [src/schema.sql](src/schema.sql)

## Run it

Requires **Node >= 22.13** (uses the built-in `node:sqlite`; no install step).

```bash
npm run seed                 # builds db/circles.db from data/*.json (also happens automatically on first start)
npm start                    # http://localhost:3000   (PORT=4000 npm start to change)
npm test                     # 8 tests: the 4 planted scenarios + invariants over all 100 users + HTTP contract

# Easiest way to explore: open http://localhost:3000 in a browser (pick a member, tick "Show scoring")
curl localhost:3000/users/23/recommendations
curl "localhost:3000/users/23/recommendations?limit=3&debug=1"   # + score components and why Circles were excluded
npm run recommend -- 15 5 --debug                               # same thing, readable in the terminal
```

### API

`GET /users/:id/recommendations?limit=5&debug=0|1` (`limit` 1-20, default 5)

```jsonc
{
  "user_id": 23,
  "as_of": "2026-09-21T00:00:00.000Z",
  "personalization": { "mode": "personalized", "signals": [{ "topic": "getting-promoted", "source": "stated" }] },
  "recommendations": [{
    "rank": 1,
    "circle": { "id": 22, "name": "Level Up Collective", "topic": "getting-promoted", "format": "hybrid",
                "join_policy": "request", "member_count": 14, "max_members": 20, "spots_left": 6,
                "leaders": [{ "name": "Aisha O.", "job_title": "Engineering Manager" }], "...": "..." },
    "score": 0.885,
    "explanation": "Matches your interest in Getting promoted; 3 of its 14 members share your interests; very active: 8 posts this month and a busy group chat.",
    "reasons": [{ "type": "interest", "text": "..." }, { "type": "activity", "text": "..." }],   // for UI chips
    "similar_circles": [{ "id": 11, "name": "..." }]       // near-duplicates collapsed into this result
  }]
}
```
Errors: `400` bad `limit`, `404` unknown user, `405` non-GET. `personalization.mode` is `personalized`
(stated interests), `inferred` (only memberships/profile text) or `cold_start` (nothing known).

## What happens to the four planted scenarios

| Scenario | User | Result |
| --- | --- | --- |
| Cold start | 42 | Ranked by Circle health + how welcoming it is; one Circle per topic for breadth; honest copy ("a welcoming, active place to start"), never claims personalization. Response flags `mode: cold_start` so the client can prompt for topics. |
| Obvious matches | 7 | #1 Elevation (leadership) and #6 Speak Up (public speaking) are #1 and #2. #5 Women Who Lead is near-identical to #1 (same topic, same description) and is surfaced under `similar_circles` rather than as a separate slot. |
| Duplicates | 15 | Exactly one of #10/#11/#12; the other two appear in `similar_circles`. The rest of the list covers her second interest (confidence → #13) and adjacent topics. |
| Full / inactive | 23 | #20 (full) and #21 (dormant, and unlisted) are filtered out; #22 Level Up is #1. `?debug=1` prints every exclusion with its reason. |

## Things worth knowing

- **"Now" is the dataset snapshot, not the wall clock.** The data is anchored at 2026-09-21; against today's
  date every Circle would look 6+ weeks dormant. `as_of` defaults to the newest timestamp in the data. Override with `AS_OF=now` or `AS_OF=2026-10-01`.
- Circles have no location field, so in-person Circles are treated as a riskier recommendation than virtual/hybrid (see DESIGN.md).
- Weights and thresholds are all in [src/config.js](src/config.js).

## Layout

```
src/schema.sql     DDL (tables, constraints, indexes)
src/db.js          seed from data/*.json + circle_features precompute
src/config.js      weights + thresholds
src/taxonomy.js    adjacent-topic graph + profile-text rules
src/scoring.js     eligibility filters, relevance, health, welcoming, peers
src/explain.js     member-facing reason/explanation templates
src/recommender.js orchestration: affinity -> filter -> score -> diversify -> explain
public/index.html  demo UI (served at /)
src/server.js      HTTP API   ·   src/cli.js  terminal view
test/              node:test suite
```

## How I Used AI

I used AI assistance during development to explore implementation approaches, review recommendation logic, and improve code clarity and documentation.

I focused on making the recommendations relevant, explainable, and consistent with the assignment requirements. I reviewed the scoring approach, edge-case handling, and generated explanations, using automated tests to validate the implementation.

AI served as a development aid rather than a substitute for understanding the solution. I can explain the architecture, scoring decisions, database design, and tradeoffs behind the implementation.
