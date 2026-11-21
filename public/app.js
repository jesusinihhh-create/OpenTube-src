const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const sv = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let vids = [], cfg = { maxMb: 50 }, sort = "new", term = "", tab = "videos", nextHash = null;
let me = ls("me", null), liked = ls("liked", []), seen = ls("seen", {}), subs = ls("subs", []), pos = ls("pos", {});
let viewerId = ls("viewerId", ""); if (!viewerId) { viewerId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); sv("viewerId", viewerId); }
let prefs = Object.assign({ auto: true, theater: false, speed: 1 }, ls("prefs", {}));
const LISTS = ["home", "shorts", "premieres", "liked", "history", "subs", "saved"];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dur = (s) => { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const ago = (t) => { const d = (Date.now() - t) / 1000; for (const [n, u] of [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]]) if (d >= n) { const k = Math.floor(d / n); return k + " " + u + (k > 1 ? "s" : "") + " ago"; } return "just now"; };
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
const av = (n, s = 36) => `<span class="av" style="width:${s}px;height:${s}px;font-size:${Math.round(s * .45)}px;background:hsl(${hue(n || "?")} 55% 42%)">${esc((n || "?")[0].toUpperCase())}</span>`;
const canManage = (cid) => cfg.admin || (me && cid && me.id === cid);
const go = (h) => (location.hash === "#" + h ? route() : (location.hash = h));
const toast = (t) => { const e = document.createElement("div"); e.className = "toast"; e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 3200); };

async function api(p, o = {}) {
  const w = o.method && o.method !== "GET";
  o.headers = { "x-viewer-id": viewerId, ...(w && me ? { "x-channel-id": me.id, "x-channel-key": me.key } : {}), ...(o.headers || {}) };
  const r = await fetch("/api" + p, o), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}
const send = (m, p, b) => api(p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
const refresh = async () => { try { vids = await api("/videos"); } catch (e) { vids = []; } };

const M = $("#m");
const modal = (h) => { M.innerHTML = `<div class="mb">${h}</div>`; if (!M.open) M.showModal(); };
M.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === M) M.close(); });

/* ---------- reusable pieces ---------- */
const card = (v, mini, pl, cur) => `<div class="${mini ? "mini" : "card"}${cur ? " cur" : ""}" data-go="watch-${v.id}${pl ? "-pl-" + pl : ""}" tabindex="0"><div class="th ${v.is_short ? "short-thumb" : ""}" style="background-image:url('${v.thumb || ""}')">${v.is_short ? '<span class="video-badge">SHORT</span>' : ""}${v.status === "scheduled" && v.premiere_at > Date.now() ? '<span class="video-badge premiere-badge">PREMIERE</span>' : ""}${pos[v.id] && v.duration ? `<i class="rp" style="width:${Math.min(100, pos[v.id] / v.duration * 100).toFixed(1)}%"></i>` : ""}<b>${dur(v.duration)}</b></div><div><h3>${esc(v.title)}</h3><div class="meta">${v.channel ? `<span class="lnk" data-go="channel-${v.channel_id}">${esc(v.channel)}</span><br>` : ""}${v.status === "scheduled" && v.premiere_at > Date.now() ? `Premiere · ${new Date(v.premiere_at).toLocaleString()}` : `${v.views} view${v.views == 1 ? "" : "s"} · ${ago(v.date)}`}</div></div></div>`;
const plCard = (p) => `<div class="card" data-go="playlist-${p.id}" tabindex="0"><div class="th" style="background-image:url('${p.thumb || ""}')"><b>${p.count} video${p.count == 1 ? "" : "s"}</b></div><h3>${esc(p.title)}</h3><div class="meta">${esc(p.channel || "")}</div></div>`;
const grid = (h) => `<div class="grid">${h}</div>`;
const empty = (t, p, b) => `<div class="empty"><h2>${t}</h2><p>${p}</p>${b || ""}</div>`;

function hdr() {
  $("#acc").innerHTML = me ? av(me.name, 24) + `<span class="nm">${esc(me.name)}</span>` : "Sign in";
  $("#adm").textContent = cfg.admin ? "Admin ✓" : "Admin";
  $("#adm").classList.toggle("on", !!cfg.admin);
  $("#navadmin").hidden = !cfg.admin;
}

/* ---------- pages ---------- */
function list(r) {
  const t = term.toLowerCase();
  let l = vids.filter((v) => v.title.toLowerCase().includes(t) || (v.channel || "").toLowerCase().includes(t));
  if (r === "shorts") l = l.filter((v) => v.is_short);
  else if (r === "premieres") l = l.filter((v) => v.status === "scheduled" && v.premiere_at > Date.now());
  else if (r === "liked") l = l.filter((v) => liked.includes(v.id));
  else if (r === "subs") l = l.filter((v) => subs.includes(v.channel_id));
  else if (r === "saved") return l;
  else if (r === "history") return l.filter((v) => seen[v.id]).sort((a, b) => seen[b.id] - seen[a.id]);
  return l.sort(sort === "top" ? (a, b) => b.views - a.views : (a, b) => b.date - a.date);
}
function videosPage(r) {
  const l = list(r);
  if (r === "shorts") { shortsPage(l); return; }
  $("#chips").style.display = r === "home" ? "flex" : "none";
  $("#chips").innerHTML = [["new", "Newest"], ["top", "Most viewed"]].map(([k, n]) => `<button data-s="${k}" class="${sort === k ? "on" : ""}">${n}</button>`).join("");
  const msg = { home: ["No videos yet", "Create a channel and upload the first video. Everything is saved on this site’s database."], shorts: ["No Shorts yet", "Portrait videos up to 3 minutes appear here automatically."], premieres: ["No upcoming premieres", "Scheduled video premieres will appear here."], liked: ["No liked videos", "Videos you like will show up here."], history: ["No history yet", "Videos you watch will show up here."], subs: ["Nothing from your subscriptions", "Subscribe to channels and their videos will appear here."], saved: ["Nothing saved yet", "Use Save on any video to keep it in Watch later."] }[r];
  $("#view").innerHTML = l.length ? grid(l.map((v) => card(v)).join("")) : empty(vids.length && term ? "No matches" : msg[0], vids.length && term ? "Try a different search." : msg[1], r === "home" && !vids.length ? '<button class="up" data-up>Upload the first video</button>' : "");
}

