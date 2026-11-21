const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const MAX_MB = Number(process.env.MAX_MB || 50);
const SSH101_RTMP_URL = "rtmp://ssh101.bozztv.com/ssh101";
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
      "default-src 'self'; img-src 'self' data:; media-src 'self' blob: https:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net; worker-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
  res.json({ maxMb: MAX_MB, admin: isAdmin(req), adminEnabled: !!ADMIN, liveConfigured: true, liveProvider: "ssh101", rtmpUrl: SSH101_RTMP_URL, appsUrl: /^https:\/\//.test(process.env.APPS_URL || "") ? process.env.APPS_URL : "" }));

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
  const r = await q(`select c.id, c.name, c.descr, c.emoji, c.color,
    (select count(*) from videos v where v.channel_id = c.id)::int as vcount
    from channels c order by vcount desc, c.created desc`);
  const on = new Set((await liveRows()).filter((x) => x.live).map((x) => x.channel_id));
  res.json(r.rows.map((x) => ({ ...x, live: on.has(x.id) })));
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
  const c = await q(`select id, name, descr, emoji, color,
    (select count(*) from channel_subscriptions s where s.channel_id=channels.id)::int as subscribers,
    exists(select 1 from channel_subscriptions s where s.channel_id=channels.id and s.viewer_id=$2) as subscribed
    from channels where id = $1`, [id, String(req.get("x-viewer-id") || "").slice(0,80)]);
  if (!c.rows[0]) return notFound(res);
  const p = await q(`select p.id, p.title, p.descr, p.channel_id,
    (select count(*) from playlist_items i where i.playlist_id = p.id)::int as count,
    (select v.thumb from playlist_items i join videos v on v.id = i.video_id where i.playlist_id = p.id order by i.pos limit 1) as thumb
    from playlists p where p.channel_id = $1 order by p.created desc`, [id]);
  const sr = (await liveRows()).find((x) => x.channel_id === id);
  res.json({ ...c.rows[0], playlists: p.rows, stream: sr ? { title: sr.title, quality: sr.quality, live: sr.live, viewers: sr.viewers } : null });
}));

app.post("/api/channels/:id/subscribe", rate("subscribe", 120, 60e3), wrap(async (req, res) => {
  const cid = int(req.params.id), viewer = String(req.get("x-viewer-id") || "").slice(0,80);
  if (!viewer) return res.status(400).json({ error: "Viewer ID required." });
  const exists = await q("select id from channels where id=$1", [cid]);
  if (!exists.rows[0]) return notFound(res);
  if (req.body.subscribed) await q(`insert into channel_subscriptions(channel_id,viewer_id) values($1,$2) on conflict do nothing`, [cid, viewer]);
  else await q("delete from channel_subscriptions where channel_id=$1 and viewer_id=$2", [cid, viewer]);
  const r = await q("select count(*)::int as subscribers from channel_subscriptions where channel_id=$1", [cid]);
  res.json({ subscribed: !!req.body.subscribed, subscribers: r.rows[0].subscribers });
}));

const CATS = ["gaming", "music", "learning", "tech", "sports", "fun", "news", "other"];
const cleanEmoji = (s) => Array.from(String(s || "").trim()).slice(0, 2).join("");

app.patch("/api/channels/:id", rate("ed", 30, 3600e3), wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!(await owns(req, id))) return forbid(res);
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: "Channel name needs at least 2 characters." });
  const descr = String(req.body.descr || "").trim().slice(0, 500);
  const emoji = cleanEmoji(req.body.emoji);
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || "") ? req.body.color.toLowerCase() : "";
  try {
    const r = await q("update channels set name=$2, descr=$3, emoji=$4, color=$5 where id=$1 returning id", [id, name, descr, emoji, color]);
    if (!r.rows[0]) return notFound(res);
    res.json({ ok: true, name, descr, emoji, color });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That channel name is taken." });
    throw e;
  }
}));

// Rotating the key makes the old one stop working immediately. The new key is shown once.
app.post("/api/channels/:id/key", rate("rk", 5, 3600e3), wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!(await owns(req, id))) return forbid(res);
  const key = crypto.randomBytes(24).toString("hex");
  await q("update channels set key_hash=$2 where id=$1", [id, sha(key).toString("hex")]);
  res.json({ key });
}));

