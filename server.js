const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_MB || 50);
const CHUNK = 4 * 1024 * 1024;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Point it at a PostgreSQL database.");
  process.exit(1);
}

/* ---------- security helpers ---------- */
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// The admin password lives ONLY in this environment variable. Only its hash is kept in
// memory, and the plain value is removed from process.env right away. It is never
// written to the database, to logs, or sent to the browser.
const ADMIN = process.env.ADMIN_PASSWORD ? sha(process.env.ADMIN_PASSWORD) : null;
delete process.env.ADMIN_PASSWORD;
if (!ADMIN) console.warn("ADMIN_PASSWORD is not set: admin tools are disabled.");

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const mac = (e) => crypto.createHmac("sha256", SECRET).update(String(e)).digest("hex");
const makeToken = () => { const e = Date.now() + 2 * 3600e3; return e + "." + mac(e); };
const validToken = (t) => {
  const [e, s] = String(t || "").split(".");
  return !!e && !!s && same(Buffer.from(s), Buffer.from(mac(e))) && Number(e) > Date.now();
};
const getCookie = (req, name) => {
  for (const c of (req.headers.cookie || "").split(";")) {
    const i = c.indexOf("=");
    if (c.slice(0, i).trim() === name) return c.slice(i + 1).trim();
  }
};
const isAdmin = (req) => !!ADMIN && validToken(getCookie(req, "ot_admin"));

const buckets = new Map();
const rate = (name, max, ms) => (req, res, next) => {
  const k = name + req.ip, now = Date.now();
  const a = (buckets.get(k) || []).filter((t) => now - t < ms);
  if (a.length >= max) return res.status(429).json({ error: "Too many attempts. Try again later." });
  a.push(now); buckets.set(k, a); next();
};
setInterval(() => { const n = Date.now(); for (const [k, a] of buckets) if (!a.some((t) => n - t < 3600e3)) buckets.delete(k); }, 600e3).unref();

/* ---------- app setup ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : false,
});
const q = (sql, params) => pool.query(sql, params);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const int = (v) => parseInt(v, 10);
const forbid = (res) => res.status(403).json({ error: "You don’t have permission to do that." });
const notFound = (res) => res.status(404).json({ error: "Not found." });

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
});
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.param("id", (req, res, next, v) => (/^\d+$/.test(v) ? next() : notFound(res)));
app.param("vid", (req, res, next, v) => (/^\d+$/.test(v) ? next() : notFound(res)));

async function owns(req, cid) {
  if (isAdmin(req)) return true;
  const key = req.get("x-channel-key");
  if (!key || !cid) return false;
  const r = await q("select key_hash from channels where id = $1", [cid]);
  return !!r.rows[0] && same(Buffer.from(r.rows[0].key_hash, "hex"), sha(key));
}
const needAdmin = (req, res, next) => (isAdmin(req) ? next() : forbid(res));

/* ---------- config + admin ---------- */
app.get("/api/config", (req, res) =>
  res.json({ maxMb: MAX_MB, admin: isAdmin(req), adminEnabled: !!ADMIN }));

