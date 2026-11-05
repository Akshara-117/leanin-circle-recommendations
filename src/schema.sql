-- Circle recommendations schema (SQLite). See docs/SCHEMA.md for rationale.
PRAGMA foreign_keys = ON;

CREATE TABLE topics (
  id     INTEGER PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  label  TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'content'
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  has_photo            INTEGER NOT NULL DEFAULT 0 CHECK (has_photo IN (0,1)),
  bio                  TEXT,
  job_title            TEXT,
  company              TEXT,
  industry             TEXT,
  location             TEXT,
  joined_at            TEXT NOT NULL,
  profile_completeness REAL NOT NULL DEFAULT 0 CHECK (profile_completeness BETWEEN 0 AND 1)
);

-- Stated interests: normalized many-to-many (was a string[] in the source data).
CREATE TABLE user_topics (
  user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, topic_id)
) WITHOUT ROWID;
CREATE INDEX idx_user_topics_topic ON user_topics(topic_id);   -- "who is interested in X"

CREATE TABLE circles (
  id                 INTEGER PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  description        TEXT,
  topic_id           INTEGER REFERENCES topics(id),               -- nullable: some Circles are untagged
  cover_image_url    TEXT,
  format             TEXT NOT NULL CHECK (format IN ('in_person','virtual','hybrid')),
  access             TEXT NOT NULL CHECK (access IN ('public','unlisted')),
  join_policy        TEXT NOT NULL CHECK (join_policy IN ('open','request')),
  max_members        INTEGER CHECK (max_members IS NULL OR max_members > 0),  -- NULL = uncapped
  member_count       INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),    -- denormalized counter
  created_at         TEXT NOT NULL,
  last_activity_at   TEXT NOT NULL,
  feed_posts_30d     INTEGER NOT NULL DEFAULT 0,
  chat_messages_30d  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_circles_topic    ON circles(topic_id);
CREATE INDEX idx_circles_listable ON circles(access, last_activity_at);  -- candidate pre-filter

-- Free-form tags (secondary topic signal).
CREATE TABLE circle_tags (
  circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (circle_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_circle_tags_tag ON circle_tags(tag);

CREATE TABLE memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','leader')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (user_id, circle_id)                 -- serves "circles of a user" + uniqueness
) WITHOUT ROWID;
CREATE INDEX idx_memberships_circle ON memberships(circle_id, role);   -- members / leaders of a circle
CREATE INDEX idx_memberships_joined ON memberships(circle_id, joined_at); -- recent-join velocity

CREATE TABLE posts (
  id             INTEGER PRIMARY KEY,
  circle_id      INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  save_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_posts_circle_created ON posts(circle_id, created_at);

-- Derived, precomputable per-Circle signals (nightly job in prod; computed at seed here).
-- Keeps the request path to cheap indexed reads instead of aggregating posts per request.
CREATE TABLE circle_features (
  circle_id               INTEGER PRIMARY KEY REFERENCES circles(id) ON DELETE CASCADE,
  posts_window            INTEGER NOT NULL,   -- posts in the 30d window actually present in `posts`
  engagement_per_post     REAL    NOT NULL,   -- (reactions + 2*comments + 1.5*saves) / post, 30d
  distinct_posters        INTEGER NOT NULL,   -- unique authors in 30d
  poster_share            REAL    NOT NULL,   -- distinct_posters / member_count (participation breadth)
  joins_30d               INTEGER NOT NULL,   -- new members in last 30d (welcoming signal)
  computed_at             TEXT    NOT NULL
);
