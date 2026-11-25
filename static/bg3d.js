/* Perov AI background: a calm, still scene like the reference design. Soft glossy bubbles of different sizes and many
   tiny perovskite unit-cell icons (cube with ion nodes) scattered over a deep violet page, in purple and yellow.
   No animation: drawn once, and again only on resize or when the theme changes. Plain canvas, no library.
   Include once per app page:  <script src="bg3d.js" defer></script>   Tune the look in CONFIG. */
(function () {
  "use strict";
  var CONFIG = {
    bubbleCols: 6, bubbleRows: 4,   // bubble grid on desktop (phones use 3 x 6); about half of the cells get a bubble
    cellCols: 9, cellRows: 6,       // perovskite icon grid on desktop (phones use 4 x 9); about 60% of the cells get an icon
    seed: 11                        // change the number for a different (but still fixed) layout
  };
  var DARK = {   // [highlight, light, base, shadow]  (deep, calm tones)
    purple: [[206, 190, 255], [118, 86, 214], [62, 36, 138], [22, 10, 64]],
    violet: [[226, 196, 255], [146, 98, 218], [84, 40, 152], [30, 12, 70]],
    amber:  [[255, 236, 176], [222, 158, 46], [150, 90, 16], [58, 28, 6]]
  };
  var LIGHT = {
    purple: [[244, 238, 255], [180, 150, 255], [122, 84, 232], [62, 34, 150]],
    violet: [[252, 240, 255], [220, 168, 255], [160, 90, 228], [78, 34, 140]],
    amber:  [[255, 252, 228], [255, 220, 110], [255, 172, 34], [170, 96, 14]]
  };
  var KEYS = ["purple", "purple", "violet", "purple", "amber"];
  var css = [
    ":root{background:#08041E}:root:not([data-theme=\"dark\"]){background:#F4F0FF}",
    "body{background:transparent!important}",
    "#bg3d{position:fixed;left:0;top:0;width:100%;height:100%;height:100lvh;z-index:-1;pointer-events:none;",
    "background:radial-gradient(90% 45% at 50% 0%,rgba(96,56,214,.24),transparent 70%),linear-gradient(180deg,#0C0630,#09052A 60%,#08041E)}",
    "#bg3d.lt{background:radial-gradient(90% 45% at 50% 0%,rgba(139,108,255,.2),transparent 70%),linear-gradient(180deg,#F9F6FF,#F0EAFF 60%,#F7F2FF)}",
    ".panel,.choice,.role-card,.pcard{backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}",
    ":root:not([data-theme=\"dark\"]) .panel,:root:not([data-theme=\"dark\"]) .choice,:root:not([data-theme=\"dark\"]) .role-card,:root:not([data-theme=\"dark\"]) .pcard{",
    "background:rgba(255,255,255,.84)!important;border-color:rgba(139,108,255,.25)!important;box-shadow:0 18px 44px -26px rgba(70,40,160,.35)}",
    ":root:not([data-theme=\"dark\"]) header.top{background:rgba(247,243,255,.78)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
    ":root[data-theme=\"dark\"]{--input-bg:rgba(14,7,44,.8);--soft:rgba(34,18,84,.5);--glaze-soft:#2B1B5E}",
    ":root[data-theme=\"dark\"] .panel,:root[data-theme=\"dark\"] .choice,:root[data-theme=\"dark\"] .role-card,:root[data-theme=\"dark\"] .pcard{",
    "background:rgba(18,10,54,.72)!important;border-color:rgba(255,184,64,.5)!important;box-shadow:0 24px 60px -30px #000}",
    ":root[data-theme=\"dark\"] input,:root[data-theme=\"dark\"] select,:root[data-theme=\"dark\"] textarea{background:rgba(14,7,44,.8)!important;border-color:rgba(150,120,240,.3)!important}",
    ":root[data-theme=\"dark\"] header.top{background:rgba(10,5,34,.78)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
    ".intro,.hero-art{background:radial-gradient(circle at 88% 100%,rgba(255,196,60,.3),transparent 48%),linear-gradient(160deg,#5B33D6 0%,#3A1D96 55%,#1F0E58 100%)!important}"
  ].join("");
  var st = document.createElement("style"); st.id = "bg3d-style"; st.textContent = css; document.head.appendChild(st);

  var cv, g, W = 0, H = 0, dpr = 1, unit = 800, small = false, light = false, rt = 0, rs = 1, PAL = DARK;
  function rand() { rs |= 0; rs = rs + 0x6D2B79F5 | 0; var t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function rnd(a, b) { return a + rand() * (b - a); }
  function pick() { return PAL[KEYS[(rand() * KEYS.length) | 0]]; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function bubble(x, y, r, pal, a) {    // soft glossy sphere: shaded body, rim light, small highlight
    var gr = g.createRadialGradient(x - r * 0.36, y - r * 0.4, r * 0.06, x, y, r);
    gr.addColorStop(0, rgba(pal[0], a)); gr.addColorStop(0.28, rgba(pal[1], a)); gr.addColorStop(0.68, rgba(pal[2], a)); gr.addColorStop(1, rgba(pal[3], a));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    if (r > 7) {
      g.strokeStyle = rgba(pal[1], 0.4 * a); g.lineWidth = Math.max(1, r * 0.05);
      g.beginPath(); g.arc(x, y, r * 0.94, 0.2, 1.3); g.stroke();
      g.fillStyle = "rgba(255,255,255," + 0.5 * a + ")";
      g.beginPath(); g.ellipse(x - r * 0.36, y - r * 0.44, r * 0.2, r * 0.11, -0.7, 0, 6.2832); g.fill();
    }
  }

  function cell(cx, cy, R, a) {         // tiny perovskite unit cell: cube edges, corner ions, centre ion, a few face ions
    var ry = rnd(0.4, 1.2), rx = rnd(0.35, 0.9), cyy = Math.cos(ry), syy = Math.sin(ry), cxx = Math.cos(rx), sxx = Math.sin(rx), i, j;
    function P(x, y, z) { var x1 = x * cyy + z * syy, z1 = -x * syy + z * cyy, y1 = y * cxx - z1 * sxx, z2 = y * sxx + z1 * cxx, f = 1 / (1 - 0.25 * z2); return { x: cx + x1 * R * f, y: cy + y1 * R * f, z: z2, f: f }; }
    var v = []; for (i = 0; i < 8; i++) v.push(P(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5));
    var edge = light ? "rgba(110,70,220," + 0.5 * a + ")" : "rgba(170,140,255," + 0.55 * a + ")";
    g.strokeStyle = edge; g.lineWidth = Math.max(0.7, R * 0.045); g.lineCap = "round"; g.beginPath();
    for (i = 0; i < 8; i++) for (j = i + 1; j < 8; j++) { var d = (i ^ j); if (d === 1 || d === 2 || d === 4) { g.moveTo(v[i].x, v[i].y); g.lineTo(v[j].x, v[j].y); } }
    g.stroke();
    var A = light ? [150, 110, 255] : [190, 165, 255], B = light ? [255, 176, 40] : [255, 205, 90], O = light ? [255, 120, 160] : [150, 205, 255];
    function node(p, col, r, al) { g.fillStyle = "rgba(" + col[0] + "," + col[1] + "," + col[2] + "," + al + ")"; g.beginPath(); g.arc(p.x, p.y, Math.max(0.8, r * p.f), 0, 6.2832); g.fill(); }
    for (i = 0; i < 8; i++) node(v[i], A, R * 0.1, 0.8 * a);
    node(P(0, 0, 0), B, R * 0.17, 0.95 * a);
    [[0, 0, 0.5], [0.5, 0, 0], [0, 0.5, 0]].forEach(function (q) { node(P(q[0], q[1], q[2]), O, R * 0.075, 0.65 * a); });
  }

  function draw() {
    light = document.documentElement.getAttribute("data-theme") !== "dark"; cv.className = light ? "lt" : ""; PAL = light ? LIGHT : DARK;
    var bc = small ? 3 : CONFIG.bubbleCols, br = small ? 6 : CONFIG.bubbleRows, cc = small ? 4 : CONFIG.cellCols, cr = small ? 9 : CONFIG.cellRows, r, c, list = [];
    rs = CONFIG.seed; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    for (r = 0; r < cr; r++) for (c = 0; c < cc; c++) {                      // icons first, bubbles sit in front
      if (rand() < 0.4) continue;
      cell((c + rnd(0.2, 0.8)) / cc * W, (r + rnd(0.2, 0.8)) / cr * H, unit * rnd(0.02, 0.036), light ? rnd(0.7, 1) : rnd(0.55, 0.9));
    }
    for (r = 0; r < br; r++) for (c = 0; c < bc; c++) {
      if (rand() < 0.38) continue;
      var big = rand() < 0.22;
      list.push({ x: (c + rnd(0.2, 0.8)) / bc * W, y: (r + rnd(0.2, 0.8)) / br * H, r: unit * (big ? rnd(0.04, 0.062) : rnd(0.012, 0.03)), pal: pick(), a: light ? rnd(0.5, 0.75) : rnd(0.6, 0.9) });
    }
    list.sort(function (a, b) { return a.r - b.r; }).forEach(function (o) { bubble(o.x, o.y, o.r, o.pal, o.a); });
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