app.patch("/api/videos/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  const v = await q("select channel_id from videos where id = $1", [id]);
  if (!v.rows[0]) return notFound(res);
  if (!(await owns(req, v.rows[0].channel_id))) return forbid(res);
  const title = String(req.body.title || "").trim().slice(0, 100);
  if (!title) return res.status(400).json({ error: "Title can’t be empty." });
  const category = CATS.includes(req.body.category) ? req.body.category : "";
  await q("update videos set title=$2, descr=$3, category=$4 where id=$1", [id, title, String(req.body.desc || "").trim().slice(0, 5000), category]);
  res.json({ ok: true });
}));

app.delete("/api/channels/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!(await owns(req, id))) return forbid(res);
  await q("delete from channels where id = $1", [id]);
  res.json({ ok: true });
}));

/* ---------- live streaming (free SSH101 RTMP ingest + HLS playback) ---------- */
const liveKeyHash = (v) => sha(String(v || "")).toString("hex");
function validSsh101Hls(value) {
  try {
    const u = new URL(String(value || ""));
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "ssh101.com" || host.endsWith(".ssh101.com") || host.endsWith(".giatvcdn.com") || host.endsWith(".bozztv.com")) && u.pathname.endsWith(".m3u8");
  } catch { return false; }
}
// A channel is "on air" only when its SSH101 HLS playlist is actually being served and has not ended.
// Results are cached for 20 seconds per channel so viewers never hammer the CDN.
const liveCache = new Map();
const hlsHostOk = (h) => h === "ssh101.com" || h.endsWith(".ssh101.com") || h.endsWith(".giatvcdn.com") || h.endsWith(".bozztv.com");
async function probeHls(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "OpenTube-LiveCheck" } });
    if (!r.ok || !hlsHostOk(new URL(r.url).hostname.toLowerCase())) return false;
    const t = (await r.text()).slice(0, 200000);
    return t.trimStart().startsWith("#EXTM3U") && !t.includes("#EXT-X-ENDLIST");
  } catch { return false; }
}
async function liveRows() {
  const r = await q(`select l.channel_id, l.title, l.quality, l.playback_url, c.name as channel,
    (select count(*) from channel_subscriptions s where s.channel_id=l.channel_id)::int as subscribers,
    (select count(*) from live_presence p where p.channel_id=l.channel_id and p.seen>now()-interval '60 seconds')::int as viewers,
    (extract(epoch from l.created) * 1000)::float8 as date
    from live_streams l join channels c on c.id = l.channel_id`);
  const now = Date.now();
  await Promise.all(r.rows.map(async (row) => {
    let e = liveCache.get(row.channel_id);
    if (!e || e.url !== row.playback_url || now - e.t > 20000) { e = { t: now, url: row.playback_url, p: probeHls(row.playback_url) }; liveCache.set(row.channel_id, e); }
    row.live = await e.p;
  }));
  return r.rows.sort((a, b) => Number(b.live) - Number(a.live) || b.viewers - a.viewers || b.date - a.date);
}
app.get("/api/live", wrap(async (req, res) => res.json(await liveRows())));
app.get("/api/live/status", wrap(async (req, res) => {
  const on = (await liveRows()).filter((x) => x.live);
  res.json({ ids: on.map((x) => x.channel_id), names: Object.fromEntries(on.map((x) => [x.channel_id, x.channel])), viewers: Object.fromEntries(on.map((x) => [x.channel_id, x.viewers])) });
}));
app.get("/api/live/mine", wrap(async (req, res) => {
  const cid = int(req.get("x-channel-id"));
  if (!cid || !(await owns(req, cid))) return forbid(res);
  const r = await q("select channel_id, title, quality, provider_uid as stream_name, playback_url from live_streams where channel_id = $1", [cid]);
  res.json(r.rows[0] || null);
}));
async function provisionLive(req, res) {
  const cid = int(req.get("x-channel-id"));
  if (!cid || !(await owns(req, cid))) return forbid(res);
  const title = String(req.body.title || "Live stream").trim().slice(0, 100) || "Live stream";
  const quality = ["480p", "720p", "1080p"].includes(req.body.quality) ? req.body.quality : "720p";
  const streamName = String(req.body.streamName || "").trim();
  const playbackUrl = String(req.body.playbackUrl || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,100}$/.test(streamName)) return res.status(400).json({ error: "Enter the SSH101 Streaming Publishing Point / channel key (3–100 letters, numbers, _ or -)." });
  if (!validSsh101Hls(playbackUrl)) return res.status(400).json({ error: "Paste the HTTPS HLS (.m3u8) URL supplied by SSH101. It must use an SSH101 / Giatv CDN host." });
  await q(`insert into live_streams (channel_id,title,quality,key_hash,provider,provider_uid,playback_url,ingest_url)
    values ($1,$2,$3,$4,'ssh101',$5,$6,$7) on conflict(channel_id) do update set title=excluded.title,quality=excluded.quality,key_hash=excluded.key_hash,provider='ssh101',provider_uid=excluded.provider_uid,playback_url=excluded.playback_url,ingest_url=excluded.ingest_url,created=now()`,
    [cid,title,quality,liveKeyHash(streamName),streamName,playbackUrl,SSH101_RTMP_URL]);
  res.json({ ok:true, channelId:cid, title, quality, rtmpUrl:SSH101_RTMP_URL, streamKey:streamName, watchUrl:playbackUrl });
}
app.post("/api/live", rate("live", 10, 3600e3), wrap(provisionLive));
app.post("/api/live/rotate", wrap(async (req,res) => {
  const cid = int(req.get("x-channel-id")); if (!cid || !(await owns(req,cid))) return forbid(res);
  const r = await q("select title,quality,provider_uid as stream_name,playback_url from live_streams where channel_id=$1",[cid]);
  if (!r.rows[0]) return notFound(res);
  res.json({ rtmpUrl:SSH101_RTMP_URL, streamKey:r.rows[0].stream_name, watchUrl:r.rows[0].playback_url, title:r.rows[0].title, quality:r.rows[0].quality });
}));
app.delete("/api/live", wrap(async (req,res)=>{
  const cid=int(req.get("x-channel-id")); if(!cid || !(await owns(req,cid))) return forbid(res);
  await q("delete from live_streams where channel_id=$1",[cid]);
  res.json({ok:true});
}));
app.get("/api/live/:id/chat", wrap(async (req,res)=>{
  const cid=int(req.params.id), after=Math.max(0,int(req.query.after)||0);
  const exists=await q("select 1 from live_streams where channel_id=$1",[cid]); if(!exists.rows[0]) return notFound(res);
  const r=await q("select id,nickname,body,(extract(epoch from created)*1000)::float8 as date from live_chat where channel_id=$1 and id>$2 order by id asc limit 100",[cid,after]);
  const count=await q("select count(distinct viewer_id)::int as viewers from live_presence where channel_id=$1 and seen>now()-interval '60 seconds'",[cid]);
  res.json({messages:r.rows,viewers:count.rows[0].viewers});
}));
app.post("/api/live/:id/chat/presence", rate("livepresence",30,60e3), wrap(async(req,res)=>{
  const cid=int(req.params.id), viewer=String(req.get("x-viewer-id")||"").slice(0,100);
  if(!viewer) return res.status(400).json({error:"Viewer ID is required."});
  const exists=await q("select 1 from live_streams where channel_id=$1",[cid]); if(!exists.rows[0]) return notFound(res);
  await q("insert into live_presence(channel_id,viewer_id,seen) values($1,$2,now()) on conflict(channel_id,viewer_id) do update set seen=now()",[cid,viewer]);
  await q("delete from live_presence where seen < now()-interval '1 day'");
  const count=await q("select count(*)::int as viewers from live_presence where channel_id=$1 and seen>now()-interval '60 seconds'",[cid]);
  res.json({viewers:count.rows[0].viewers});
}));
app.post("/api/live/:id/chat", rate("livechat",20,60e3), wrap(async(req,res)=>{
  const cid=int(req.params.id), viewer=String(req.get("x-viewer-id")||"").slice(0,100);
  if(!viewer) return res.status(400).json({error:"Viewer ID is required."});
  const exists=await q("select 1 from live_streams where channel_id=$1",[cid]); if(!exists.rows[0]) return notFound(res);
  const nickname=String(req.body.nickname||"Guest").trim().slice(0,32)||"Guest", body=String(req.body.body||"").trim().slice(0,500);
  if(!body) return res.status(400).json({error:"Write a message first."});
  const r=await q("insert into live_chat(channel_id,viewer_id,nickname,body) values($1,$2,$3,$4) returning id,nickname,body,(extract(epoch from created)*1000)::float8 as date",[cid,viewer,nickname,body]);
  res.json(r.rows[0]);
}));