async function channelsPage() {
  const cs = await api("/channels");
  $("#view").innerHTML = `<h2>Channels</h2>` + (cs.length ? grid(cs.map((c) => `<div class="chcard" data-go="channel-${c.id}" tabindex="0">${av(c.name, 72)}<h3>${esc(c.name)}</h3><div class="meta">${c.vcount} video${c.vcount == 1 ? "" : "s"}</div></div>`).join("")) : empty("No channels yet", "Be the first to create one.", '<button class="up" data-acc>Create a channel</button>'));
}

async function channelPage(id) {
  const [c, vs] = await Promise.all([api("/channels/" + id), api("/videos?channel=" + id)]);
  const mine = canManage(id);
  $("#view").innerHTML = `<div class="chead">${av(c.name, 88)}<div><h1>${esc(c.name)}</h1><div class="meta">${vs.length} videos · ${c.playlists.length} playlists · <strong id="subcount">${Number(c.subscribers||0).toLocaleString()} subscribers</strong></div><p>${esc(c.descr)}</p><div class="row"><button id="sub">${c.subscribed ? "Subscribed ✓" : "Subscribe"}</button>${mine ? `<button class="up" id="cu">Upload</button><button id="cp">New playlist</button><button class="danger" id="cd">Delete channel</button>` : ""}</div></div></div>
  <div class="tabs"><button data-tab="videos" class="${tab === "videos" ? "on" : ""}">Videos</button><button data-tab="playlists" class="${tab === "playlists" ? "on" : ""}">Playlists</button></div>` +
    (tab === "videos" ? (vs.length ? grid(vs.map((v) => card(v)).join("")) : empty("No videos", "This channel hasn’t uploaded anything yet.")) : (c.playlists.length ? grid(c.playlists.map((p) => plCard({ ...p, channel: c.name })).join("")) : empty("No playlists", "This channel has no playlists yet.")));
  $("#sub").onclick = async () => { try { const next = !$("#sub").textContent.includes("Subscribed"); const r = await send("POST", `/channels/${id}/subscribe`, { subscribed: next }); $("#sub").textContent = r.subscribed ? "Subscribed ✓" : "Subscribe"; $("#subcount").textContent = `${Number(r.subscribers).toLocaleString()} subscribers`; if(r.subscribed && !subs.includes(id)) subs.push(id); if(!r.subscribed) subs = subs.filter(x => x !== id); sv("subs",subs); } catch(e) { toast(e.message); } };
  if (mine) {
    $("#cu").onclick = uploadModal; $("#cp").onclick = () => playlistModal();
    $("#cd").onclick = async () => { if (!confirm(`Delete “${c.name}” and all its videos?`)) return; try { await send("DELETE", "/channels/" + id); if (me && me.id === id) { me = null; sv("me", null); hdr(); } toast("Channel deleted"); go("channels"); } catch (e) { toast(e.message); } };
  }
}

async function playlistsPage() {
  const ps = await api("/playlists");
  $("#view").innerHTML = `<h2>Playlists</h2>` + (ps.length ? grid(ps.map(plCard).join("")) : empty("No playlists yet", "Channel owners can create playlists from a channel page or while watching a video."));
}

