/* app.js: the content review studio. Renders every post inside an iPhone LinkedIn (or X) feed with a review layer:
   one approval per reviewer role and a shared feedback feed, stored in localStorage AND in the shared Google Sheet
   (Apps Script web app at STUDIO.sync_url). An item shows "Saved" only after it is read back from the sheet.
   Everything comes from data.js (kits/content/publish.py); nothing here is brand specific. */
(function () {
  const C = window.CORE, esc = C.esc, S = window.STUDIO;
  const LI_I = () => window.LI.I;
  const HASH = location.hash; /* read before anything rewrites it: a #r=... hash carries a shared review */
  const SLUG = (S.slug || "content").replace(/[^a-z0-9-]/gi, "");
  const ROLES = (S.reviewers && S.reviewers.length ? S.reviewers : [{ role: "owner", label: "Owner" }, { role: "team", label: "Team" }]);
  document.title = S.title || "Content review";

  /* ---------- review state: an append-only event log {id,t,post,kind,name,role,value,text} ---------- */
  const KEY = `${SLUG}-review-events-v1`, NAMEKEY = `${SLUG}-reviewer-name`, SYNC = S.sync_url || "";
  let EV = loadEv();
  function loadEv() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
  function saveEv() { localStorage.setItem(KEY, JSON.stringify(EV)); tally(); }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function merge(list) { const have = new Set(EV.map((e) => e.id)); let n = 0; (list || []).forEach((e) => { if (e && e.id && !have.has(e.id)) { EV.push(e); have.add(e.id); n++; } }); EV.sort((a, b) => String(a.t).localeCompare(String(b.t))); return n; }
  /* Removal is append-only too: a "_retract" event names the id it hides. Deleted sheet rows come back, because any
     browser still holding the event re-sends it (the durability guarantee). */
  const RETRACT = "_retract";
  const live = () => { const gone = new Set(EV.filter((e) => e.post === RETRACT).map((e) => e.text)); return EV.filter((e) => e.post !== RETRACT && !gone.has(e.id)); };
  const comments = (post) => live().filter((e) => e.post === post && e.kind === "comment");
  function appr(post, role) { const l = live().filter((e) => e.post === post && e.kind === "approve" && e.role === role); return l.length ? l[l.length - 1] : null; }
  const rv = (id) => { const by = {}; ROLES.forEach((r) => { const a = appr(id, r.role); by[r.role] = { on: !!(a && a.value), ev: a }; }); return { by, all: ROLES.every((r) => by[r.role].on) }; };
  const fmtT = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  let syncState = SYNC ? "connecting" : "local", REMOTE = new Set(JSON.parse(localStorage.getItem(`${SLUG}-review-remote`) || "[]")), retryT = null, backoff = 2000;
  const pending = () => (SYNC ? EV.filter((e) => !REMOTE.has(e.id)) : []);
  const saved = (e) => !SYNC || REMOTE.has(e.id);
  const sent = {};
  function push(e) {
    if (!SYNC) return;
    sent[e.id] = Date.now();
    fetch(SYNC, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(e) })
      .catch(() => { syncState = "offline"; syncBadge(); });
  }
  function schedule(ms) { clearTimeout(retryT); retryT = setTimeout(pull, ms); }
  async function pull() {
    if (!SYNC) return;
    try {
      const r = await fetch(SYNC + (SYNC.includes("?") ? "&" : "?") + "t=" + Date.now());
      const remote = await r.json();
      const was = pending().map((e) => e.id).join();
      REMOTE = new Set(remote.map((x) => x.id)); localStorage.setItem(`${SLUG}-review-remote`, JSON.stringify([...REMOTE]));
      const n = merge(remote); saveEv(); syncState = "live";
      pending().forEach((e) => { if (!sent[e.id] || Date.now() - sent[e.id] > 4000) push(e); });
      if (n || was !== pending().map((e) => e.id).join()) refreshReviews();
      if (n) C.toast(n + " new review item" + (n === 1 ? "" : "s"));
    } catch { syncState = "offline"; }
    syncBadge();
    if (pending().length) { schedule(backoff); backoff = Math.min(backoff * 1.6, 30000); } else { backoff = 2000; schedule(45000); }
  }
  function syncBadge() {
    const el = document.getElementById("sync"); if (!el) return; const k = pending().length;
    const m = !SYNC ? ["Saved in this browser only", "warn"] : syncState === "offline" ? [`Offline · ${k} waiting, retrying`, "warn"]
      : syncState === "connecting" ? ["Connecting…", ""] : k ? [`Saving ${k}…`, "warn"] : ["✓ All saved to shared sheet", "ok"];
    el.textContent = m[0]; el.className = "syncb " + m[1];
  }
  function add(e) { e.id = uid(); e.t = new Date().toISOString(); EV.push(e); saveEv(); push(e); syncBadge(); backoff = 2000; schedule(1500); return e; }
  window.addEventListener("online", () => { backoff = 2000; pull(); });
  window.addEventListener("pagehide", () => { if (!SYNC) return; pending().forEach((e) => { try { navigator.sendBeacon(SYNC, new Blob([JSON.stringify(e)], { type: "text/plain;charset=utf-8" })); } catch {} }); });
  window.addEventListener("beforeunload", (ev) => { if (pending().length || document.querySelector("[data-fb]:not(:placeholder-shown)")) { ev.preventDefault(); ev.returnValue = ""; } });
  /* unsent drafts survive reloads */
  const DK = `${SLUG}-review-drafts`, drafts = JSON.parse(localStorage.getItem(DK) || "{}");
  const saveDraft = (post, v) => { if (v) drafts[post] = v; else delete drafts[post]; localStorage.setItem(DK, JSON.stringify(drafts)); };
  document.addEventListener("input", (e) => { if (e.target.matches("[data-fb]")) saveDraft(e.target.closest(".pcard").dataset.id, e.target.value); if (e.target.matches("[data-name]")) localStorage.setItem(NAMEKEY, e.target.value.trim());
    if (e.target.matches("[data-plink]")) { const c = e.target.closest(".pcard"), p = S.posts.find((x) => x.key === c.dataset.id); localStorage.setItem(PLKEY(p), e.target.value.trim()); c.querySelector('[data-msg="email"]').textContent = dmText(p, "email"); } });
  const mark = (e) => (saved(e) ? `<em class="sv ok" title="Confirmed in the shared Google Sheet">✓ Saved</em>` : `<em class="sv wait" title="Stored in this browser, being sent to the shared sheet">Saving…</em>`);

  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));

  /* ---------- helpers ---------- */
  const prof = (id) => S.profiles.find((p) => p.id === id) || { id, name: id, headline: "", kind: "person" };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const tzLabel = (pr) => pr.tz_label || pr.tz || "";
  function when(p) {
    const d = new Date(p.date + "T12:00:00Z");
    return { day: `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`, time: `${p.time || ""} ${tzLabel(prof(p.profile))}`.trim() };
  }
  const avatar = (pr, size) => `<span class="av${pr.kind === "company" ? " sq" : ""}" style="width:${size}px;height:${size}px;border-radius:${pr.kind === "company" ? "6px" : "50%"};background:#9aa3b2">${pr.avatar_ok ? `<img src="${esc(pr.avatar)}" alt="">` : `<b style="color:#fff;font-size:${Math.round(size * 0.4)}px">${esc((pr.name || "?")[0])}</b>`}</span>`;
  const me = () => S.profiles.find((p) => p.kind !== "company") || S.profiles[0] || { name: "?" };

  /* ---------- LinkedIn iOS post ---------- */
  function mediaHtml(p) {
    const m = p.media || {};
    if (m.type === "image" && m.files && m.files.length) {
      return `<div class="li-imgpost${m.tall ? " tall" : ""}"><img loading="lazy" src="${esc(m.files[0])}" alt="${esc(p.id)}" data-lb="${esc(m.files[0])}" data-lb-caption="${esc(p.id)} · ${esc(p.idea || "")}"></div>`;
    }
    if (m.type === "video" && m.video) {
      return `<div class="li-imgpost li-vid${m.tall ? " tall" : ""}"><video src="${esc(m.video)}" poster="${esc(m.files[0])}" autoplay loop muted playsinline preload="metadata" aria-label="${esc(p.id)} animation"></video><span class="li-gif">GIF</span></div>`;
    }
    if (m.type === "carousel" && m.files && m.files.length) {
      const g = "car-" + p.key, n = m.files.length;
      const slides = m.files.map((f, i) => `<div class="li-slide"><img loading="lazy" src="${esc(f)}" alt="${esc(p.id)} page ${i + 1}" data-lb="${esc(f)}" data-lb-group="${g}" data-lb-caption="${esc(m.title || p.id)} · page ${i + 1} of ${n}"></div>`).join("");
      return `<div class="li-doc"><div class="li-doc-head"><span class="li-doc-title">${esc(m.title || p.idea || "")}</span><span class="li-doc-pages">${n} pages</span></div>
        <div class="li-doc-view"><div class="li-slides" data-pages="${n}">${slides}</div><span class="li-pg">1 / ${n}</span><span class="li-exp" title="View full screen">${LI_I().expand}</span><button class="li-arr prev" data-dir="-1" title="Previous slide">‹</button><button class="li-arr next" data-dir="1" title="Next slide">›</button></div></div>`;
    }
    if (m.type === "poll") {
      return `<div class="li-poll"><div class="li-poll-q">${esc(m.question)}</div><div class="li-poll-s">The author can see how you vote. <span style="color:#0a66c2;font-weight:600">Learn more</span></div>${(m.options || []).map((o) => `<button class="li-poll-o">${esc(o)}</button>`).join("")}<div class="li-poll-f">0 votes · 1w left</div></div>`;
    }
    if (m.type === "pending") return `<div class="wipbox"><b>Media in production</b>${p.format ? `<span>${esc(p.format)}</span>` : ""}${(p.visual_copy || []).length ? `<ol>${p.visual_copy.map((v) => `<li>${esc(v)}</li>`).join("")}</ol>` : ""}</div>`;
    return "";
  }
  function postText(p) {
    const html = C.rich(p.text, "li-link").replace(/(^|\s)(#[A-Za-z0-9_]+)/g, '$1<span class="li-tag">$2</span>').replace(/\n/g, "<br>");
    return `<div class="li-text clamp">${html}<span class="li-more" title="Show the full post">…more</span></div>`;
  }
  function commentHtml(p, pr) {
    if (!p.first_comment) return "";
    const txt = C.rich(p.first_comment, "li-link").replace(/\n/g, "<br>");
    const tc = p.team_comments || [], shown = tc.slice(0, 3);
    const one = (c) => { const cp = prof(c.by) || { name: c.by }, isA = c.by === p.profile;
      return `<div class="li-cm${c.reply_to != null ? " li-rep" : ""}">${avatar(cp, c.reply_to != null ? 24 : 32)}<div class="li-cm-b"><div class="li-cm-bubble"><div class="li-cm-n">${esc(cp.name)}${isA ? ' <span class="li-auth">Author</span>' : ' <span class="li-deg">· 1st</span>'}</div><div class="li-cm-h">${esc(cp.headline || "")}</div><div class="li-cm-t">${C.rich(c.text, "li-link").replace(/\n/g, "<br>")}</div></div><div class="li-cm-a">Like · Reply</div></div></div>`; };
    return `<div class="li-cmts"><div class="li-cm-sort">Most relevant ▾</div><div class="li-cm">${avatar(pr, 32)}<div class="li-cm-b"><div class="li-cm-bubble"><div class="li-cm-n">${esc(pr.name)} <span class="li-auth">Author</span></div><div class="li-cm-h">${esc(pr.headline || "")}</div><div class="li-cm-t">${txt}</div></div><div class="li-cm-a">Like · Reply</div></div></div>${shown.map(one).join("")}${tc.length > shown.length ? `<div class="li-cm-more">Load more comments (${tc.length - shown.length})</div>` : ""}</div>`;
  }
  function screen(p) {
    const pr = prof(p.profile), I = LI_I(), isCo = pr.kind === "company";
    const top = `<div class="li-top">${avatar(me(), 32)}<div class="li-search">${I.search}<span>Search</span></div><span class="li-ic">${I.msg}</span></div>`;
    const tabs = `<div class="li-tabs"><div class="li-tab on">${I.home}<span>Home</span></div><div class="li-tab">${I.net}<span>My Network</span></div><div class="li-tab">${I.post}<span>Post</span></div><div class="li-tab">${I.bell}<span>Notifications</span></div><div class="li-tab">${I.jobs}<span>Jobs</span></div></div>`;
    const post = `<article class="li-post">
      <div class="li-head">${avatar(pr, 48)}<div class="li-who"><div class="li-name">${esc(pr.name)}${isCo ? "" : ' <span class="li-deg">· 1st</span>'}</div><div class="li-sub">${esc(isCo ? pr.followers_line || pr.headline || "" : pr.headline || "")}</div><div class="li-sub">Now · ${I.globe}</div></div><span class="li-ic">${I.more}</span><span class="li-ic">${I.x}</span></div>
      ${postText(p)}${mediaHtml(p)}
      <div class="li-actions"><span>${I.like}Like</span><span>${I.comment}Comment</span><span>${I.repost}Repost</span><span>${I.send}Send</span></div>
      ${commentHtml(p, pr)}
    </article>`;
    return `${C.statusBar()}${top}<div class="scroll li-feed">${post}</div>${tabs}${C.home()}`;
  }

  /* ---------- card = header + phone + review + download strip + details ---------- */
  function card(p) {
    const w = when(p), isX = p.platform === "x";
    const nThread = 1 + (p.thread || []).length, mt = p.media && p.media.type;
    const fmt = isX ? `<span class="badge xb">X</span><span class="badge fmt">${esc(nThread > 1 ? `Thread · ${nThread} posts` : "Single post")}${mt === "image" || mt === "images" ? ` · ${(p.media.files || []).length} image${(p.media.files || []).length === 1 ? "" : "s"}` : ""}</span>`
      : `<span class="badge fmt">${esc(mt === "carousel" ? "Carousel" : mt === "poll" ? "Poll" : mt === "image" ? "Image" : /^carousel/i.test(p.format || "") ? "Carousel" : /^image/i.test(p.format || "") ? "Image" : "Text")}</span>`;
    const cta = p.cta ? `<span class="badge cta">${esc(((S.batches || []).find((b) => String(b.id) === String(p.batch)) || {}).cta_label || S.cta_label || "CTA")}</span>` : "";
    const wip = p.status !== "ready" ? `<span class="badge wip">In production</span>` : "";
    const smp = p.sample || {};
    return `<article class="pcard card" id="${esc(p.key)}" data-id="${esc(p.key)}">
      <header class="chead"><div class="crow"><span class="pid">${esc(p.id)}</span><span class="when">${esc(w.day)} <span>· ${esc(w.time)}</span></span></div>
        <div class="crow">${fmt}${cta}${wip}</div><div class="cidea">${esc(p.idea || "")}</div></header>
      ${isX ? C.phone(window.XV.screen(p, prof(p.profile)), "x") : C.phone(screen(p), "linkedin")}
      <section class="rev" data-rev="${esc(p.key)}">${revHtml(p.key)}</section>
      ${dlHtml(p)}${resHtml(p)}${teamHtml(p)}
      <details class="info"><summary>Sample, template, first comment and sources</summary><dl>
        <dt>Sample matched</dt><dd><b>${esc(smp.id || "")}</b> · ${esc(smp.creator || "")}${smp.url ? ` · <a href="${esc(smp.url)}" target="_blank" rel="noopener">view original post</a>` : ""}<br>${esc(smp.what || "")}${smp.thumb ? `<img class="sthumb" src="${esc(smp.thumb)}" data-lb="${esc(smp.thumb)}" data-lb-caption="Sample ${esc(smp.id || "")}">` : ""}</dd>
        <dt>Copy template</dt><dd>${esc(p.copy_basis || "")}</dd>
        ${(p.visual_copy || []).length ? `<dt>${esc(p.visual_label || "On the visual")}</dt><dd><ol class="vcopy">${p.visual_copy.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></dd>` : ""}
        ${p.resource ? `<dt>Resource we send</dt><dd><b>${esc(p.resource.name || "")}</b>${p.resource.keyword ? ` · keyword ${esc(p.resource.keyword)}` : ""}<br>${esc(p.resource.what || "")}</dd>` : ""}
        ${p.repurposed_from ? `<dt>Repurposed from</dt><dd>${esc(p.repurposed_from)} (approved LinkedIn post) · ${esc(p.format || "")}</dd>` : ""}
        <dt>First comment</dt><dd>${isX ? "Not used on X: the CTA link is inside the post or the last thread post" : p.first_comment ? `<div class="fc">${esc(p.first_comment)}</div>` : "None (not a CTA post)"}</dd>
        <dt>Sources</dt><dd>${(p.sources || []).map(esc).join("<br>")}</dd>
        ${(p.flags || []).length ? `<dt>Needs confirmation</dt><dd style="color:#a15c00">${p.flags.map(esc).join("<br>")}</dd>` : ""}
        ${(p.numbers_for_signoff || []).length ? `<dt>${esc(S.signoff_label || "Numbers for sign-off")}</dt><dd>${p.numbers_for_signoff.map(esc).join(" · ")}</dd>` : ""}
      </dl></details>
    </article>`;
  }
  /* Ready-to-post strip: the full-quality upload file (original PNG, or the carousel as a lossless PDF, never the
     on-screen JPG previews), plus one-click copy of the post copy and the first comment. */
  const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  function dlHtml(p) {
    const d = (p.media || {}).download, many = (p.media || {}).downloads || [];
    const copyBtn = `<button class="btn ghost" data-copyt="text">Copy post copy${(p.thread || []).length ? " (whole thread)" : ""}</button>`;
    const noX = `<button class="btn ghost" disabled title="X has no first comment">No first comment on X</button>`;
    if (many.length) {
      const btns = many.map((x, i) => `<a class="btn dlb" href="${esc(x.href)}" download="${esc(x.name)}" title="${x.w} × ${x.h} px · full quality · ${mb(x.bytes)}">Download PNG ${i + 1} of ${many.length}</a>`).join("");
      return `<section class="dl"><div class="dlrow dlmany">${btns}</div><div class="dlrow"><span class="dlm">${many[0].w} × ${many[0].h} px each · full quality</span></div><div class="dlrow">${copyBtn}${p.platform === "x" ? noX : p.first_comment ? `<button class="btn ghost" data-copyt="first_comment">Copy first comment</button>` : ""}</div></section>`;
    }
    if ((p.media || {}).sets && p.media.sets.length) {
      const s = p.media.sets, fc2 = p.first_comment ? `<button class="btn ghost" data-copyt="first_comment">Copy first comment</button>` : `<button class="btn ghost" disabled title="This post has no first comment">No first comment</button>`;
      return `<section class="dl"><div class="dlrow">${s.map((x) => `<a class="btn dlb half" href="${esc(x.href)}" download="${esc(x.name)}" title="${mb(x.bytes)}">${esc(x.label)} · ${mb(x.bytes)}</a>`).join("")}<span class="dlm">Animated 4:5 · post the GIF as an image, or the MP4 as a video</span></div><div class="dlrow">${copyBtn}${fc2}</div></section>`;
    }
    const file = d ? `<a class="btn dlb" href="${esc(d.href)}" download="${esc(d.name)}">${d.ext === "pdf" ? `Download PDF · ${d.pages} slides` : "Download PNG"}</a>
        <span class="dlm">${d.w} × ${d.h} px · full quality · ${mb(d.bytes)}</span>` : "";
    const fc = p.first_comment ? `<button class="btn ghost" data-copyt="first_comment">Copy first comment</button>` : p.platform === "x" ? noX : `<button class="btn ghost" disabled title="This post has no first comment">No first comment</button>`;
    return `<section class="dl">${file ? `<div class="dlrow">${file}</div>` : ""}<div class="dlrow"><button class="btn ghost" data-copyt="text">Copy post copy${(p.thread || []).length ? " (whole thread)" : ""}</button>${fc}</div></section>`;
  }
  /* Giveaway posts: the resource itself (the live hosted page, scrollable) and the three messages that deliver it.
     [POST LINK] in the email is replaced by the live post link once the reviewer pastes it in. */
  const PLKEY = (p) => "studio-postlink-" + p.key;
  const dmText = (p, k) => { const d = p.dm || {}, link = (localStorage.getItem(PLKEY(p)) || "").trim();
    const t = k === "email" ? `Subject: ${d.email_subject}\n\n${d.email_body}` : d[k] || ""; return link ? t.split("[POST LINK]").join(link) : t; };
  /* Team comments (Adi, 2026-11-11: cardinal rule): ten per post, from the team, each posted by that person from their own profile. */
  const TONE = { positive: "Positive", feedback: "Feedback", question: "Question", differs: "Different view" };
  function teamHtml(p) {
    const tc = p.team_comments || [];
    if (!tc.length) return `<section class="dl res tcm"><div class="resh"><b>Team comments</b><span>Not written yet</span></div></section>`;
    const row = (c, i) => { const cp = prof(c.by) || { name: c.by }, to = c.reply_to != null ? tc[c.reply_to] : null;
      return `<div class="tc${to ? " rep" : ""}">${avatar(cp, 28)}<div class="tcb"><div class="tch"><b>${esc(cp.name)}</b>${to ? `<span class="tcr">replying to ${esc((prof(to.by) || { name: to.by }).name.split(" ")[0])}</span>` : ""}<span class="tct ${esc(c.tone || "")}">${esc(TONE[c.tone] || "")}</span><button class="btn ghost" data-copyc="${i}">Copy</button></div><div class="tcx">${esc(c.text).replace(/\n/g, "<br>")}</div></div></div>`; };
    return `<section class="dl res tcm"><details><summary class="resh"><b>Team comments · ${tc.length}</b><span>Each person posts their own from their profile, in the first hour</span></summary>${tc.map(row).join("")}</details></section>`;
  }
  function resHtml(p) {
    const r = p.resource || {}, d = p.dm;
    if (!r.url) return "";
    const files = (r.files || []).map((f) => `<a class="btn ghost" href="${esc(f.href)}" target="_blank" rel="noopener">Download ${esc(f.label)}</a>`).join("");
    const box = (k, title, note) => `<div class="msg"><div class="msgh"><b>${title}</b><button class="btn ghost" data-copym="${k}">Copy</button></div><pre data-msg="${k}">${esc(dmText(p, k))}</pre>${note ? `<div class="dlm">${note}</div>` : ""}</div>`;
    return `<section class="dl res"><div class="resh"><b>Resource we send</b><span>${esc(r.name || "")}${r.pages ? ` · ${r.pages} page${r.pages === 1 ? "" : "s"}` : ""}</span></div>
      <div class="resw"><iframe class="resf" src="${esc(r.preview || r.url)}" title="${esc(r.name || "Resource")}" loading="lazy"></iframe></div>
      <div class="dlm">Scroll inside the preview. This is the page your commenters open${r.preview ? `, at ${esc(r.url)}` : ""}.</div>
      <div class="dlrow"><a class="btn dlb" href="${esc(r.preview || r.url)}" target="_blank" rel="noopener">Open the resource</a><button class="btn ghost" data-copym="url">Copy link</button>${files}</div></section>
    ${d ? `<section class="dl res"><div class="resh"><b>Messages that deliver it</b><span>Sent from Adi's profile to everyone who comments ${esc(r.keyword || "")}</span></div>
      <label class="plink"><span>Live post link (goes into the email)</span><input data-plink placeholder="Paste the LinkedIn post link once it is live" value="${esc(localStorage.getItem(PLKEY(p)) || "")}"></label>
      ${box("message", "1. LinkedIn message", "For people already connected.")}
      ${box("connect", "2. Connection request", `For people not connected yet · ${d.connect.length} of 300 characters`)}
      ${box("email", "3. Email", "For commenters whose email we have.")}</section>` : ""}`;
  }
  const RESW = 520, RESH = 480;
  const fitRes = new ResizeObserver((es) => es.forEach((e) => { const w = e.contentRect.width, f = e.target.firstElementChild; if (!w || !f) return;
    const k = Math.min(1, w / RESW); f.style.width = (k < 1 ? RESW : w) + "px"; f.style.height = RESH / k + "px"; f.style.transform = k < 1 ? `scale(${k})` : "none"; }));
  const watchRes = () => document.querySelectorAll(".resw:not([data-fit])").forEach((el) => { el.dataset.fit = "1"; fitRes.observe(el); });
  new MutationObserver(watchRes).observe(document.body, { childList: true, subtree: true }); watchRes();
  function copyLegacy(s) {
    const ta = Object.assign(document.createElement("textarea"), { value: s }); ta.style.cssText = "position:fixed;top:0;opacity:0";
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error("copy blocked"));
  }
  const copyText = (s) => (navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(s).catch(() => copyLegacy(s)) : copyLegacy(s));

  function revHtml(id) {
    const r = rv(id), cs = comments(id), myName = localStorage.getItem(NAMEKEY) || "";
    const who = (x) => (x ? `<small>${esc(x.name || "")}${x.name ? " · " : ""}${esc(fmtT(x.t))} ${mark(x)}</small>` : "");
    return `<div class="appr">${ROLES.map((ro) => { const a = r.by[ro.role]; return `<label class="ck${a.on ? " on" : ""}"><input type="checkbox" data-appr="${esc(ro.role)}" ${a.on ? "checked" : ""}><span>${esc(ro.label)}${a.ev ? who(a.ev) : ""}</span></label>`; }).join("")}</div>
      <div class="feed">${cs.length ? cs.map((c) => `<div class="fbi"><span class="fav">${esc((c.name || "?").trim().slice(0, 1).toUpperCase())}</span><div><div class="fbh"><b>${esc(c.name || "Reviewer")}</b><span>${esc(fmtT(c.t))} ${mark(c)}</span></div><div class="fbt">${esc(c.text).replace(/\n/g, "<br>")}</div></div></div>`).join("") : `<div class="fbe">No feedback yet.</div>`}</div>
      <div class="fbin"><input data-name placeholder="Your name" value="${esc(myName)}"><textarea data-fb placeholder="Add feedback on copy, design or timing...">${esc(drafts[id] || "")}</textarea><div class="fbrow"><span class="saved">${cs.length} ${cs.length === 1 ? "note" : "notes"}</span><button class="btn" data-addfb>Add feedback</button></div></div>`;
  }
  function refreshReviews() {
    const act = document.activeElement, host = act && act.closest && act.closest("[data-rev]"), sel = act && act.matches && (act.matches("[data-fb]") ? "[data-fb]" : act.matches("[data-name]") ? "[data-name]" : ""), pos = sel ? act.selectionStart : 0;
    document.querySelectorAll("[data-rev]").forEach((el) => { const ta = el.querySelector("[data-fb]"), draft = ta ? ta.value : ""; el.innerHTML = revHtml(el.dataset.rev); if (draft) el.querySelector("[data-fb]").value = draft; });
    if (host && sel) { const f = document.querySelector(`[data-rev="${host.dataset.rev}"] ${sel}`); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch {} } }
    nav(); tally();
  }

  /* ---------- page: one batch on screen at a time ---------- */
  let filter = "all";
  function visible(p) { const r = rv(p.key); if (filter === "approved") return r.all; if (filter === "todo") return !r.all; return true; }
  const batches = () => (S.batches && S.batches.length ? S.batches : [{ id: "1", title: "Batch 1" }]);
  const bOf = (p) => String(p.batch || "1");
  const profsOf = (bid) => S.profiles.filter((pr) => S.posts.some((p) => bOf(p) === bid && p.profile === pr.id));
  const postsOf = (bid, prid) => S.posts.filter((p) => bOf(p) === bid && p.profile === prid).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const hashB = (location.hash.match(/^#b(\w+)-profile-/) || [])[1];
  let active = [hashB, localStorage.getItem(`${SLUG}-active-batch`)].find((b) => b && batches().some((x) => String(x.id) === b)) || String(batches()[batches().length - 1].id);
  const inActive = (p) => bOf(p) === active;
  function setActive(b) { if (b === active) return false; active = b; localStorage.setItem(`${SLUG}-active-batch`, b); render(); fit(); return true; }
  function render() {
    document.getElementById("btitle").textContent = S.title || "Content review";
    const main = document.getElementById("main");
    main.innerHTML = batches().filter((bt) => String(bt.id) === active).map((bt) => {
      const bid = String(bt.id), profs = profsOf(bid);
      return `<section class="batch" id="batch-${esc(bid)}">
      <div class="bhead"><h1>${esc(bt.title || "Batch " + bid)}</h1><p>${esc(bt.dates || "")} · ${S.posts.filter((p) => bOf(p) === bid).length} posts across ${profs.length} profile${profs.length === 1 ? "" : "s"}${bt.platform === "x" ? " · X (Twitter)" : ""}</p></div>
      ${profs.map((pr, i, all) => {
        const posts = postsOf(bid, pr.id);
        return `<section class="profile" id="b${esc(bid)}-profile-${esc(pr.id)}">
        <div class="phead">${pr.avatar_ok ? `<img class="${pr.kind === "company" ? "sq" : ""}" src="${esc(pr.avatar)}" alt="">` : ""}<div class="pwho"><h2>${esc(pr.name)}</h2><p class="phl" title="${esc(pr.headline || "")}">${esc(pr.headline || "")}</p><p class="pmeta">${posts.length} posts · ${esc(`${pr.time || ""} ${tzLabel(pr)}`.trim())}</p></div><span class="order">${i + 1} of ${all.length}</span></div>
        <div class="pgrid">${posts.length ? posts.map(card).join("") : `<div class="pnote">Posts for this profile are in production.</div>`}</div>
      </section>`; }).join("") || `<div class="pnote">No posts in this batch yet.</div>`}
    </section>`; }).join("");
    applyFilter(); nav();
    if (window.LI && window.LI.afterRender) window.LI.afterRender();
    tally();
  }
  function applyFilter() { document.querySelectorAll(".pcard").forEach((el) => { const p = S.posts.find((x) => x.key === el.dataset.id); el.classList.toggle("hide", !visible(p)); }); }
  const openB = JSON.parse(localStorage.getItem(`${SLUG}-nav-open`) || "{}");
  function nav() {
    document.getElementById("sidenav").innerHTML = batches().map((bt, bi) => {
      const bid = String(bt.id), isOpen = openB[bid] !== undefined ? openB[bid] : bi === batches().length - 1;
      return `<details class="bnav${bid === active ? " act" : ""}" data-b="${esc(bid)}" ${isOpen || bid === active ? "open" : ""}><summary>${esc(bt.title || "Batch " + bid)}<small>${S.posts.filter((p) => bOf(p) === bid).length} posts</small></summary>` +
        profsOf(bid).map((pr) => {
          const posts = postsOf(bid, pr.id), done = posts.filter((p) => rv(p.key).all).length;
          return `<a href="#b${esc(bid)}-profile-${esc(pr.id)}" data-target="b${esc(bid)}-profile-${esc(pr.id)}"><span>${esc(pr.name)}</span><small class="cnt">${done}/${posts.length}</small></a>`;
        }).join("") + `</details>`;
    }).join("");
    document.querySelectorAll(".bnav").forEach((d) => d.addEventListener("toggle", () => { openB[d.dataset.b] = d.open; localStorage.setItem(`${SLUG}-nav-open`, JSON.stringify(openB)); }));
    document.querySelectorAll(".bnav summary").forEach((sm) => sm.addEventListener("click", () => { const b = sm.parentElement.dataset.b; if (b !== active) { openB[b] = false; setActive(b); window.scrollTo(0, 0); } }));
  }
  function tally() {
    const L = S.posts.filter(inActive), n = L.length;
    const parts = ROLES.map((ro) => `${esc(ro.label)} <b>${L.filter((p) => rv(p.key).by[ro.role].on).length}/${n}</b>`);
    parts.push(`All <b>${L.filter((p) => rv(p.key).all).length}</b>`);
    const el = document.getElementById("tally"); if (el) el.innerHTML = parts.join(" · ");
  }

  /* ---------- events ---------- */
  const myName = (cardEl) => { const v = (cardEl.querySelector("[data-name]").value || "").trim(); if (v) localStorage.setItem(NAMEKEY, v); return v; };
  document.addEventListener("change", (e) => {
    const ap = e.target.closest("[data-appr]"); if (!ap) return;
    const cardEl = ap.closest(".pcard"), role = ap.dataset.appr, ro = ROLES.find((x) => x.role === role) || { label: role };
    add({ post: cardEl.dataset.id, kind: "approve", role, value: ap.checked, name: myName(cardEl) || ro.label });
    refreshReviews(); C.toast(ap.checked ? "Approval stored, confirming…" : "Approval removed, confirming…");
  });
  document.addEventListener("click", (e) => {
    const nl = e.target.closest("#sidenav a[data-target]");
    if (nl) {
      e.preventDefault();
      const nb = (nl.dataset.target.match(/^b(\w+)-profile-/) || [])[1];
      setActive(nb);
      requestAnimationFrame(() => { const el = document.getElementById(nl.dataset.target); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" }); });
      return;
    }
    const sv = e.target.closest("[data-addfb]");
    if (sv) {
      const cardEl = sv.closest(".pcard"), text = cardEl.querySelector("[data-fb]").value.trim(), name = myName(cardEl);
      if (!name) { cardEl.querySelector("[data-name]").focus(); C.toast("Add your name first"); return; }
      if (!text) { cardEl.querySelector("[data-fb]").focus(); return; }
      add({ post: cardEl.dataset.id, kind: "comment", name, text });
      cardEl.querySelector("[data-fb]").value = ""; saveDraft(cardEl.dataset.id, ""); refreshReviews(); C.toast("Feedback stored, confirming with the shared sheet…"); return;
    }
    const cc = e.target.closest("[data-copyc]");
    if (cc) {
      const p = S.posts.find((x) => x.key === cc.closest(".pcard").dataset.id);
      copyText(p.team_comments[+cc.dataset.copyc].text).then(() => { cc.dataset.label = cc.dataset.label || cc.textContent; cc.textContent = "✓ Copied"; cc.classList.add("done"); clearTimeout(cc._t); cc._t = setTimeout(() => { cc.textContent = cc.dataset.label; cc.classList.remove("done"); }, 1800); C.toast("Comment copied"); }, () => C.toast("Copy blocked by the browser. Select the text instead."));
      return;
    }
    const cm = e.target.closest("[data-copym]");
    if (cm) {
      const p = S.posts.find((x) => x.key === cm.closest(".pcard").dataset.id), k = cm.dataset.copym;
      const val = k === "url" ? p.resource.url : dmText(p, k);
      copyText(val).then(() => {
        C.toast(k === "url" ? "Resource link copied" : k === "email" && val.includes("[POST LINK]") ? "Email copied. It still says [POST LINK]: paste the live post link above first" : "Copied");
        cm.dataset.label = cm.dataset.label || cm.textContent; cm.textContent = "✓ Copied"; cm.classList.add("done");
        clearTimeout(cm._t); cm._t = setTimeout(() => { cm.textContent = cm.dataset.label; cm.classList.remove("done"); }, 1800);
      }, () => C.toast("Copy blocked by the browser. Select the text instead."));
      return;
    }
    const ct = e.target.closest("[data-copyt]");
    if (ct) {
      const p = S.posts.find((x) => x.key === ct.closest(".pcard").dataset.id), what = ct.dataset.copyt === "text" ? "Post copy" : "First comment";
      const val = ct.dataset.copyt === "text" ? [p.text, ...(p.thread || [])].join("\n\n") : p[ct.dataset.copyt];
      const tags = (S.mentions || []).some((m) => (val || "").includes("@" + m));
      copyText(val || "").then(() => {
        C.toast(tags ? `${what} copied. When pasting, re-type each @ tag and pick the company page so it becomes a tag` : `${what} copied`);
        ct.dataset.label = ct.dataset.label || ct.textContent; ct.textContent = "✓ Copied"; ct.classList.add("done");
        clearTimeout(ct._t); ct._t = setTimeout(() => { ct.textContent = ct.dataset.label; ct.classList.remove("done"); }, 1800);
      }, () => C.toast("Copy blocked by the browser. Select the text in the post instead."));
      return;
    }
    const f = e.target.closest("[data-filter]");
    if (f) { f.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === f)); filter = f.dataset.filter; applyFilter(); return; }
    const poll = e.target.closest(".li-poll-o"); if (poll) { poll.parentElement.querySelectorAll(".li-poll-o").forEach((b) => b.classList.toggle("voted", b === poll)); return; }
    if (e.target.id === "loadShared") { const n = merge(window.__shared.ev || []); saveEv(); (window.__shared.ev || []).forEach(push); hideBanner(); refreshReviews(); C.toast(n + " shared items loaded"); return; }
    if (e.target.id === "ignoreShared") { hideBanner(); return; }
  });
  /* a link ending in #r=<base64> carries another reviewer's approvals and feedback: offer to load them */
  function hideBanner() { const b = document.getElementById("banner"); b.hidden = true; history.replaceState(null, "", location.pathname + location.search); }
  function sharedBanner() {
    const m = HASH.match(/#r=([\w-]+)/); if (!m) return;
    try {
      const sh = dec(m[1]); window.__shared = sh; const ev = sh.ev || [];
      const a = ev.filter((x) => x.kind === "approve").length, f = ev.filter((x) => x.kind === "comment").length;
      const b = document.getElementById("banner"); b.hidden = false;
      b.innerHTML = `<span>This link carries a shared review from ${esc(fmtT(sh.at))}: <b>${a}</b> approvals and <b>${f}</b> feedback notes.</span><button class="btn" id="loadShared">Load into my view</button><button class="btn ghost" id="ignoreShared">Ignore</button>`;
    } catch { /* bad hash */ }
  }
  /* three phones per row by default */
  let fit3 = true;
  function fit() {
    if (!fit3) return;
    const main = document.getElementById("main"); if (!main) return;
    const s = Math.max(0.5, Math.min(1, (main.clientWidth - 52 - 56) / (3 * 417)));
    document.documentElement.style.setProperty("--s", s.toFixed(3));
  }
  window.addEventListener("resize", fit);
  document.addEventListener("click", (e) => {
    if (e.target.closest('.seg button[data-set="scale"]')) { fit3 = false; document.getElementById("fit3").classList.remove("on"); }
    if (e.target.id === "fit3") { fit3 = true; e.target.classList.add("on"); document.querySelectorAll('.seg button[data-set="scale"]').forEach((b) => b.classList.remove("on")); fit(); }
  });
  document.addEventListener("DOMContentLoaded", () => { sharedBanner(); render(); fit(); syncBadge(); pull(); });
})();