/* ---------- videos ---------- */
app.get("/api/videos", wrap(async (req, res) => {
  const ch = /^\d+$/.test(req.query.channel || "") ? int(req.query.channel) : null;
  const type = String(req.query.type || "");
  const params = [];
  const where = [];
  if (ch) { params.push(ch); where.push(`v.channel_id = $${params.length}`); }
  if (type === "shorts") where.push("v.is_short = true");
  const cat = String(req.query.category || "");
  if (cat && CATS.includes(cat)) { params.push(cat); where.push(`v.category = $${params.length}`); }
  if (type === "premieres") where.push("v.status = 'scheduled' and v.premiere_at > now()");
  else if (!(ch && await owns(req, ch))) where.push("(v.status <> 'scheduled' or v.premiere_at <= now())");
  const r = await q(`
    select v.id, v.title, v.descr as "desc", v.thumb, v.duration, v.views, v.likes, v.dislikes,
      v.is_short, v.category, v.status, (extract(epoch from v.premiere_at) * 1000)::float8 as premiere_at,
      v.channel_id, c.name as channel,
      (select count(*) from channel_subscriptions s where s.channel_id=v.channel_id)::int as subscribers,
      (extract(epoch from v.created) * 1000)::float8 as date
    from videos v left join channels c on c.id = v.channel_id
    ${where.length ? "where " + where.join(" and ") : ""} order by coalesce(v.premiere_at, v.created) desc`, params);
  res.json(r.rows);
}));

