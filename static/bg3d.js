/* Perov AI 3D background: evenly spread glossy spheres and slowly turning molecule clusters in purple and yellow,
   covering the whole page in both light and dark theme. Plain canvas, no library.
   Include once per app page:  <script src="bg3d.js" defer></script>
   Pauses when the tab is hidden; draws one still frame if the visitor prefers reduced motion.
   Tune the look in CONFIG. */
(function () {
  "use strict";
  var CONFIG = {
    cols: 5, rows: 4,     // one sphere per grid cell on desktop (phones use 3 x 5), so the page is covered evenly
    clusters: 3,          // molecule clusters on desktop (2 on phones)
    dust: 60,             // tiny twinkling points
    speed: 1,             // 0.5 slower, 2 faster
    parallax: 1           // 0 turns the pointer / tilt / scroll depth effect off
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

  var cv, g, W = 0, H = 0, dpr = 1, unit = 800, small = false, light = false;
  var items = [], dust = [], mx = 0, my = 0, px = 0, py = 0, sy = 0, running = false, last = 0, t0 = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick() { return PAL[KEYS[(Math.random() * KEYS.length) | 0]]; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function build() {
    var cols = small ? 3 : CONFIG.cols, rows = small ? 5 : CONFIG.rows, nc = small ? 2 : CONFIG.clusters, i, j, k, c, r;
    items = []; dust = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {           // one sphere per cell, jittered: even coverage, no clumps
      var d = rnd(0.4, 1);
      items.push({ kind: 0, u: (c + rnd(0.15, 0.85)) / cols, v: (r + rnd(0.15, 0.85)) / rows, d: d, r: rnd(0.034, 0.07),
        pal: pick(), ph: rnd(0, 6.28), rate: rnd(0.006, 0.016), sw: rnd(0.4, 0.9), a: rnd(0.55, 0.85) });
    }
    for (i = 0; i < nc; i++) {                                         // clusters sit near the left / right edges
      var n = 7 + ((Math.random() * 3) | 0), pts = [{ x: 0, y: 0, z: 0, r: 0.05 }], col = i % 2 ? PAL.yellow : PAL.purple;
      for (j = 0; j < n; j++) {
        var uu = (j + 0.5) / n, a = Math.acos(1 - 2 * uu), b = j * 2.399963;
        pts.push({ x: Math.sin(a) * Math.cos(b), y: Math.cos(a), z: Math.sin(a) * Math.sin(b), r: rnd(0.024, 0.034) });
      }
      var edges = [];
      for (j = 0; j < pts.length; j++) for (k = j + 1; k < pts.length; k++)
        if (j === 0 || Math.hypot(pts[j].x - pts[k].x, pts[j].y - pts[k].y, pts[j].z - pts[k].z) < 1.0) edges.push([j, k]);
      items.push({ kind: 1, u: i % 2 ? rnd(0.84, 0.95) : rnd(0.05, 0.16), v: (i + 0.5) / nc * 0.8 + rnd(0.05, 0.15), d: rnd(0.7, 0.95),
        R: rnd(0.085, 0.12), pts: pts, edges: edges, ry: rnd(0, 6.28), rx: rnd(0, 6.28), wy: rnd(0.14, 0.26) * (i % 2 ? -1 : 1), wx: rnd(0.05, 0.12), pal: col, ph: rnd(0, 6.28), rate: rnd(0.004, 0.008), sw: rnd(0.4, 0.8) });
    }
    for (i = 0; i < CONFIG.dust * (small ? 0.6 : 1); i++) dust.push({ u: Math.random(), v: Math.random(), d: rnd(0.3, 1), ph: rnd(0, 6.28), y: Math.random() > 0.7 });
    items.sort(function (a, b) { return a.d - b.d; });                  // far to near
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2);
    var rc = cv.getBoundingClientRect(); W = rc.width || window.innerWidth; H = rc.height || window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    unit = Math.min(W, H) * 0.55 + Math.max(W, H) * 0.25;
    var s = window.innerWidth < 700; if (s !== small || !items.length) { small = s; build(); }
    if (calm) draw(2.4);
  }

  function ball(x, y, r, pal, alpha, halo) {
    if (r < 0.6) return;
    var gr, am = light ? 0.9 : 1;
    if (halo) {
      gr = g.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
      gr.addColorStop(0, rgba(pal[1], (light ? 0.14 : 0.2) * alpha)); gr.addColorStop(1, rgba(pal[1], 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.4, 0, 6.2832); g.fill();
    }
    gr = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r);
    gr.addColorStop(0, rgba(pal[0], alpha * am)); gr.addColorStop(0.22, rgba(pal[1], alpha * am));
    gr.addColorStop(0.62, rgba(pal[2], alpha * 0.92 * am)); gr.addColorStop(1, rgba(pal[3], alpha * 0.8 * am));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    if (r > 6) {
      g.strokeStyle = rgba(pal[1], 0.35 * alpha); g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath(); g.arc(x, y, r * 0.93, 0.15, 1.35); g.stroke();
      g.fillStyle = "rgba(255,255,255," + 0.55 * alpha + ")";
      g.beginPath(); g.ellipse(x - r * 0.36, y - r * 0.46, r * 0.2, r * 0.11, -0.7, 0, 6.2832); g.fill();
    }
  }

  // screen position of an item: grid position, slow upward drift, sway, parallax (nearer moves more)
  function where(o, t) {
    var k = CONFIG.parallax, vv = (((o.v - t * o.rate * CONFIG.speed - sy * 0.00006 * o.d) % 1.2) + 1.2) % 1.2 - 0.1;
    return { x: o.u * W + Math.sin(t * o.sw * 0.6 + o.ph) * 14 * o.d - px * 46 * o.d * k, y: vv * H + Math.cos(t * 0.35 + o.ph) * 8 * o.d - py * 34 * o.d * k };
  }

  function drawSphere(o, t) {
    var p = where(o, t), r = o.r * unit * (0.55 + 0.45 * o.d), al = o.a * (0.5 + 0.5 * o.d);
    if (p.y < -r * 2.5 || p.y > H + r * 2.5) return;
    ball(p.x, p.y, r, o.pal, al, true);
  }

  function drawCluster(o, t) {
    var p = where(o, t), R = o.R * unit, cy = Math.cos(o.ry + t * o.wy), sy_ = Math.sin(o.ry + t * o.wy), cx = Math.cos(o.rx + t * o.wx), sx = Math.sin(o.rx + t * o.wx);
    var al = 0.5 + 0.5 * o.d, i;
    var out = o.pts.map(function (q) {
      var x = q.x, y = q.y, z = q.z, x1 = x * cy + z * sy_, z1 = -x * sy_ + z * cy, y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx, f = 1 / (1 - 0.3 * z2);
      return { x: p.x + x1 * R * f, y: p.y + y1 * R * f, z: z2, r: q.r * unit * f * 1.05 };
    });
    g.lineCap = "round";
    o.edges.forEach(function (e) {
      var a = out[e[0]], b = out[e[1]];
      g.strokeStyle = rgba(o.pal[light ? 2 : 1], (light ? 0.5 : 0.45) * al); g.lineWidth = Math.max(0.7, unit * 0.0016);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    });
    var order = out.map(function (q, n) { return n; }).sort(function (a, b) { return out[a].z - out[b].z; });
    for (i = 0; i < order.length; i++) { var q = out[order[i]]; ball(q.x, q.y, q.r, o.pal, al, true); }
  }

  function drawDust(t) {
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i], a = 0.15 + 0.3 * Math.abs(Math.sin(t * 0.6 + d.ph));
      g.fillStyle = d.y ? "rgba(255,190,60," + a + ")" : (light ? "rgba(124,77,255," + a * 0.8 + ")" : "rgba(196,170,255," + a + ")");
      g.beginPath(); g.arc(d.u * W - px * 18 * d.d, d.v * H - py * 14 * d.d, 0.6 + d.d * 0.9, 0, 6.2832); g.fill();
    }
  }

  function theme() {
    var l = document.documentElement.getAttribute("data-theme") !== "dark";
    if (l !== light || cv.className === "" && l) { light = l; cv.className = l ? "lt" : ""; }
  }
  function draw(t) {
    theme(); g.clearRect(0, 0, W, H);
    px += (mx - px) * 0.05; py += (my - py) * 0.05;
    drawDust(t);
    for (var i = 0; i < items.length; i++) (items[i].kind ? drawCluster : drawSphere)(items[i], t);
  }
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - last < 28) return; last = now;
    draw((now - t0) / 1000);
  }
  function start() { if (running || calm) return; running = true; last = 0; requestAnimationFrame(frame); }

  function init() {
    cv = document.createElement("canvas"); cv.id = "bg3d"; cv.setAttribute("aria-hidden", "true");
    document.body.insertBefore(cv, document.body.firstChild); g = cv.getContext("2d"); t0 = performance.now();
    small = window.innerWidth < 700; resize();
    window.addEventListener("resize", resize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
    if (CONFIG.parallax) {
      window.addEventListener("pointermove", function (e) { mx = e.clientX / W - 0.5; my = e.clientY / H - 0.5; }, { passive: true });
      window.addEventListener("scroll", function () { sy = window.scrollY || 0; }, { passive: true });
      window.addEventListener("deviceorientation", function (e) {
        if (e.gamma == null) return; mx = Math.max(-0.5, Math.min(0.5, e.gamma / 60)); my = Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 80));
      }, { passive: true });
    }
    if (window.MutationObserver) new MutationObserver(function () { if (calm) draw(2.4); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", function () { running = false; if (!document.hidden) start(); });
    start();
  }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