app.post("/api/admin/login", rate("login", 8, 15 * 60e3), (req, res) => {
  if (!ADMIN) return res.status(503).json({ error: "Admin is not set up on this server." });
  if (!same(sha(req.body.password || ""), ADMIN))
    return setTimeout(() => res.status(401).json({ error: "Wrong password." }), 700);
  res.set("Set-Cookie",
    `ot_admin=${makeToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => {
  res.set("Set-Cookie", "ot_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/admin/stats", needAdmin, wrap(async (req, res) => {
  const r = await q(`select
    (select count(*) from videos)::int as videos, (select count(*) from channels)::int as channels,
    (select count(*) from playlists)::int as playlists, (select count(*) from comments)::int as comments,
    (select coalesce(sum(size),0) from videos)::float8 as bytes`);
  res.json(r.rows[0]);
}));

/* ---------- channels ---------- */
app.get("/api/channels", wrap(async (req, res) => {
  const r = await q(`select c.id, c.name, c.descr,
    (select count(*) from videos v where v.channel_id = c.id)::int as vcount
    from channels c order by vcount desc, c.created desc`);
  res.json(r.rows);
}));

app.post("/api/channels", rate("mk", 10, 3600e3), wrap(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  const descr = String(req.body.descr || "").trim().slice(0, 500);
  if (name.length < 2) return res.status(400).json({ error: "Channel name needs at least 2 characters." });
  const key = crypto.randomBytes(24).toString("hex"); // shown once; only its hash is stored
  try {
    const r = await q("insert into channels (name, descr, key_hash) values ($1,$2,$3) returning id",
      [name, descr, sha(key).toString("hex")]);
    res.json({ id: r.rows[0].id, name, key });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That channel name is taken." });
    throw e;
  }
}));

app.post("/api/channels/login", rate("ck", 20, 15 * 60e3), wrap(async (req, res) => {
  const r = await q("select id, name from channels where key_hash = $1",
    [sha(String(req.body.key || "").trim()).toString("hex")]);
  if (!r.rows[0]) return res.status(401).json({ error: "That channel key doesn’t match any channel." });
  res.json(r.rows[0]);
}));

app.get("/api/channels/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  const c = await q("select id, name, descr from channels where id = $1", [id]);
  if (!c.rows[0]) return notFound(res);
  const p = await q(`select p.id, p.title, p.descr, p.channel_id,
    (select count(*) from playlist_items i where i.playlist_id = p.id)::int as count,
    (select v.thumb from playlist_items i join videos v on v.id = i.video_id where i.playlist_id = p.id order by i.pos limit 1) as thumb
    from playlists p where p.channel_id = $1 order by p.created desc`, [id]);
  res.json({ ...c.rows[0], playlists: p.rows });
}));

app.delete("/api/channels/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!(await owns(req, id))) return forbid(res);
  await q("delete from channels where id = $1", [id]);
  res.json({ ok: true });
}));

/* ---------- videos ---------- */
app.get("/api/videos", wrap(async (req, res) => {
  const ch = /^\d+$/.test(req.query.channel || "") ? int(req.query.channel) : null;
  const r = await q(`
    select v.id, v.title, v.descr as "desc", v.thumb, v.duration, v.views, v.likes, v.channel_id, c.name as channel,
           (extract(epoch from v.created) * 1000)::float8 as date
    from videos v left join channels c on c.id = v.channel_id
    ${ch ? "where v.channel_id = $1" : ""} order by v.created desc`, ch ? [ch] : []);
  res.json(r.rows);
}));

app.get("/api/videos/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  const r = await q(`
    select v.id, v.title, v.descr as "desc", v.duration, v.views, v.likes, v.channel_id, c.name as channel,
           (extract(epoch from v.created) * 1000)::float8 as date
    from videos v left join channels c on c.id = v.channel_id where v.id = $1`, [id]);
  if (!r.rows[0]) return notFound(res);
  const cm = await q(`select id, body as x, (extract(epoch from created) * 1000)::float8 as t
    from comments where video_id = $1 order by created desc`, [id]);
  res.json({ ...r.rows[0], comments: cm.rows });
}));

app.get("/api/videos/:id/stream", wrap(async (req, res) => {
  const id = int(req.params.id);
  const m = await q("select mime, size from videos where id = $1", [id]);
  if (!m.rows[0]) return res.sendStatus(404);
  const { mime, size } = m.rows[0];
  let start = 0, end = size - 1;
  const range = req.headers.range;
  if (range) {
    const mt = /bytes=(\d*)-(\d*)/.exec(range);
    if (mt) {
      if (mt[1] !== "") { start = +mt[1]; if (mt[2] !== "") end = Math.min(+mt[2], size - 1); }
      else if (mt[2] !== "") start = Math.max(size - +mt[2], 0);
    }
    end = Math.min(end, start + CHUNK - 1);
  }
  if (start > end || start >= size) return res.status(416).set("Content-Range", `bytes */${size}`).end();
  const d = await q("select substring(data from $2::int for $3::int) as c from videos where id = $1",
    [id, start + 1, end - start + 1]);
  res.status(range ? 206 : 200).set({
    "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
    "Cache-Control": "public, max-age=3600",
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  res.end(d.rows[0].c);
}));

app.post("/api/videos", rate("up", 20, 3600e3),
  wrap(async (req, res, next) => {
    req.cid = int(req.get("x-channel-id"));
    if (!req.cid || !(await owns(req, req.cid))) return forbid(res);
    next();
  }),
  upload.single("file"),
  wrap(async (req, res) => {
    const f = req.file;
    if (!f || !f.mimetype.startsWith("video/")) return res.status(400).json({ error: "Please choose a video file." });
    const title = (req.body.title || f.originalname).trim().slice(0, 100);
    const desc = (req.body.desc || "").trim().slice(0, 5000);
    const thumb = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(req.body.thumb || "") ? req.body.thumb.slice(0, 200000) : "";
    const r = await q(`insert into videos (channel_id, title, descr, thumb, duration, mime, size, data)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [req.cid, title, desc, thumb, Number(req.body.duration) || 0, f.mimetype, f.size, f.buffer]);
    res.json({ id: r.rows[0].id });
  }));