app.get("/api/videos/:id", wrap(async (req, res) => {
  const id = int(req.params.id);
  const r = await q(`
    select v.id, v.title, v.descr as "desc", v.thumb, v.duration, v.views, v.likes, v.dislikes,
      v.is_short, v.category, v.status, (extract(epoch from v.premiere_at) * 1000)::float8 as premiere_at,
      v.channel_id, c.name as channel,
      (select count(*) from channel_subscriptions s where s.channel_id=v.channel_id)::int as subscribers,
      (extract(epoch from v.created) * 1000)::float8 as date
    from videos v left join channels c on c.id = v.channel_id where v.id = $1`, [id]);
  if (!r.rows[0]) return notFound(res);
  const cm = await q(`select id, body as x, (extract(epoch from created) * 1000)::float8 as t
    from comments where video_id = $1 order by created desc`, [id]);
  const viewer = String(req.get("x-viewer-id") || "").slice(0, 80);
  const votes = viewer ? await q(`select count(*) filter (where vote=1)::int as likes,
    count(*) filter (where vote=-1)::int as dislikes,
    coalesce((select vote from video_votes where video_id=$1 and viewer_id=$2),0)::int as my_vote
    from video_votes where video_id=$1`, [id, viewer]) : { rows: [{ likes: 0, dislikes: 0, my_vote: 0 }] };
  res.json({ ...r.rows[0], vote_counts: votes.rows[0], comments: cm.rows });
}));

app.get("/api/videos/:id/stream", wrap(async (req, res) => {
  const id = int(req.params.id);
  const m = await q("select mime, size, channel_id, status, premiere_at from videos where id = $1", [id]);
  if (!m.rows[0]) return res.sendStatus(404);
  if (m.rows[0].status === "scheduled" && m.rows[0].premiere_at && new Date(m.rows[0].premiere_at).getTime() > Date.now() && !(await owns(req, m.rows[0].channel_id))) return res.sendStatus(404);
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
    const width = Math.max(0, Math.min(100000, int(req.body.width) || 0));
    const height = Math.max(0, Math.min(100000, int(req.body.height) || 0));
    const duration = Math.max(0, Number(req.body.duration) || 0);
    // Portrait video, at least 5:4 tall, and no longer than 3 minutes => Short.
    const isShort = width > 0 && height > 0 && height / width >= 1.25 && duration <= 180;
    const premiereAt = req.body.premiereAt ? new Date(req.body.premiereAt) : null;
    if (premiereAt && (!Number.isFinite(premiereAt.getTime()) || premiereAt.getTime() < Date.now() + 60_000))
      return res.status(400).json({ error: "Premiere must be scheduled at least one minute in the future." });
    const category = CATS.includes(req.body.category) ? req.body.category : "";
    const status = premiereAt ? "scheduled" : "published";
    const r = await q(`insert into videos (channel_id, title, descr, thumb, duration, mime, size, data, width, height, is_short, status, premiere_at, category)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, is_short`,
      [req.cid, title, desc, thumb, duration, f.mimetype, f.size, f.buffer, width, height, isShort, status, premiereAt, category]);
    res.json({ id: r.rows[0].id, isShort: r.rows[0].is_short, status });
  }));

