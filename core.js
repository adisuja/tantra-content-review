/* core.js: shared helpers for the content review studio (phone frame, rich text, lightbox, toast).
   Exposes window.CORE. data.js (written by kits/content/publish.py) sets window.STUDIO before app.js runs. */
(function () {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const URL_RE = /(https?:\/\/[^\s<]+|\b(?:[a-z0-9-]+\.)+(?:com|ai|io|net|org|co|uk|app|dev)\b(?:\/[^\s<]*)?)/gi;

  function linkify(html, cls) {
    return html.replace(URL_RE, (m) => {
      let trail = "";
      const t = m.match(/[.,;:!?)]+$/);
      if (t) { trail = t[0]; m = m.slice(0, -trail.length); }
      if (!m) return m + trail;
      const href = /^https?:/i.test(m) ? m : "https://" + m;
      return `<a class="${cls || "lnk"}" href="${esc(href)}" target="_blank" rel="noopener">${esc(m)}</a>${trail}`;
    });
  }
  /* "@Name" for every page in STUDIO.mentions renders as a tag (bold blue name, no @), the way LinkedIn shows a
     tagged company page. A bare company name with a domain ending stays a link, because LinkedIn turns it into one. */
  const mentionRe = () => {
    const names = ((window.STUDIO || {}).mentions || []).filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return names.length ? new RegExp(`@(${names.join("|")})`, "g") : null;
  };
  function rich(text, cls) {
    const re = mentionRe();
    let html = esc(text);
    if (re) {
      html = html.replace(re, "\u0001$1\u0002").replace(/\u0001[^\u0002]*\u0002/g, (m) => m.replace(/\./g, "\u0003"));
    }
    html = linkify(html, cls);
    return html.replace(/\u0001([^\u0002]*)\u0002/g, (_, n) => `<span class="mention" title="Tag: company page">${n.replace(/\u0003/g, ".")}</span>`);
  }

  const I = {
    signal: '<svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="5" y="5.5" width="3" height="6.5" rx=".8"/><rect x="10" y="3" width="3" height="9" rx=".8"/><rect x="15" y="0" width="3" height="12" rx=".8"/></svg>',
    wifi: '<svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><path d="M8.5 11.6a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zM3.9 7.2a6.5 6.5 0 0 1 9.2 0l-1.4 1.4a4.5 4.5 0 0 0-6.4 0zM1 4.2a10.6 10.6 0 0 1 15 0l-1.4 1.4a8.6 8.6 0 0 0-12.2 0z"/></svg>',
    battery: '<svg width="28" height="13" viewBox="0 0 28 13"><rect x=".6" y=".6" width="24" height="11.8" rx="3.4" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1.2"/><rect x="2.2" y="2.2" width="20.8" height="8.6" rx="2" fill="currentColor"/><path d="M26.2 4.4v4.2a2.2 2.2 0 0 0 0-4.2z" fill="currentColor" fill-opacity=".4"/></svg>'
  };
  const statusBar = (dark) => `<div class="sb${dark ? " dark" : ""}"><span class="sb-time">9:41</span><span class="sb-icons">${I.signal}${I.wifi}${I.battery}</span></div>`;
  const phone = (inner, cls) => `<div class="phone-wrap"><div class="phone"><div class="screen ${cls || ""}">${inner}</div><div class="island"></div></div></div>`;
  const home = (dark) => `<div class="home${dark ? " dark" : ""}"></div>`;

  /* lightbox: any element with data-lb="<src>" opens full size; data-lb-group siblings in the same card form a gallery */
  const LB = { items: [], i: 0, zoom: false };
  function lbEl() {
    let el = document.getElementById("lightbox");
    if (el) return el;
    el = document.createElement("div"); el.id = "lightbox"; el.className = "lb";
    el.innerHTML = `<button class="lb-x" title="Close (Esc)">×</button><button class="lb-nav lb-prev" title="Previous">‹</button><div class="lb-stage"><img alt=""></div><button class="lb-nav lb-next" title="Next">›</button><div class="lb-cap"></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      if (e.target.closest(".lb-x") || e.target === el) return lbClose();
      if (e.target.closest(".lb-prev")) return lbShow(LB.i - 1);
      if (e.target.closest(".lb-next")) return lbShow(LB.i + 1);
      if (e.target.tagName === "IMG") { LB.zoom = !LB.zoom; el.classList.toggle("zoom", LB.zoom); }
    });
    document.addEventListener("keydown", (e) => { if (!el.classList.contains("open")) return; if (e.key === "Escape") lbClose(); if (e.key === "ArrowLeft") lbShow(LB.i - 1); if (e.key === "ArrowRight") lbShow(LB.i + 1); });
    return el;
  }
  function lbShow(i) {
    const el = lbEl(); if (!LB.items.length) return;
    LB.i = (i + LB.items.length) % LB.items.length; LB.zoom = false; el.classList.remove("zoom");
    const it = LB.items[LB.i];
    el.querySelector("img").src = it.src;
    el.querySelector(".lb-cap").textContent = `${it.caption || ""}${LB.items.length > 1 ? `  ·  ${LB.i + 1} / ${LB.items.length}` : ""}`;
    el.querySelectorAll(".lb-nav").forEach((b) => (b.style.display = LB.items.length > 1 ? "" : "none"));
    el.classList.add("open");
  }
  function lbClose() { lbEl().classList.remove("open", "zoom"); }
  function lightbox(items, i) { LB.items = items; lbShow(i || 0); }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-lb]");
    if (!t) return;
    e.preventDefault();
    const scope = t.closest(".card") || document, group = t.dataset.lbGroup;
    const els = group ? [...scope.querySelectorAll(`[data-lb][data-lb-group="${CSS.escape(group)}"]`)] : [t];
    lightbox(els.map((el) => ({ src: el.dataset.lb, caption: el.dataset.lbCaption || el.getAttribute("alt") || "" })), Math.max(0, els.indexOf(t)));
  });

  let tt;
  function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2200); }

  /* phone size buttons (100 / 85 / 70 %) */
  document.addEventListener("click", (e) => {
    const seg = e.target.closest(".seg button[data-set='scale']");
    if (!seg) return;
    seg.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === seg));
    const s = window.innerWidth < 900 ? Math.min(+seg.dataset.val, (window.innerWidth - 32) / 417) : +seg.dataset.val;
    document.documentElement.style.setProperty("--s", s.toFixed(3));
  });

  window.CORE = { esc, rich, linkify, statusBar, phone, home, toast, lightbox, URL_RE };
})();
