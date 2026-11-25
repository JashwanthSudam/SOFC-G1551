/* Perov AI background: a still, soft purple and yellow scene (glossy bubbles, sparkles, tiny molecules)
   covering the whole page in light and dark theme. No animation: it is drawn once and again only when the
   window is resized or the theme changes. Plain canvas, no library.
   Include once per app page:  <script src="bg3d.js" defer></script>   Tune the look in CONFIG. */
(function () {
  "use strict";
  var CONFIG = {
    cols: 5, rows: 4,     // one sphere per grid cell on desktop (phones use 3 x 5), so the page is covered evenly
    clusters: 3,          // molecule clusters on desktop (2 on phones)
    dust: 60,             // tiny dots
    sparkles: 16,         // little four-point stars
    seed: 7               // change the number for a different (but still fixed) layout
  };
  var PAL = {              // [highlight, light, base, shadow]
    purple: [[238, 229, 255], [178, 144, 255], [114, 68, 232], [44, 20, 118]],
    violet: [[250, 234, 255], [216, 156, 255], [152, 74, 226], [60, 22, 124]],
    yellow: [[255, 251, 220], [255, 217, 98], [255, 170, 30], [160, 86, 10]]
  };
  var KEYS = ["purple", "violet", "purple", "yellow", "yellow"];
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var css = [
    ":root{background:#07031A}:root:not([data-theme=\"dark\"]){background:#F3EEFF}",
    "body{background:transparent!important}",
    "#bg3d{position:fixed;left:0;top:0;width:100%;height:100%;height:100lvh;z-index:-1;pointer-events:none;",
    "background:radial-gradient(70% 55% at 14% 0%,rgba(124,77,255,.55),transparent 62%),radial-gradient(60% 50% at 100% 35%,rgba(168,85,247,.32),transparent 62%),",
    "radial-gradient(55% 40% at 80% 108%,rgba(255,184,40,.26),transparent 62%),linear-gradient(180deg,#120733,#0A0424 55%,#07031A)}",
    "#bg3d.lt{background:radial-gradient(70% 55% at 14% 0%,rgba(139,108,255,.30),transparent 62%),radial-gradient(60% 50% at 100% 35%,rgba(192,132,252,.22),transparent 62%),",
    "radial-gradient(55% 40% at 80% 108%,rgba(255,190,60,.28),transparent 62%),linear-gradient(180deg,#F8F5FF,#EFE9FF 60%,#F7F1FF)}",
    /* glass panels, both themes */
    ".panel,.choice,.role-card,.pcard{backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}",
    ":root:not([data-theme=\"dark\"]) .panel,:root:not([data-theme=\"dark\"]) .choice,:root:not([data-theme=\"dark\"]) .role-card,:root:not([data-theme=\"dark\"]) .pcard{",
    "background:rgba(255,255,255,.8)!important;border-color:rgba(139,108,255,.25)!important;box-shadow:0 18px 44px -26px rgba(70,40,160,.35)}",
    ":root:not([data-theme=\"dark\"]) header.top{background:rgba(247,243,255,.75)!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}",
    ":root[data-theme=\"dark\"]{--input-bg:rgba(16,7,46,.75);--soft:rgba(40,22,92,.5);--glaze-soft:#2B1B5E}",
    ":root[data-theme=\"dark\"] .panel,:root[data-theme=\"dark\"] .choice,:root[data-theme=\"dark\"] .role-card,:root[data-theme=\"dark\"] .pcard{",
    "background:rgba(28,14,66,.58)!important;border-color:rgba(176,140,255,.3)!important;box-shadow:0 24px 60px -30px #000,inset 0 1px 0 rgba(255,255,255,.07)}",
    ":root[data-theme=\"dark\"] input,:root[data-theme=\"dark\"] select,:root[data-theme=\"dark\"] textarea{background:rgba(16,7,46,.75)!important;border-color:rgba(176,140,255,.3)!important}",
    ":root[data-theme=\"dark\"] header.top{background:rgba(14,6,40,.6)!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}",
    ".intro,.hero-art{background:radial-gradient(circle at 88% 100%,rgba(255,196,60,.34),transparent 48%),linear-gradient(160deg,#5B33D6 0%,#341A8A 55%,#1B0B4E 100%)!important}"
  ].join("");
  var st = document.createElement("style"); st.id = "bg3d-style"; st.textContent = css; document.head.appendChild(st);

  var cv, g, W = 0, H = 0, dpr = 1, unit = 800, small = false, light = false, rt = 0;
  var rs = 1;
  function rand() { rs |= 0; rs = rs + 0x6D2B79F5 | 0; var t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function rnd(a, b) { return a + rand() * (b - a); }
  function pick() { return PAL[KEYS[(rand() * KEYS.length) | 0]]; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function ball(x, y, r, pal, alpha, halo) {
    if (r < 0.6) return;
    var gr;
    if (halo) {
      gr = g.createRadialGradient(x, y, r * 0.8, x, y, r * 2.2);
      gr.addColorStop(0, rgba(pal[1], (light ? 0.14 : 0.2) * alpha)); gr.addColorStop(1, rgba(pal[1], 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.2, 0, 6.2832); g.fill();
    }
    gr = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r);
    gr.addColorStop(0, rgba(pal[0], alpha)); gr.addColorStop(0.25, rgba(pal[1], alpha));
    gr.addColorStop(0.65, rgba(pal[2], alpha * 0.92)); gr.addColorStop(1, rgba(pal[3], alpha * 0.75));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    if (r > 6) {
      g.strokeStyle = rgba(pal[1], 0.35 * alpha); g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath(); g.arc(x, y, r * 0.93, 0.15, 1.35); g.stroke();
      g.fillStyle = "rgba(255,255,255," + 0.6 * alpha + ")";
      g.beginPath(); g.ellipse(x - r * 0.36, y - r * 0.46, r * 0.2, r * 0.11, -0.7, 0, 6.2832); g.fill();
    }
  }

  function sparkle(x, y, r, a) {   // soft four-point star with a glow
    var gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
    gr.addColorStop(0, "rgba(255,205,70," + 0.35 * a + ")"); gr.addColorStop(1, "rgba(255,205,70,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.2, 0, 6.2832); g.fill();
    g.fillStyle = "rgba(" + (light ? "255,186,40" : "255,224,120") + "," + a + ")";
    g.beginPath(); g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
  }

  function molecule(cx, cy, R, pal, al) {   // tiny ball-and-stick cluster
    var n = 7, pts = [{ x: 0, y: 0, z: 0, r: 0.05 }], i, j, ry = rnd(0.3, 2.5), rx = rnd(0.3, 2.5);
    for (i = 0; i < n; i++) { var u = (i + 0.5) / n, a = Math.acos(1 - 2 * u), b = i * 2.399963; pts.push({ x: Math.sin(a) * Math.cos(b), y: Math.cos(a), z: Math.sin(a) * Math.sin(b), r: rnd(0.026, 0.034) }); }
    var cyy = Math.cos(ry), syy = Math.sin(ry), cxx = Math.cos(rx), sxx = Math.sin(rx);
    var out = pts.map(function (q) {
      var x1 = q.x * cyy + q.z * syy, z1 = -q.x * syy + q.z * cyy, y1 = q.y * cxx - z1 * sxx, z2 = q.y * sxx + z1 * cxx, f = 1 / (1 - 0.3 * z2);
      return { x: cx + x1 * R * f, y: cy + y1 * R * f, z: z2, r: q.r * unit * f * 1.05 };
    });
    g.lineCap = "round"; g.lineWidth = Math.max(0.8, unit * 0.0016); g.strokeStyle = rgba(pal[light ? 2 : 1], 0.5 * al);
    for (i = 0; i < out.length; i++) for (j = i + 1; j < out.length; j++)
      if (i === 0 || Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z) < 1.0) { g.beginPath(); g.moveTo(out[i].x, out[i].y); g.lineTo(out[j].x, out[j].y); g.stroke(); }
    out.map(function (q, n) { return n; }).sort(function (a, b) { return out[a].z - out[b].z; }).forEach(function (n) { ball(out[n].x, out[n].y, out[n].r, pal, al, true); });
  }

  function draw() {
    light = document.documentElement.getAttribute("data-theme") !== "dark"; cv.className = light ? "lt" : "";
    var cols = small ? 3 : CONFIG.cols, rows = small ? 5 : CONFIG.rows, nc = small ? 2 : CONFIG.clusters, i, r, c, list = [];
    rs = CONFIG.seed; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    for (i = 0; i < CONFIG.dust * (small ? 0.6 : 1); i++) {   // tiny dots
      g.fillStyle = rand() > 0.7 ? "rgba(255,190,60,0.45)" : (light ? "rgba(124,77,255,0.3)" : "rgba(196,170,255,0.45)");
      g.beginPath(); g.arc(rand() * W, rand() * H, rnd(0.7, 1.6), 0, 6.2832); g.fill();
    }
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {   // one bubble per grid cell: even coverage
      var d = rnd(0.45, 1);
      list.push({ x: (c + rnd(0.18, 0.82)) / cols * W, y: (r + rnd(0.18, 0.82)) / rows * H, r: rnd(0.03, 0.062) * unit * (0.6 + 0.4 * d), pal: pick(), a: rnd(0.55, 0.8) * (0.55 + 0.45 * d), d: d });
    }
    list.sort(function (a, b) { return a.d - b.d; }).forEach(function (o) { ball(o.x, o.y, o.r, o.pal, o.a, true); });
    for (i = 0; i < nc; i++) molecule(i % 2 ? W * rnd(0.87, 0.94) : W * rnd(0.06, 0.13), H * ((i + 0.5) / nc * 0.8 + rnd(0.05, 0.15)), unit * rnd(0.09, 0.115), i % 2 ? PAL.yellow : PAL.purple, 0.9);
    for (i = 0; i < CONFIG.sparkles * (small ? 0.6 : 1); i++) sparkle(rand() * W, rand() * H, unit * rnd(0.011, 0.026), rnd(0.55, 0.95));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2);
    var rc = cv.getBoundingClientRect(); W = rc.width || window.innerWidth; H = rc.height || window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    unit = Math.min(W, H) * 0.55 + Math.max(W, H) * 0.25; small = window.innerWidth < 700;
    draw();
  }

  function init() {
    cv = document.createElement("canvas"); cv.id = "bg3d"; cv.setAttribute("aria-hidden", "true");
    document.body.insertBefore(cv, document.body.firstChild); g = cv.getContext("2d"); resize();
    var again = function () { clearTimeout(rt); rt = setTimeout(resize, 120); };
    window.addEventListener("resize", again);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", again);
    if (window.MutationObserver) new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