app.post("/api/videos/:id/view", wrap(async (req, res) => {
  await q("update videos set views = views + 1 where id = $1", [int(req.params.id)]);
  res.json({ ok: true });
}));

app.post("/api/videos/:id/vote", rate("vote", 120, 60e3), wrap(async (req, res) => {
  const id = int(req.params.id), viewer = String(req.get("x-viewer-id") || "").slice(0, 80);
  const vote = Number(req.body.vote);
  if (!viewer || ![1, -1, 0].includes(vote)) return res.status(400).json({ error: "A valid viewer ID and vote are required." });
  const exists = await q("select id from videos where id=$1", [id]);
  if (!exists.rows[0]) return notFound(res);
  if (vote === 0) await q("delete from video_votes where video_id=$1 and viewer_id=$2", [id, viewer]);
  else await q(`insert into video_votes (video_id, viewer_id, vote) values ($1,$2,$3)
    on conflict (video_id, viewer_id) do update set vote=excluded.vote`, [id, viewer, vote]);
  const totals = await q(`select count(*) filter (where vote=1)::int as likes,
    count(*) filter (where vote=-1)::int as dislikes,
    coalesce((select vote from video_votes where video_id=$1 and viewer_id=$2),0)::int as mine
    from video_votes where video_id=$1`, [id, viewer]);
  res.json(totals.rows[0]);
}));