async function playlistPage(id) {
  const p = await api("/playlists/" + id), mine = canManage(p.channel_id);
  $("#view").innerHTML = `<div class="chead"><div><h1>${esc(p.title)}</h1><div class="meta"><span class="lnk" data-go="channel-${p.channel_id}">${esc(p.channel || "")}</span> · ${p.count} video${p.count == 1 ? "" : "s"}</div><p>${esc(p.descr)}</p><div class="row">${p.videos.length ? `<button class="up" data-go="watch-${p.videos[0].id}-pl-${id}">Play all</button>` : ""}${mine ? `<button class="danger" id="pd">Delete playlist</button>` : ""}</div></div></div>` +
    (p.videos.length ? p.videos.map((v, i) => `<div class="pli"><span class="meta">${i + 1}</span>${card(v, 1, id)}${mine ? `<button data-rm="${v.id}">Remove</button>` : ""}</div>`).join("") : empty("Empty playlist", "Open any video and choose Save to add it here."));
  if (mine) $("#pd").onclick = async () => { if (!confirm("Delete this playlist?")) return; try { await send("DELETE", "/playlists/" + id); go("playlists"); } catch (e) { toast(e.message); } };
  $$("[data-rm]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); try { await send("DELETE", `/playlists/${id}/items/${b.dataset.rm}`); route(); } catch (x) { toast(x.message); } }));
}

async function watchPage(id, plId) {
  const [v, pl] = await Promise.all([api("/videos/" + id), plId ? api("/playlists/" + plId).catch(() => null) : null]);
  if (v.status === "scheduled" && v.premiere_at > Date.now() && !canManage(v.channel_id)) {
    renderPremiereWaiting(v); return;
  }
  if (!vids.length) await refresh();
  const items = pl ? pl.videos : vids.filter((x) => x.id !== id).slice(0, 12);
  const idx = pl ? items.findIndex((x) => x.id === id) : -1, nx = pl ? items[idx + 1] : items[0];
  nextHash = nx ? `watch-${nx.id}${pl ? "-pl-" + pl.id : ""}` : null;
  if (!seen[id]) { send("POST", `/videos/${id}/view`); v.views++; }
  seen[id] = Date.now(); sv("seen", seen);
  const side = pl ? `<div class="panel"><h3>${esc(pl.title)}</h3>${items.map((x) => card(x, 1, pl.id, x.id === id)).join("")}</div>` : `<h3>Up next</h3>${items.map((x) => card(x, 1)).join("")}`;
  $("#view").innerHTML = `<div class="watch${prefs.theater ? " theater" : ""}" id="wp"><div><div class="ot-player" id="player"><video id="pv" src="/api/videos/${id}/stream" autoplay playsinline preload="metadata"></video>
  <div class="ot-controls" id="playerControls">
    <div class="ot-progress"><span id="played"></span><input id="seek" type="range" min="0" max="1000" value="0" aria-label="Seek video"></div>
    <div class="ot-control-row">
      <div class="ot-control-group"><button id="playPause" title="Play / pause">▶</button><button id="back10" title="Back 10 seconds">↶ 10</button><button id="forward10" title="Forward 10 seconds">10 ↷</button><span class="ot-time" id="timeReadout">0:00 / 0:00</span></div>
      <div class="ot-control-group"><button id="mute" title="Mute">🔊</button><input id="volume" class="ot-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"><select id="sp" aria-label="Playback speed">${[.25,.5,.75,1,1.25,1.5,1.75,2,2.25,2.5].map((s) => `<option value="${s}"${s === prefs.speed ? " selected" : ""}>${s}×</option>`).join("")}</select><button id="loop" title="Loop video">↻</button><button id="pip" title="Picture in picture">▣</button><button id="th" title="Theater mode">▱</button><button id="fs" title="Fullscreen">⛶</button></div>
    </div>
  </div></div>
  <h1>${esc(v.title)}</h1>
  <div class="row">${v.channel ? `<span class="lnk" data-go="channel-${v.channel_id}" style="display:flex;gap:8px;align-items:center">${av(v.channel, 36)}<b>${esc(v.channel)}</b></span><span class="meta" id="watch-subcount">${Number(v.subscribers||0).toLocaleString()} subscribers</span><button id="sub">${subs.includes(v.channel_id) ? "Subscribed ✓" : "Subscribe"}</button>` : ""}<span class="grow"></span><button id="lk">👍 Like · ${v.likes}</button><button id="dlk">👎 Dislike · ${v.dislikes || 0}</button><button id="sv">Save</button><button id="shr">Share</button>${canManage(v.channel_id) ? '<button class="danger" id="rm">Delete</button>' : ""}</div>
  <div class="row meta"><span>${v.views} views · ${ago(v.date)}</span><span class="grow"></span><label><input type="checkbox" id="au"${prefs.auto ? " checked" : ""}> Autoplay next</label></div>
  <div class="meta">Shortcuts: K play · J / L ±10s · M mute · F fullscreen · T theater · N next</div>
  ${v.desc ? `<div class="desc">${esc(v.desc)}</div>` : ""}
  <h3 id="cc"></h3><div class="cm"><input id="ci" placeholder="Add a comment" maxlength="300"><button id="cb">Comment</button></div><div id="cl"></div></div><aside>${side}</aside></div>`;

  const pv = $("#pv"), player = $("#player"); let last = 0;
  if (v.status === "scheduled") { player.insertAdjacentHTML("afterend", `<div class="premiere-live-banner"><span class="premiere-live-dot"></span> ${v.premiere_at > Date.now() ? "PREMIERE PROGRAMADA" : "PREMIERE LIVE"} <span class="meta">· Estreno en directo</span></div><section class="premiere-chat"><header><b>Chat en vivo</b><span class="meta">Premiere</span></header><div id="pchat-messages" class="pchat-messages"></div><div class="pchat-compose"><input id="pchat-name" maxlength="32" placeholder="Tu nombre" value="${esc(me?.name || "Guest")}"><input id="pchat-input" maxlength="240" placeholder="Di algo…"><button class="up" id="pchat-send">Enviar</button></div></section>`); setupPremiereChat(id); }
  if (v.is_short) { player.classList.add("short-player"); pv.classList.add("short-video"); }
  if (v.status === "scheduled" && v.premiere_at > Date.now() && canManage(v.channel_id)) {
    pv.removeAttribute("src"); pv.poster = v.thumb || "";
    player.insertAdjacentHTML("beforebegin", `<div class="premiere-owner panel">Premiere scheduled for ${new Date(v.premiere_at).toLocaleString()}</div>`);
  }
  const clock = (n) => { if (!Number.isFinite(n)) return "0:00"; const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), sec = Math.floor(n % 60); return h ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`; };
  const syncPlay = () => { $("#playPause").textContent = pv.paused ? "▶" : "Ⅱ"; };
  pv.playbackRate = prefs.speed;
  pv.addEventListener("loadedmetadata", () => { const t = pos[id]; if (t && t < pv.duration - 5) pv.currentTime = t; pv.playbackRate = prefs.speed; $("#timeReadout").textContent = `0:00 / ${clock(pv.duration)}`; });
  pv.addEventListener("timeupdate", () => { const pct = pv.duration ? pv.currentTime / pv.duration * 1000 : 0; $("#seek").value = pct; $("#played").style.width = (pct / 10) + "%"; $("#timeReadout").textContent = `${clock(pv.currentTime)} / ${clock(pv.duration)}`; if (Date.now() - last > 3000) { last = Date.now(); pos[id] = pv.currentTime; sv("pos", pos); } });
  pv.addEventListener("play", syncPlay); pv.addEventListener("pause", syncPlay); syncPlay();
  pv.addEventListener("ended", () => { delete pos[id]; sv("pos", pos); if (prefs.auto && nextHash) location.hash = nextHash; });
  $("#playPause").onclick = () => pv.paused ? pv.play() : pv.pause();
  $("#back10").onclick = () => { pv.currentTime = Math.max(0, pv.currentTime - 10); };
  $("#forward10").onclick = () => { pv.currentTime = Math.min(pv.duration || Infinity, pv.currentTime + 10); };
  $("#seek").oninput = () => { if (pv.duration) pv.currentTime = (+$("#seek").value / 1000) * pv.duration; };
  $("#sp").onchange = () => { prefs.speed = +$("#sp").value; sv("prefs", prefs); pv.playbackRate = prefs.speed; };
  $("#volume").oninput = () => { pv.volume = +$("#volume").value; pv.muted = pv.volume === 0; $("#mute").textContent = pv.muted ? "🔇" : "🔊"; };
  $("#mute").onclick = () => { pv.muted = !pv.muted; $("#mute").textContent = pv.muted ? "🔇" : "🔊"; };
  $("#loop").onclick = () => { pv.loop = !pv.loop; $("#loop").classList.toggle("active", pv.loop); toast(pv.loop ? "Loop enabled" : "Loop disabled"); };
  $("#pip").onclick = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else if (document.pictureInPictureEnabled) await pv.requestPictureInPicture(); else toast("Picture in picture is not supported by this browser."); } catch (e) { toast(e.message); } };
  $("#fs").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (player.requestFullscreen) player.requestFullscreen(); };
  $("#th").onclick = () => { prefs.theater = !prefs.theater; sv("prefs", prefs); $("#wp").classList.toggle("theater", prefs.theater); };
  $("#au").onchange = () => { prefs.auto = $("#au").checked; sv("prefs", prefs); };
  if ($("#sub")) $("#sub").onclick = async () => { const c=v.channel_id; try { const next=!$("#sub").textContent.includes("Subscribed"); const r=await send("POST",`/channels/${c}/subscribe`,{subscribed:next}); $("#sub").textContent=r.subscribed?"Subscribed ✓":"Subscribe"; if($("#watch-subcount")) $("#watch-subcount").textContent=`${Number(r.subscribers).toLocaleString()} subscribers`; if(r.subscribed&&!subs.includes(c))subs.push(c); if(!r.subscribed)subs=subs.filter(x=>x!==c); sv("subs",subs); } catch(e){toast(e.message);} };
  let myVote = Number(v.vote_counts?.my_vote || 0);
  if (v.vote_counts) { v.likes = v.vote_counts.likes; v.dislikes = v.vote_counts.dislikes; }
  const updateVoteButtons = (r) => { myVote = r.mine; $("#lk").textContent = `${myVote === 1 ? "👍 Liked" : "👍 Like"} · ${r.likes}`; $("#dlk").textContent = `${myVote === -1 ? "👎 Disliked" : "👎 Dislike"} · ${r.dislikes}`; };
  const vote = async (next) => { try { const r = await api(`/videos/${id}/vote`, { method: "POST", headers: { "Content-Type": "application/json", "x-viewer-id": viewerId }, body: JSON.stringify({ vote: myVote === next ? 0 : next }) }); updateVoteButtons(r); } catch (e) { toast(e.message); } };
  $("#lk").onclick = () => vote(1); $("#dlk").onclick = () => vote(-1);
  updateVoteButtons({ mine: myVote, likes: v.likes || 0, dislikes: v.dislikes || 0 });
  $("#sv").onclick = () => saveModal(id);
  if ($("#rm")) $("#rm").onclick = async () => { if (!confirm("Delete this video for everyone?")) return; try { await send("DELETE", "/videos/" + id); toast("Video deleted"); await refresh(); go("home"); } catch (e) { toast(e.message); } };
  const paint = (cs) => { $("#cc").textContent = cs.length + " comments"; $("#cl").innerHTML = cs.map((c) => `<div class="cmt"><div class="grow"><div class="meta">${ago(c.t)}</div>${esc(c.x)}</div>${canManage(v.channel_id) ? `<button data-cd="${c.id}" aria-label="Delete comment">✕</button>` : ""}</div>`).join(""); $$("[data-cd]").forEach((b) => (b.onclick = async () => { try { await send("DELETE", "/comments/" + b.dataset.cd); paint((await api("/videos/" + id)).comments); } catch (e) { toast(e.message); } })); };
  paint(v.comments);
  $("#cb").onclick = async () => { const body = $("#ci").value.trim(); if (!body) return; try { await send("POST", `/videos/${id}/comments`, { body }); $("#ci").value = ""; paint((await api("/videos/" + id)).comments); } catch (e) { toast(e.message); } };
  $("#ci").onkeydown = (e) => { if (e.key === "Enter") $("#cb").click(); };
}

async function shortsPage(items) {
  const l = items.filter(v => v.is_short);
  $("#chips").style.display = "none";
  if (!l.length) { $("#view").innerHTML = empty("No Shorts yet", "Upload a vertical video up to 3 minutes to see it here."); return; }
  $("#view").innerHTML = `<div class="shorts-feed">${l.map((v,i)=>`<article class="shorts-item" data-short-item="${v.id}"><div class="shorts-video-wrap"><video class="shorts-video" data-short-video="${v.id}" src="/api/videos/${v.id}/stream" playsinline loop muted preload="metadata" poster="${v.thumb||""}"></video><button class="shorts-sound" data-short-sound="${v.id}">🔇</button><button class="shorts-play" data-short-play="${v.id}">▶</button><div class="shorts-info"><b>${esc(v.title)}</b><span>${esc(v.channel||"OpenTube")}</span><span>${v.views} views</span></div></div><div class="shorts-actions"><button data-short-vote="${v.id}" data-vote="1">♡<small>Like</small></button><button data-short-vote="${v.id}" data-vote="-1">👎<small>Dislike</small></button><button data-short-save="${v.id}">▣<small>Save</small></button><button data-go="watch-${v.id}">⋯<small>Details</small></button></div></article>`).join("")}</div>`;
  const els=$$('[data-short-video]');
  const io = new IntersectionObserver(entries=>entries.forEach(e=>{const v=e.target;if(e.isIntersecting&&e.intersectionRatio>.72){els.forEach(x=>{if(x!==v){x.pause();x.muted=true;}});v.play().catch(()=>{});}else v.pause();}),{threshold:[.2,.72]});
  els.forEach(v=>io.observe(v));
  $$('[data-short-play]').forEach(b=>b.onclick=()=>{const v=$(`[data-short-video="${b.dataset.shortPlay}"]`); if(v.paused)v.play().catch(()=>{});else v.pause();});
  els.forEach(v=>v.onclick=()=>{if(v.paused)v.play().catch(()=>{});else v.pause();});
  $$('[data-short-sound]').forEach(b=>b.onclick=()=>{const v=$(`[data-short-video="${b.dataset.shortSound}"]`);v.muted=!v.muted;b.textContent=v.muted?"🔇":"🔊";els.forEach(x=>{if(x!==v)x.muted=true;});});
  $$('[data-short-vote]').forEach(b=>b.onclick=async()=>{try{const id=b.dataset.shortVote;const r=await api(`/videos/${id}/vote`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({vote:Number(b.dataset.vote)})});toast(`Likes ${r.likes} · Dislikes ${r.dislikes}`);}catch(e){toast(e.message);}});
  $$('[data-short-save]').forEach(b=>b.onclick=async()=>{try{await send("POST",`/saved/${b.dataset.shortSave}`,{});toast("Saved to Watch later");}catch(e){toast(e.message);}});
}

async function renderPremiereWaiting(v) {
  const starts = new Date(v.premiere_at);
  $("#view").innerHTML = `<section class="premiere-stage"><div class="premiere-art" style="background-image:url('${v.thumb || ""}')"><span>PREMIERE</span></div><h1>${esc(v.title)}</h1><div class="meta">${esc(v.channel || "OpenTube channel")} · Estreno programado</div><h2 id="premiere-countdown">Preparando estreno…</h2><p>El chat está abierto antes del estreno. El video comenzará automáticamente a la hora programada.</p><section class="premiere-chat"><header><b>Chat en vivo del estreno</b><span class="meta">Chat activo</span></header><div id="pchat-messages" class="pchat-messages"></div><div class="pchat-compose"><input id="pchat-name" maxlength="32" placeholder="Tu nombre" value="${esc(me?.name || "Guest")}"><input id="pchat-input" maxlength="240" placeholder="Di algo…"><button class="up" id="pchat-send">Enviar</button></div></section><button data-go="premieres">Ver otros estrenos</button></section>`;
  setupPremiereChat(v.id);
  const tick=()=>{const left=starts-Date.now();if(left<=0){clearInterval(timer);watchPage(v.id);return;}const h=Math.floor(left/3600000),m=Math.floor(left%3600000/60000),s=Math.floor(left%60000/1000);$("#premiere-countdown").textContent=`Comienza en ${h?`${h}h `:""}${m}m ${s}s`;}; tick(); const timer=setInterval(tick,1000);
}
function setupPremiereChat(id) {
  let lastId=0, stopped=false;
  const paint=rows=>{const box=$("#pchat-messages");if(!box)return;for(const x of rows){lastId=Math.max(lastId,Number(x.id));const el=document.createElement("div");el.className="pchat-message";const name=document.createElement("b");name.textContent=x.nickname;const body=document.createElement("span");body.textContent=" "+x.body;el.append(name,body);box.append(el);}box.scrollTop=box.scrollHeight;};
  const poll=async()=>{if(stopped||!$("#pchat-messages"))return;try{paint(await api(`/videos/${id}/premiere-chat?after=${lastId}`));}catch(e){}};
  const sendChat=async()=>{const input=$("#pchat-input"),name=$("#pchat-name");if(!input||!input.value.trim())return;try{const r=await send("POST",`/videos/${id}/premiere-chat`,{body:input.value,nickname:name.value});input.value="";paint([r]);}catch(e){toast(e.message);}};
  $("#pchat-send").onclick=sendChat;$("#pchat-input").onkeydown=e=>{if(e.key==="Enter")sendChat();};poll();const timer=setInterval(poll,2500);addEventListener("hashchange",()=>{stopped=true;clearInterval(timer);},{once:true});
}

const qualityInfo = {
  "480p": "854×480 · 1,000–2,500 kbps",
  "720p": "1280×720 · 2,500–5,000 kbps",
  "1080p": "1920×1080 · 4,500–8,000 kbps",
  "1440p": "2560×1440 · 9,000–18,000 kbps",
  "2160p": "3840×2160 (4K) · 20,000–35,000 kbps"
};
let liveHls = null;
function mountLivePlayer(video, url) {
  if (liveHls) { liveHls.destroy(); liveHls = null; }
  if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = url; video.play().catch(()=>{}); return; }
  if (window.Hls && Hls.isSupported()) {
    liveHls = new Hls({ enableWorker: true, liveSyncDurationCount: 3 }); liveHls.loadSource(url); liveHls.attachMedia(video);
    liveHls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) toast("Live is offline or SSH101 has not started sending video yet."); });
  } else toast("This browser cannot play HLS streams.");
}
async function livePage(id) {
  if (id) {
    const all = await api("/live"), item = all.find(x => x.channel_id === Number(id));
    if (!item) { go("live"); return; }
    const url = item.playback_url;
    const mine = !!(me && Number(me.id) === Number(item.channel_id));
    const chatName = me?.name || "Guest";
    let lastChatId = 0, stopped = false;
    const safeDate = (t) => t ? new Date(t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "";
    const chatHtml = `<aside class="live-chat"><div class="live-chat-head"><strong>Live chat</strong><span id="liveViewers">● ${Number(item.viewers||0)} watching</span></div><div id="liveChatMessages" class="live-chat-messages"><p class="meta">Welcome to the live chat!</p></div><div class="live-chat-compose"><input id="liveChatName" maxlength="32" value="${esc(chatName)}" aria-label="Chat name"><input id="liveChatText" maxlength="500" placeholder="Say something…" aria-label="Chat message"><button class="up" id="liveChatSend">Send</button></div></aside>`;
    const subscriberCount = Number(item.subscribers || 0);
    $("#view").innerHTML = `<div class="live-watch"><div class="live-screen live-player-shell"><video id="liveVideo" autoplay playsinline muted></video><div class="live-player-top"><span class="live-on">● LIVE</span><span>OpenTube Broadcast</span></div><div class="live-player-bottom"><button id="liveToggle">Ⅱ</button><button id="liveMute">🔇</button><input id="liveVolume" type="range" min="0" max="1" step=".05" value="0.8"><span class="live-status">● EN VIVO</span><button id="liveFull">⛶</button></div></div><div class="live-title"><span class="live-dot">● STREAM</span><h1>${esc(item.title)}</h1><div class="meta"><span class="lnk" data-go="channel-${item.channel_id}">${esc(item.channel)}</span> · ${esc(item.quality)} · ${subscriberCount.toLocaleString()} subscribers</div><p>Powered by SSH101 · Viewers watch directly inside OpenTube.</p>${mine ? '<button class="up" data-go="live">Manage my stream</button>' : ''}</div>${chatHtml}</div>`;
    const lv=$("#liveVideo"); lv.muted=true; lv.volume=.8; mountLivePlayer(lv,url);
    $("#liveToggle").onclick=()=>lv.paused?lv.play().catch(()=>{}):lv.pause();
    $("#liveMute").onclick=()=>{lv.muted=!lv.muted;$("#liveMute").textContent=lv.muted?"🔇":"🔊";};
    $("#liveVolume").oninput=()=>{lv.volume=Number($("#liveVolume").value);lv.muted=lv.volume===0;$("#liveMute").textContent=lv.muted?"🔇":"🔊";};
    $("#liveFull").onclick=()=>{$(".live-player-shell").requestFullscreen?.();};
    lv.addEventListener("play",()=>$("#liveToggle").textContent="Ⅱ");lv.addEventListener("pause",()=>$("#liveToggle").textContent="▶");
    const paintChat = (messages) => { const box=$("#liveChatMessages"); if(!box)return; for(const m of messages){ if(m.id<=lastChatId)continue; lastChatId=Math.max(lastChatId,Number(m.id)); const row=document.createElement("div");row.className="live-chat-msg";row.innerHTML=`<span>${esc(m.nickname)}</span><small>${safeDate(m.date)}</small><p>${esc(m.body)}</p>`;box.append(row); } box.scrollTop=box.scrollHeight; };
    const pollChat = async () => { if(stopped || !$("#liveChatMessages"))return; try{const r=await api(`/live/${id}/chat?after=${lastChatId}`);paintChat(r.messages||[]);$("#liveViewers").textContent=`● ${Number(r.viewers||0)} watching`;}catch(e){} };
    const presence = async () => { try{const r=await send("POST",`/live/${id}/chat/presence`,{});$("#liveViewers").textContent=`● ${Number(r.viewers||0)} watching`;}catch(e){} };
    const sendChat = async () => { const input=$("#liveChatText"), name=$("#liveChatName");if(!input||!input.value.trim())return;try{const m=await send("POST",`/live/${id}/chat`,{body:input.value,nickname:name.value});input.value="";paintChat([m]);}catch(e){toast(e.message);} };
    $("#liveChatSend").onclick=sendChat;$("#liveChatText").onkeydown=e=>{if(e.key==="Enter")sendChat();};
    await pollChat();await presence();const chatTimer=setInterval(pollChat,2500),presenceTimer=setInterval(presence,20000);
    addEventListener("hashchange",()=>{stopped=true;clearInterval(chatTimer);clearInterval(presenceTimer);if(liveHls){liveHls.destroy();liveHls=null;}},{once:true});
    return;
  }
  const [all, own] = await Promise.all([api("/live"), me ? api("/live/mine").catch(() => null) : null]);
  const qualityOptions = ["480p","720p","1080p"].map(q => `<option value="${q}"${(own?.quality || "720p") === q ? " selected" : ""}>${q}</option>`).join("");
  const management = me ? `<section class="live-manage"><h2>Transmitir desde tu canal</h2><p class="meta">OpenTube usa SSH101 como servidor gratuito: OBS envía RTMP a SSH101 y OpenTube reproduce el HLS. No necesitas VPS ni claves de Cloudflare.</p><ol class="ssh101-steps"><li><a href="https://ssh101.com/" target="_blank" rel="noopener">Crea tu canal gratis en SSH101</a>.</li><li>En SSH101 copia tu <b>Streaming Publishing Point</b> (nombre/clave del canal).</li><li>Copia la URL HLS que termina en <code>playlist.m3u8</code>.</li><li>Pega ambos datos aquí y guarda.</li></ol>
    <label>Nombre del directo<input id="liveTitle" maxlength="100" value="${esc(own?.title || me.name + " en vivo")}"></label>
    <label>Calidad indicada<select id="liveQuality">${qualityOptions}</select></label>
    <label>SSH101 Publishing Point / Stream Key<input id="sshStreamName" maxlength="100" autocomplete="off" placeholder="Nombre de tu canal SSH101" value="${esc(own?.stream_name || "")}"></label>
    <label>SSH101 HLS Playback URL (.m3u8)<input id="sshPlaybackUrl" type="url" autocomplete="off" placeholder="https://...giatvcdn.com/.../playlist.m3u8" value="${esc(own?.playback_url || "")}"></label>
    <p class="meta">El enlace HLS lo entrega SSH101 después de crear tu canal. No uses la URL de la página de visualización: pega el enlace directo .m3u8.</p>
    <div class="row"><button class="up" id="liveCreate">${own ? "Guardar cambios de SSH101" : "Conectar SSH101 y crear directo"}</button>${own ? '<button class="danger" id="liveDelete">Eliminar configuración</button>' : ""}</div>
    <div id="liveCredentials"></div>
    </section>` : `<section class="live-manage"><h2>¿Quieres transmitir?</h2><p>Inicia sesión con la clave de tu canal para conectar SSH101.</p><button class="up" data-acc>Sign in / Create channel</button></section>`;
  $("#view").innerHTML = `<div class="live-head"><div><span class="live-dot">● LIVE</span><h1>OpenTube Live</h1><p class="meta">Directos de la comunidad · Powered by SSH101</p></div></div>${management}<h2>Canales en vivo</h2>${all.length ? grid(all.map(x => `<article class="live-card"><div class="live-thumb"><span>▶</span></div><h3>${esc(x.title)}</h3><div class="meta">${esc(x.channel)} · ${esc(x.quality)} · ${Number(x.subscribers||0).toLocaleString()} subscribers</div><button class="up" data-go="live-${x.channel_id}">Ver en OpenTube</button></article>`).join("")) : empty("No live streams yet", "When a channel connects SSH101 and starts OBS, it will appear here.")}`;
  if (me) {
    $("#liveCreate").onclick = async () => { try { const r = await send("POST", "/live", { title: $("#liveTitle").value, quality: $("#liveQuality").value, streamName: $("#sshStreamName").value, playbackUrl: $("#sshPlaybackUrl").value }); showLiveCredentials(r); toast("SSH101 connected to OpenTube"); } catch (e) { toast(e.message); } };
    if ($("#liveDelete")) $("#liveDelete").onclick = async () => { if (!confirm("Delete this OpenTube live configuration? Your SSH101 channel will not be deleted.")) return; try { await send("DELETE", "/live"); toast("Live configuration deleted"); livePage(); } catch (e) { toast(e.message); } };
  }
}
function showLiveCredentials(r) {
  const box = $("#liveCredentials");
  box.innerHTML = `<div class="panel live-creds"><h3>OBS Studio · Settings → Stream</h3><label>Service<strong>Custom…</strong></label><label>Server<code class="key">${esc(r.rtmpUrl)}</code></label><label>Stream Key<code class="key">${esc(r.streamKey)}</code></label><div class="row"><button data-copy="server">Copy server</button><button data-copy="key">Copy stream key</button></div><p class="meta">En OBS, selecciona Custom y pega el servidor y la clave en sus campos. Usa la clave de SSH101, no una clave inventada por OpenTube.</p><h3>OpenTube HLS player URL</h3><code class="key">${esc(r.watchUrl)}</code><p class="meta">Los espectadores verán el directo dentro del reproductor y chat de OpenTube.</p></div>`;
  box.dataset.server = r.rtmpUrl; box.dataset.key = r.streamKey;
  box.querySelector('[data-copy="server"]').onclick = () => navigator.clipboard.writeText(r.rtmpUrl).then(() => toast("Server copied"));
  box.querySelector('[data-copy="key"]').onclick = () => navigator.clipboard.writeText(r.streamKey).then(() => toast("Stream key copied"));
}

async function adminPage() {
  if (!cfg.admin) return go("home");
  const [s, cs] = await Promise.all([api("/admin/stats"), api("/channels"), refresh()]);
  $("#view").innerHTML = `<h2>Admin panel</h2><div class="stats"><div><b>${s.videos}</b>videos</div><div><b>${s.channels}</b>channels</div><div><b>${s.playlists}</b>playlists</div><div><b>${s.comments}</b>comments</div><div><b>${(s.bytes / 1048576).toFixed(1)} MB</b>video storage</div></div>
  <h3>Channels</h3><table class="table">${cs.map((c) => `<tr><td>${esc(c.name)}</td><td class="meta">${c.vcount} videos</td><td style="text-align:right"><button data-go="channel-${c.id}">Open</button> <button class="danger" data-del="/channels/${c.id}" data-n="channel ${esc(c.name)}">Delete</button></td></tr>`).join("") || "<tr><td>None</td></tr>"}</table>
  <h3>All videos</h3><table class="table">${vids.map((v) => `<tr><td>${esc(v.title)}</td><td class="meta">${esc(v.channel || "no channel")}</td><td style="text-align:right"><button data-go="watch-${v.id}">Open</button> <button class="danger" data-del="/videos/${v.id}" data-n="video ${esc(v.title)}">Delete</button></td></tr>`).join("") || "<tr><td>None</td></tr>"}</table>`;
}

/* ---------- dialogs ---------- */
function accountModal() {
  if (me) {
    modal(`<h2>${esc(me.name)}</h2><p class="meta">You are signed in on this device with your channel key.</p><div class="row"><button class="up" id="mc">Open my channel</button><button id="mo">Sign out</button><button data-close>Close</button></div>`);
    $("#mc").onclick = () => { M.close(); go("channel-" + me.id); };
    $("#mo").onclick = () => { me = null; sv("me", null); hdr(); M.close(); route(); };
    return;
  }
  modal(`<h2>Create a channel</h2><p class="meta">No email, phone or account needed. You get a secret key that proves the channel is yours.</p>
  <label>Channel name<input id="cn" maxlength="40"></label><label>About<textarea id="cd" rows="2" maxlength="500"></textarea></label>
  <div class="row"><button class="up" id="cc2">Create channel</button></div>
  <h3>Already have a channel?</h3><label>Channel key<input id="ck" autocomplete="off"></label><div class="row"><button id="cl2">Sign in with key</button></div><div class="meta" id="am"></div>`);
  $("#cc2").onclick = async () => {
    try {
      const r = await send("POST", "/channels", { name: $("#cn").value, descr: $("#cd").value });
      me = { id: r.id, name: r.name, key: r.key }; sv("me", me); hdr();
      modal(`<h2>Channel created</h2><p>This is your channel key. It is shown <b>only once</b>. Save it somewhere safe: it is the only way to manage this channel from another device, and anyone who has it can manage the channel.</p><code class="key">${r.key}</code><div class="row end"><button id="cpk">Copy key</button><button class="up" data-close>Done</button></div>`);
      $("#cpk").onclick = () => navigator.clipboard.writeText(r.key).then(() => toast("Key copied"));
    } catch (e) { $("#am").textContent = e.message; }
  };
  $("#cl2").onclick = async () => {
    try { const key = $("#ck").value.trim(), r = await send("POST", "/channels/login", { key }); me = { id: r.id, name: r.name, key }; sv("me", me); hdr(); M.close(); toast("Signed in"); route(); } catch (e) { $("#am").textContent = e.message; }
  };
}

function adminModal() {
  if (cfg.admin) {
    modal(`<h2>Admin</h2><p class="meta">You can delete any video, channel, playlist or comment. The session ends after 2 hours.</p><div class="row"><button class="up" id="ap">Open admin panel</button><button id="al">Log out</button><button data-close>Close</button></div>`);
    $("#ap").onclick = () => { M.close(); go("admin"); };
    $("#al").onclick = async () => { await send("POST", "/admin/logout"); cfg.admin = false; hdr(); M.close(); toast("Logged out"); route(); };
    return;
  }
  if (!cfg.adminEnabled) return modal(`<h2>Admin is not set up</h2><p>The server owner needs to set the <code>ADMIN_PASSWORD</code> environment variable, then redeploy.</p><div class="row end"><button data-close>Close</button></div>`);
  modal(`<h2>Admin login</h2><label>Password<input id="ap" type="password" autocomplete="current-password"></label><div class="row end"><button data-close>Cancel</button><button class="up" id="ab">Log in</button></div><div class="meta" id="am"></div>`);
  const login = async () => { try { await send("POST", "/admin/login", { password: $("#ap").value }); cfg.admin = true; hdr(); M.close(); toast("Admin mode on"); route(); } catch (e) { $("#am").textContent = e.message; } };
  $("#ab").onclick = login; $("#ap").onkeydown = (e) => { if (e.key === "Enter") login(); };
}

function uploadModal() {
  if (!me) { toast("Create a channel first to upload."); return accountModal(); }
  modal(`<h2>Upload to ${esc(me.name)}</h2><label>Video file<input id="f" type="file" accept="video/*"></label><label>Title<input id="t" maxlength="100"></label><label>Description<textarea id="d" rows="3"></textarea></label><label>Schedule a Premiere (optional)<input id="premiereAt" type="datetime-local"></label><p class="meta">Portrait videos (at least 5:4 tall) up to 3 minutes are automatically listed as Shorts.</p><div class="row end"><button data-close>Cancel</button><button class="up" id="go">Publish / Schedule</button></div><div class="meta" id="msg"></div>`);
  $("#f").onchange = () => { const f = $("#f").files[0]; if (f && !$("#t").value) $("#t").value = f.name.replace(/\.[^.]+$/, ""); };
  $("#go").onclick = async () => {
    const f = $("#f").files[0], b = $("#go");
    if (!f) return ($("#msg").textContent = "Choose a video file first.");
    if (f.size > cfg.maxMb * 1048576) return ($("#msg").textContent = `That file is over the ${cfg.maxMb} MB limit.`);
    b.disabled = true; $("#msg").textContent = "Uploading. Keep this tab open…";
    try {
      const p = await probe(f), fd = new FormData();
      fd.append("title", $("#t").value.trim()); fd.append("desc", $("#d").value.trim()); fd.append("thumb", p.thumb); fd.append("duration", p.duration); fd.append("width", p.width); fd.append("height", p.height); fd.append("premiereAt", $("#premiereAt").value ? new Date($("#premiereAt").value).toISOString() : ""); fd.append("file", f);
      const result = await api("/videos", { method: "POST", body: fd });
      M.close(); toast(result.status === "scheduled" ? "Premiere scheduled" : (result.isShort ? "Short published" : "Published")); await refresh(); go(result.status === "scheduled" ? "premieres" : (result.isShort ? "shorts" : "channel-" + me.id));
    } catch (e) { $("#msg").textContent = e.message; b.disabled = false; }
  };
}
function probe(file) {
  return new Promise((res) => {
    const el = document.createElement("video"), u = URL.createObjectURL(file);
    el.muted = true; el.preload = "metadata"; el.src = u;
    el.onloadedmetadata = () => { el.currentTime = Math.min(1, el.duration / 2 || 0); };
    el.onseeked = () => { const isShort = el.videoHeight / el.videoWidth >= 1.25 && el.duration <= 180; const c = document.createElement("canvas"); c.width = isShort ? 270 : 480; c.height = isShort ? 480 : 270; c.getContext("2d").drawImage(el, 0, 0, c.width, c.height); res({ thumb: c.toDataURL("image/jpeg", .7), duration: el.duration, width: el.videoWidth, height: el.videoHeight }); URL.revokeObjectURL(u); };
    el.onerror = () => { res({ thumb: "", duration: 0, width: 0, height: 0 }); URL.revokeObjectURL(u); };
  });
}

function playlistModal(then) {
  if (!me) return accountModal();
  modal(`<h2>New playlist</h2><label>Name<input id="pt" maxlength="80"></label><label>Description<textarea id="pd2" rows="2"></textarea></label><div class="row end"><button data-close>Cancel</button><button class="up" id="pb">Create</button></div><div class="meta" id="am"></div>`);
  $("#pb").onclick = async () => { try { const r = await send("POST", "/playlists", { title: $("#pt").value, descr: $("#pd2").value }); M.close(); toast("Playlist created"); then ? then(r.id) : go("playlist-" + r.id); } catch (e) { $("#am").textContent = e.message; } };
}
async function saveModal(vid) {
  const mine = me ? await api("/playlists?channel=" + me.id) : [];
  modal(`<h2>Save video</h2><button class="blk" id="watchlater">＋ Save to Watch later</button>${me ? `<h3>Your playlists</h3>${mine.map((p) => `<button class="blk" data-add="${p.id}">${esc(p.title)} (${p.count})</button>`).join("") || '<p class="meta">You have no playlists yet.</p>'}<div class="row"><button id="np">New playlist</button><span class="grow"></span><button data-close>Close</button></div>` : '<p class="meta">Watch later works without a channel. Sign in to a channel if you also want to save into playlists.</p><div class="row end"><button data-close>Close</button></div>'}`);
  $("#watchlater").onclick = async () => { try { await send("POST", `/saved/${vid}`, {}); M.close(); toast("Saved to Watch later"); } catch(e){toast(e.message);} };
  const add = async (pid) => { try { await send("POST", `/playlists/${pid}/items`, { video_id: vid }); M.close(); toast("Saved to playlist"); } catch (e) { toast(e.message); } };
  $$("[data-add]").forEach((b) => (b.onclick = () => add(b.dataset.add)));
  if ($("#np")) $("#np").onclick = () => playlistModal((pid) => add(pid));
}

/* ---------- routing + events ---------- */
async function route() {
  const p = (location.hash.slice(1) || "home").split("-"), r = p[0];
  $$("nav a,.tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.go === r));
  $("#chips").style.display = "none"; nextHash = null;
  try {
    if (LISTS.includes(r)) { $("#view").innerHTML = skel(); vids = await api(r === "premieres" ? "/videos?type=premieres" : (r === "saved" ? "/saved" : "/videos")).catch(() => []); videosPage(r); }
    else if (r === "channels") await channelsPage();
    else if (r === "channel") await channelPage(+p[1]);
    else if (r === "playlists") await playlistsPage();
    else if (r === "live") await livePage(p[1] ? +p[1] : 0);
    else if (r === "playlist") await playlistPage(+p[1]);
    else if (r === "watch") await watchPage(+p[1], p[2] === "pl" ? +p[3] : 0);
    else if (r === "admin") await adminPage();
    else return go("home");
  } catch (e) { $("#view").innerHTML = empty("Couldn’t load this page", esc(e.message), '<button data-go="home">Back to Home</button>'); }
  if (r !== "watch") window.scrollTo(0, 0);
}

document.addEventListener("click", async (e) => {
  const t = (s) => e.target.closest(s);
  if (t("[data-del]")) { const b = t("[data-del]"); if (!confirm(`Delete ${b.dataset.n}?`)) return; try { await send("DELETE", b.dataset.del); toast("Deleted"); route(); } catch (x) { toast(x.message); } return; }
  if (t("[data-rm]")) return;
  if (t("[data-go]")) { go(t("[data-go]").dataset.go); return; }
  if (t("[data-s]")) { sort = t("[data-s]").dataset.s; videosPage("home"); }
  if (t("[data-tab]")) { tab = t("[data-tab]").dataset.tab; route(); }
  if (t("[data-up]")) uploadModal();
  if (t("[data-acc]")) accountModal();
});
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select")) return;
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.go) return go(e.target.dataset.go);
  const pv = $("#pv"); if (!pv || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "k" || (k === " " && e.target === document.body)) { e.preventDefault(); pv.paused ? pv.play() : pv.pause(); }
  else if (k === "j") pv.currentTime -= 10; else if (k === "l") pv.currentTime += 10;
  else if (k === "m") pv.muted = !pv.muted; else if (k === "f") pv.requestFullscreen && pv.requestFullscreen();
  else if (k === "t") $("#th").click(); else if (k === "n" && nextHash) location.hash = nextHash;
});
$("#logo").onclick = () => { term = ""; $("#q").value = ""; go("home"); };
const doSearch = () => { term = $("#q").value; const r = (location.hash.slice(1) || "home").split("-")[0]; LISTS.includes(r) ? videosPage(r) : go("home"); };
$("#sb").onclick = doSearch; $("#q").oninput = doSearch;
$("#upb").onclick = uploadModal; $("#acc").onclick = accountModal; $("#adm").onclick = adminModal;
$("#tb").onclick = () => { const r = document.documentElement, d = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme:dark)").matches; r.dataset.theme = d ? "light" : "dark"; };
addEventListener("hashchange", route);
(async () => { try { cfg = await api("/config"); } catch (e) {} hdr(); route(); })();