app.post("/api/videos/:id/view", wrap(async (req, res) => {
  await q("update videos set views = views + 1 where id = $1", [int(req.params.id)]);
  res.json({ ok: true });
}));

app.post("/api/videos/:id/like", wrap(async (req, res) => {
  const delta = req.body.delta === -1 ? -1 : 1;
  const r = await q("update videos set likes = greatest(likes + $2, 0) where id = $1 returning likes",
    [int(req.params.id), delta]);
  res.json({ likes: r.rows[0] ? r.rows[0].likes : 0 });
}));

app.delete("/api/videos/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = await q("select channel_id from videos where id = $1", [id]);
  if (!v.rows[0]) return notFound(res);
  if (!(await owns(req, v.rows[0].channel_id))) return forbid(res);
  await q("delete from videos where id = $1", [id]);
  res.json({ ok: true });
}));

/* ---------- comments ---------- */
app.post("/api/videos/:id/comments", rate("cm", 30, 600e3), wrap(async (req, res) => {
  const body = String(req.body.body || "").trim().slice(0, 300);
  if (!body) return res.status(400).json({ error: "Comment is empty." });
  await q("insert into comments (video_id, body) values ($1,$2)", [int(req.params.id), body]);
  res.json({ ok: true });
}));

// Admin, or the owner of the video’s channel, can remove a comment
app.delete("/api/comments/:id", wrap(async (req, res) => {
  const r = await q(`select v.channel_id from comments c join videos v on v.id = c.video_id where c.id = $1`,
    [int(req.params.id)]);
  if (!r.rows[0]) return notFound(res);
  if (!(await owns(req, r.rows[0].channel_id))) return forbid(res);
  await q("delete from comments where id = $1", [int(req.params.id)]);
  res.json({ ok: true });
}));

/* ---------- playlists ---------- */
const plSelect = `select p.id, p.title, p.descr, p.channel_id, c.name as channel,
  (select count(*) from playlist_items i where i.playlist_id = p.id)::int as count,
  (select v.thumb from playlist_items i join videos v on v.id = i.video_id where i.playlist_id = p.id order by i.pos limit 1) as thumb
  from playlists p left join channels c on c.id = p.channel_id`;

app.get("/api/playlists", wrap(async (req, res) => {
  const ch = /^\d+$/.test(req.query.channel || "") ? int(req.query.channel) : null;
  const r = await q(`${plSelect} ${ch ? "where p.channel_id = $1" : ""} order by p.created desc`, ch ? [ch] : []);
  res.json(r.rows);
}));