// Backward-compatible likes endpoint for older clients.
app.post("/api/videos/:id/like", wrap(async (req, res) => {
  const delta = req.body.delta === -1 ? -1 : 1;
  const r = await q("update videos set likes = greatest(likes + $2, 0) where id = $1 returning likes", [int(req.params.id), delta]);
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

/* ---------- viewer saved videos / Watch later ---------- */
app.get("/api/saved", wrap(async (req, res) => {
  const viewer = String(req.get("x-viewer-id") || "").slice(0,80);
  if (!viewer) return res.json([]);
  const r = await q(`select v.id, v.title, v.thumb, v.duration, v.views, v.likes, v.dislikes, v.is_short,
    v.status, (extract(epoch from v.premiere_at)*1000)::float8 as premiere_at, v.channel_id,
    c.name as channel, (extract(epoch from v.created)*1000)::float8 as date
    from saved_videos s join videos v on v.id=s.video_id left join channels c on c.id=v.channel_id
    where s.viewer_id=$1 and (v.status <> 'scheduled' or v.premiere_at <= now()) order by s.created desc`, [viewer]);
  res.json(r.rows);
}));
app.post("/api/saved/:id", wrap(async (req, res) => {
  const viewer = String(req.get("x-viewer-id") || "").slice(0,80), id=int(req.params.id);
  if (!viewer) return res.status(400).json({ error: "Viewer ID required." });
  const v=await q("select id from videos where id=$1",[id]); if(!v.rows[0]) return notFound(res);
  await q("insert into saved_videos(viewer_id,video_id) values($1,$2) on conflict do nothing",[viewer,id]);
  res.json({ ok:true });
}));
app.delete("/api/saved/:id", wrap(async (req, res) => {
  const viewer=String(req.get("x-viewer-id")||"").slice(0,80);
  await q("delete from saved_videos where viewer_id=$1 and video_id=$2",[viewer,int(req.params.id)]);
  res.json({ ok:true });
}));

/* ---------- Premiere live chat ---------- */
app.get("/api/videos/:id/premiere-chat", wrap(async (req,res)=>{
  const id=int(req.params.id), after=Math.max(0,int(req.query.after)||0);
  const v=await q("select id,status,premiere_at from videos where id=$1",[id]); if(!v.rows[0]) return notFound(res);
  const r=await q(`select id, nickname, body, (extract(epoch from created)*1000)::float8 as t
    from premiere_chat where video_id=$1 and id>$2 order by id asc limit 100`,[id,after]);
  res.json(r.rows);
}));
app.post("/api/videos/:id/premiere-chat", rate("pchat",30,60e3), wrap(async(req,res)=>{
  const id=int(req.params.id), viewer=String(req.get("x-viewer-id")||"").slice(0,80);
  const body=String(req.body.body||"").trim().slice(0,240), nickname=String(req.body.nickname||"Guest").trim().slice(0,32)||"Guest";
  if(!viewer||!body) return res.status(400).json({error:"Write a message first."});
  const v=await q("select id,status,premiere_at from videos where id=$1",[id]); if(!v.rows[0]) return notFound(res);
  if(v.rows[0].status!="scheduled") return res.status(400).json({error:"Live chat is only for premieres."});
  const r=await q(`insert into premiere_chat(video_id,viewer_id,nickname,body) values($1,$2,$3,$4)
    returning id,nickname,body,(extract(epoch from created)*1000)::float8 as t`,[id,viewer,nickname,body]);
  res.json(r.rows[0]);
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
    alter table videos add column if not exists dislikes integer not null default 0;
    alter table videos add column if not exists width integer not null default 0;
    alter table videos add column if not exists height integer not null default 0;
    alter table videos add column if not exists is_short boolean not null default false;
    alter table videos add column if not exists status text not null default 'published';
    alter table videos add column if not exists premiere_at timestamptz;
    alter table videos add column if not exists category text not null default '';
    alter table channels add column if not exists emoji text not null default '';
    alter table channels add column if not exists color text not null default '';
    create table if not exists video_votes (
      video_id integer not null references videos(id) on delete cascade,
      viewer_id text not null, vote smallint not null check (vote in (-1,1)),
      created timestamptz not null default now(), primary key (video_id, viewer_id));
    insert into video_votes (video_id, viewer_id, vote)
      select v.id, 'legacy-like-' || v.id || '-' || n::text, 1
      from videos v cross join lateral generate_series(1, least(v.likes, 10000)) as gs(n)
      where v.likes > 0 and not exists (select 1 from video_votes x where x.video_id = v.id);
    create table if not exists comments (
      id serial primary key, video_id integer not null references videos(id) on delete cascade,
      body text not null, created timestamptz not null default now());
    create table if not exists playlists (
      id serial primary key, channel_id integer not null references channels(id) on delete cascade,
      title text not null, descr text not null default '', created timestamptz not null default now());
    create table if not exists playlist_items (
      playlist_id integer not null references playlists(id) on delete cascade,
      video_id integer not null references videos(id) on delete cascade,
      pos integer not null, primary key (playlist_id, video_id));
    create table if not exists channel_subscriptions (
      channel_id integer not null references channels(id) on delete cascade,
      viewer_id text not null, created timestamptz not null default now(), primary key(channel_id,viewer_id));
    create table if not exists saved_videos (
      viewer_id text not null, video_id integer not null references videos(id) on delete cascade,
      created timestamptz not null default now(), primary key(viewer_id,video_id));
    create table if not exists premiere_chat (
      id bigserial primary key, video_id integer not null references videos(id) on delete cascade,
      viewer_id text not null, nickname text not null default 'Guest', body text not null,
      created timestamptz not null default now());
    create index if not exists premiere_chat_video_id_idx on premiere_chat(video_id,id);
    create table if not exists live_chat (
      id bigserial primary key, channel_id integer not null references channels(id) on delete cascade,
      viewer_id text not null, nickname text not null default 'Guest', body text not null,
      created timestamptz not null default now());
    create index if not exists live_chat_channel_id_idx on live_chat(channel_id,id);
    create table if not exists live_presence (
      channel_id integer not null references channels(id) on delete cascade,
      viewer_id text not null, seen timestamptz not null default now(), primary key(channel_id,viewer_id));
    create table if not exists live_streams (
      channel_id integer primary key references channels(id) on delete cascade,
      title text not null default 'Live stream', quality text not null default '1080p',
      key_hash text not null, created timestamptz not null default now(),
      provider text not null default 'ssh101', provider_uid text, playback_url text, ingest_url text);
    alter table live_streams add column if not exists provider text not null default 'ssh101';
    alter table live_streams add column if not exists provider_uid text;
    alter table live_streams add column if not exists playback_url text;
    alter table live_streams add column if not exists ingest_url text;`);
  app.listen(PORT, () => console.log(`OpenTube running on port ${PORT}`));
})().catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
