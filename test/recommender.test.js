import { test, before } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/db.js";
import { recommend } from "../src/recommender.js";
import { createServer } from "../src/server.js";

let db;
before(() => { db = seed(":memory:"); });
const ids = (r) => r.recommendations.map((x) => x.circle.id);
const debugRec = (u, limit = 5) => recommend(db, u, { limit, debug: true });

test("cold start (user 42): full list, no personalization claims, diverse topics, all healthy", () => {
  const r = debugRec(42);
  assert.equal(r.personalization.mode, "cold_start");
  assert.equal(r.recommendations.length, 5);
  const topics = r.recommendations.map((x) => x.circle.topic);
  assert.equal(new Set(topics).size, topics.length, "one Circle per topic");
  for (const x of r.recommendations) {
    assert.ok(!/your interest|your bio/i.test(x.explanation), `no fake personalization: ${x.explanation}`);
    assert.ok(x.circle.spots_left == null || x.circle.spots_left > 0);
  }
});

test("obvious matches (user 7): a leadership and a public-speaking Circle lead the list", () => {
  const r = debugRec(7);
  const top2 = r.recommendations.slice(0, 2).map((x) => x.circle.topic).sort();
  assert.deepEqual(top2, ["leadership-skills", "public-speaking"]);
  assert.ok(!ids(r).includes(4), "already a member of #4");
  assert.match(r.recommendations[0].explanation, /interest in Leadership skills/);
  // the other strong Circles on that topic (#5 Women Who Lead / #6 Speak Up) are never lost:
  const surfaced = new Set(r.recommendations.flatMap((x) => [x.circle.id, ...x.similar_circles.map((s) => s.id)]));
  assert.ok(surfaced.has(5) && surfaced.has(6));
});

test("duplicate Circles (user 15): exactly one of #10/#11/#12; the others collapse into similar_circles", () => {
  const r = debugRec(15, 10);
  const shown = ids(r).filter((i) => [10, 11, 12].includes(i));
  assert.equal(shown.length, 1);
  const winner = r.recommendations.find((x) => x.circle.id === shown[0]);
  assert.equal(winner.similar_circles.length, 2);
  assert.ok(!ids(r).includes(9) && !ids(r).includes(35), "already member");
});

test("full / inactive (user 23): #20 full and #21 inactive never rank; #22 is first", () => {
  const r = debugRec(23, 20);
  assert.ok(!ids(r).includes(20) && !ids(r).includes(21));
  assert.equal(r.recommendations[0].circle.id, 22);
  const why = Object.fromEntries(r.debug.excluded.map((e) => [e.id, e.reason]));
  assert.equal(why[20], "full");
  assert.ok(["inactive", "unlisted"].includes(why[21]));
  assert.equal(why[32], "inactive");
});

test("inactive rule works independent of access (circle 32 and 21 are dormant)", () => {
  const r = debugRec(1, 20);
  for (const bad of [20, 21, 32, 18, 30]) assert.ok(!ids(r).includes(bad));
});

test("every user gets a sensible list: 5 results, none full/inactive/unlisted/already-joined", () => {
  const all = db.prepare("SELECT id FROM users").all();
  assert.equal(all.length, 100);
  const bad = new Set([20, 21, 32, 18, 30]);
  for (const { id } of all) {
    const r = recommend(db, id, { limit: 5 });
    assert.equal(r.recommendations.length, 5, `user ${id}`);
    const mine = new Set(db.prepare("SELECT circle_id FROM memberships WHERE user_id=?").all(id).map((x) => x.circle_id));
    const topics = r.recommendations.map((x) => x.circle.topic).filter(Boolean);
    assert.equal(new Set(topics).size, topics.length, `user ${id}: duplicate topic`);
    for (const x of r.recommendations) {
      assert.ok(!bad.has(x.circle.id) && !mine.has(x.circle.id), `user ${id} got #${x.circle.id}`);
      assert.ok(x.explanation.length > 10 && x.reasons.length > 0);
      assert.ok(x.rank >= 1);
    }
    const scores = r.recommendations.map((x) => x.score);
    // diversification may reorder slightly, but the first item is always the best adjusted score
    assert.equal(Math.max(...scores), scores[0]);
  }
});

test("profile-only member (user 4: career break bio, no interests) is personalized from the bio", () => {
  const r = debugRec(4);
  assert.equal(r.personalization.mode, "inferred");
  assert.ok(r.personalization.signals.some((s) => s.topic === "career-breaks" && s.source === "profile"));
  assert.match(r.recommendations[0].explanation, /bio mentions returning to work after a career break, and this Circle is focused on career breaks/);
});

test("HTTP API contract", async () => {
  const server = createServer(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let res = await fetch(`${base}/users/23/recommendations?limit=3`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recommendations.length, 3);
    assert.ok(body.recommendations[0].circle.name && body.recommendations[0].explanation);
    assert.equal((await fetch(`${base}/users/9999/recommendations`)).status, 404);
    assert.equal((await fetch(`${base}/users/7/recommendations?limit=0`)).status, 400);
    assert.equal((await fetch(`${base}/users/7/recommendations?limit=abc`)).status, 400);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Circle/);
    const list = await (await fetch(`${base}/users`)).json();
    assert.equal(list.length, 100);
    assert.equal(list.find((u) => u.id === 42).scenario, "Cold start");
    assert.equal((await fetch(`${base}/users/7/recommendations`, { method: "POST" })).status, 405);
  } finally { server.close(); }
});