app.get("/api/playlists/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  const p = await q(`${plSelect} where p.id = $1`, [id]);
  if (!p.rows[0]) return notFound(res);
  const v = await q(`select v.id, v.title, v.thumb, v.duration, v.views, v.channel_id, c.name as channel,
      (extract(epoch from v.created) * 1000)::float8 as date
    from playlist_items i join videos v on v.id = i.video_id left join channels c on c.id = v.channel_id
    where i.playlist_id = $1 order by i.pos`, [id]);
  res.json({ ...p.rows[0], videos: v.rows });
}));

app.post("/api/playlists", rate("pl", 30, 3600e3), wrap(async (req, res) => {
  const cid = int(req.get("x-channel-id"));
  if (!cid || !(await owns(req, cid))) return forbid(res);
  const title = String(req.body.title || "").trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: "Give the playlist a name." });
  const r = await q("insert into playlists (channel_id, title, descr) values ($1,$2,$3) returning id",
    [cid, title, String(req.body.descr || "").trim().slice(0, 500)]);
  res.json({ id: r.rows[0].id });
}));

async function playlistOwner(req, id) {
  const r = await q("select channel_id from playlists where id = $1", [id]);
  return r.rows[0] ? owns(req, r.rows[0].channel_id) : null;
}

app.post("/api/playlists/:id/items", wrap(async (req, res) => {
  const id = int(req.params.id), ok = await playlistOwner(req, id);
  if (ok === null) return notFound(res);
  if (!ok) return forbid(res);
  await q(`insert into playlist_items (playlist_id, video_id, pos)
    select $1, $2, coalesce(max(pos), 0) + 1 from playlist_items where playlist_id = $1
    on conflict do nothing`, [id, int(req.body.video_id)]);
  res.json({ ok: true });
}));

app.delete("/api/playlists/:id/items/:vid", wrap(async (req, res) => {
  const id = int(req.params.id), ok = await playlistOwner(req, id);
  if (ok === null) return notFound(res);
  if (!ok) return forbid(res);
  await q("delete from playlist_items where playlist_id = $1 and video_id = $2", [id, int(req.params.vid)]);
  res.json({ ok: true });
}));

app.delete("/api/playlists/:id", wrap(async (req, res) => {
  const id = int(req.params.id), ok = await playlistOwner(req, id);
  if (ok === null) return notFound(res);
  if (!ok) return forbid(res);
  await q("delete from playlists where id = $1", [id]);
  res.json({ ok: true });
}));

/* ---------- errors + startup ---------- */
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `File is too large. The limit is ${MAX_MB} MB.` });
  if (err.code === "23503") return res.status(400).json({ error: "That item no longer exists." });
  console.error(err.message);
  res.status(500).json({ error: "Something went wrong on the server." });
});

(async () => {
  await q(`
    create table if not exists channels (
      id serial primary key, name text not null, descr text not null default '',
      key_hash text not null, created timestamptz not null default now());
    create unique index if not exists channels_name_uq on channels (lower(name));
    create index if not exists channels_key_ix on channels (key_hash);
    create table if not exists videos (
      id serial primary key, title text not null, descr text not null default '',
      thumb text not null default '', duration real not null default 0, mime text not null,
      size integer not null, data bytea not null, views integer not null default 0,
      likes integer not null default 0, created timestamptz not null default now());
    alter table videos add column if not exists channel_id integer references channels(id) on delete cascade;
    create table if not exists comments (
      id serial primary key, video_id integer not null references videos(id) on delete cascade,
      body text not null, created timestamptz not null default now());
    create table if not exists playlists (
      id serial primary key, channel_id integer not null references channels(id) on delete cascade,
      title text not null, descr text not null default '', created timestamptz not null default now());
    create table if not exists playlist_items (
      playlist_id integer not null references playlists(id) on delete cascade,
      video_id integer not null references videos(id) on delete cascade,
      pos integer not null, primary key (playlist_id, video_id));`);
  app.listen(PORT, () => console.log(`OpenTube running on port ${PORT}`));
})().catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
