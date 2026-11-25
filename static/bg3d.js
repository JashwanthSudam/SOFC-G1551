/* Perov AI 3D background: floating glossy spheres and slowly turning molecule clusters in purple and yellow.
   Plain canvas, no library. Include once per page:  <script src="bg3d.js" defer></script>
   Shown on the dark theme and on the site pages (home, login). Pauses when the tab is hidden,
   draws one still frame if the visitor prefers reduced motion. Tune the look in the CONFIG block. */
(function () {
  "use strict";
  var CONFIG = {
    spheres: 26,          // floating spheres on desktop (about 60% of this on phones)
    clusters: 4,          // molecule clusters on desktop (2 on phones)
    dust: 70,             // tiny twinkling points
    speed: 1,             // 0.5 slower, 2 faster
    parallax: 1           // 0 turns the pointer / scroll depth effect off
  };
  // colour sets: [highlight, light, base, shadow] as r,g,b
  var PAL = {
    purple: [[236, 226, 255], [176, 140, 255], [112, 64, 232], [38, 16, 110]],
    violet: [[250, 232, 255], [214, 150, 255], [150, 70, 225], [55, 18, 118]],
    yellow: [[255, 250, 214], [255, 214, 90], [255, 168, 24], [150, 78, 8]]
  };
  var KEYS = ["purple", "purple", "violet", "yellow", "yellow"]; // more purple than yellow

  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var css = [
    "html{background:#07031A}",
    "#bg3d{position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:none;",
    "background:radial-gradient(70% 55% at 15% 0%,rgba(124,77,255,.55),transparent 62%),",
    "radial-gradient(60% 50% at 100% 35%,rgba(168,85,247,.32),transparent 62%),",
    "radial-gradient(55% 40% at 78% 108%,rgba(255,184,40,.26),transparent 62%),",
    "linear-gradient(180deg,#120733 0%,#0A0424 55%,#07031A 100%)}",
    ":root[data-theme=\"dark\"] #bg3d,body.site #bg3d{display:block}",
    ":root[data-theme=\"dark\"] body,body.site{background:transparent!important}",
    "body.site::before,body.site::after{display:none!important}",
    "body.site{--cyan:#B794FF;--violet:#A78BFA}",
    ":root[data-theme=\"dark\"] .panel,:root[data-theme=\"dark\"] .choice,:root[data-theme=\"dark\"] .role-card,",
    ":root[data-theme=\"dark\"] .pcard{background:rgba(28,14,66,.58)!important;border-color:rgba(176,140,255,.3)!important;",
    "backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 24px 60px -30px #000,inset 0 1px 0 rgba(255,255,255,.07)}",
    ":root[data-theme=\"dark\"]{--input-bg:rgba(16,7,46,.75);--soft:rgba(40,22,92,.5);--glaze-soft:#2B1B5E}",
    ":root[data-theme=\"dark\"] input,:root[data-theme=\"dark\"] select,:root[data-theme=\"dark\"] textarea{background:rgba(16,7,46,.75)!important;border-color:rgba(176,140,255,.3)!important}",
    ":root[data-theme=\"dark\"] header.top{background:rgba(14,6,40,.6)!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}",
    ":root[data-theme=\"dark\"] .intro,:root[data-theme=\"dark\"] .hero-art{background:radial-gradient(circle at 88% 100%,rgba(255,196,60,.34),transparent 48%),",
    "linear-gradient(160deg,#5B33D6 0%,#341A8A 55%,#1B0B4E 100%)!important}"
  ].join("");
  var st = document.createElement("style"); st.id = "bg3d-style"; st.textContent = css; document.head.appendChild(st);

  var cv, g, W = 0, H = 0, dpr = 1, F = 1, small = false, t0 = 0, last = 0;
  var spheres = [], clusters = [], dust = [];
  var mx = 0, my = 0, px = 0, py = 0, sy = 0, running = false;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick() { return PAL[KEYS[(Math.random() * KEYS.length) | 0]]; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function build() {
    small = W < 700;
    var ns = Math.round(CONFIG.spheres * (small ? 0.6 : 1)), nc = small ? Math.min(2, CONFIG.clusters) : CONFIG.clusters, i, j, k;
    spheres = []; clusters = []; dust = [];
    for (i = 0; i < ns; i++) {
      spheres.push({ x: rnd(-1.6, 1.6), y: rnd(-1.2, 1.2), z: rnd(0.55, 3.4), r: rnd(0.035, 0.11), pal: pick(),
        vy: rnd(0.012, 0.04), ph: rnd(0, 6.28), sw: rnd(0.02, 0.07), a: rnd(0.5, 0.85), kind: 0 });
    }
    for (i = 0; i < nc; i++) {
      var n = 7 + ((Math.random() * 4) | 0), pts = [{ x: 0, y: 0, z: 0, r: 0.045 }], c = pick();
      for (j = 0; j < n; j++) { // points spread on a sphere shell (golden spiral)
        var u = (j + 0.5) / n, a = Math.acos(1 - 2 * u), b = j * 2.399963;
        pts.push({ x: Math.sin(a) * Math.cos(b), y: Math.cos(a), z: Math.sin(a) * Math.sin(b), r: rnd(0.022, 0.034) });
      }
      var edges = [];
      for (j = 0; j < pts.length; j++) for (k = j + 1; k < pts.length; k++) {
        var d = Math.hypot(pts[j].x - pts[k].x, pts[j].y - pts[k].y, pts[j].z - pts[k].z);
        if ((j === 0 && k > 0) || d < 1.0) edges.push([j, k]);
      }
      clusters.push({ x: (i % 2 ? 1 : -1) * rnd(0.55, 1.5), y: rnd(-0.9, 0.9), z: rnd(1.1, 2.4), R: rnd(0.16, 0.26),
        pts: pts, edges: edges, ry: rnd(0, 6.28), rx: rnd(0, 6.28), wy: rnd(0.12, 0.3) * (Math.random() < .5 ? -1 : 1),
        wx: rnd(0.05, 0.14), pal: pal2(i), kind: 1 });
    }
    for (i = 0; i < CONFIG.dust * (small ? 0.6 : 1); i++) dust.push({ x: rnd(-1.8, 1.8), y: rnd(-1.3, 1.3), z: rnd(0.8, 4), ph: rnd(0, 6.28), y2: rnd(0, 1) });
  }
  function pal2(i) { return i % 2 ? PAL.yellow : PAL.purple; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    F = Math.min(W, H) * 0.92 + Math.max(W, H) * 0.12; // focal length in px
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var wasSmall = small; small = W < 700; if (wasSmall !== small || !spheres.length) build();
    if (calm) draw(2.4);
  }

  // world to screen: x,y world units (1 = about half the short side at z=1), z depth
  function proj(x, y, z) {
    var s = F / (z * 1.0), k = CONFIG.parallax / z;
    return { x: W / 2 + (x - px * 0.16 * k) * s * 0.55, y: H / 2 + (y - py * 0.12 * k - sy * 0.00022 * k * 400) * s * 0.55, s: s * 0.55 };
  }

  function ball(sx, sy, r, pal, alpha, glow) {
    if (r < 0.6) return;
    var gr;
    if (glow) { // soft halo
      gr = g.createRadialGradient(sx, sy, r * 0.8, sx, sy, r * 2.6);
      gr.addColorStop(0, rgba(pal[1], 0.2 * alpha)); gr.addColorStop(1, rgba(pal[1], 0));
      g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, r * 2.6, 0, 6.2832); g.fill();
    }
    gr = g.createRadialGradient(sx - r * 0.38, sy - r * 0.42, r * 0.05, sx, sy, r);
    gr.addColorStop(0, rgba(pal[0], alpha)); gr.addColorStop(0.22, rgba(pal[1], alpha));
    gr.addColorStop(0.62, rgba(pal[2], alpha * 0.92)); gr.addColorStop(1, rgba(pal[3], alpha * 0.85));
    g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, r, 0, 6.2832); g.fill();
    if (r > 6) { // glass rim light (lower right) and specular spot (upper left)
      g.strokeStyle = rgba(pal[1], 0.35 * alpha); g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath(); g.arc(sx, sy, r * 0.93, 0.15, 1.35); g.stroke();
      g.fillStyle = "rgba(255,255,255," + (0.55 * alpha) + ")";
      g.beginPath(); g.ellipse(sx - r * 0.36, sy - r * 0.46, r * 0.2, r * 0.11, -0.7, 0, 6.2832); g.fill();
    }
  }

  function drawSphere(o, t) {
    var wob = Math.sin(t * o.sw * 6 + o.ph);
    var yy = o.y - ((t * o.vy * CONFIG.speed) % 3.2) + 1.6; if (yy < -1.6) yy += 3.2;
    var p = proj(o.x + wob * 0.05, yy + Math.cos(t * 0.4 + o.ph) * 0.03, o.z), r = Math.min(o.r * p.s * 1.6, (small ? 44 : 70));
    var fade = Math.min(1, 1.5 / o.z) * o.a;           // far spheres are dimmer
    if (p.x < -r * 3 || p.x > W + r * 3 || p.y < -r * 3 || p.y > H + r * 3) return;
    ball(p.x, p.y, r, o.pal, fade, true);
  }

  function drawCluster(c, t) {
    var cy = Math.cos(c.ry + t * c.wy), sy_ = Math.sin(c.ry + t * c.wy), cx = Math.cos(c.rx + t * c.wx), sx = Math.sin(c.rx + t * c.wx);
    var cx0 = c.x + Math.sin(t * 0.13 + c.ry) * 0.08, cy0 = c.y + Math.cos(t * 0.11 + c.rx) * 0.07;
    var out = c.pts.map(function (q) {
      var x = q.x * c.R, y = q.y * c.R, z = q.z * c.R, x1 = x * cy + z * sy_, z1 = -x * sy_ + z * cy, y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      var p = proj(cx0 + x1, cy0 + y1, c.z + z2); p.z = c.z + z2; p.r = q.r; return p;
    });
    var fade = Math.min(1, 1.6 / c.z), i;
    g.lineCap = "round";
    c.edges.forEach(function (e) {
      var a = out[e[0]], b = out[e[1]], dz = (a.z + b.z) / 2, al = 0.5 * fade * Math.min(1, 2.2 / dz);
      g.strokeStyle = rgba(c.pal[1], al); g.lineWidth = Math.max(0.6, 0.012 * a.s);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    });
    var order = out.map(function (p, i) { return i; }).sort(function (a, b) { return out[b].z - out[a].z; });
    for (i = 0; i < order.length; i++) { var p = out[order[i]]; ball(p.x, p.y, p.r * p.s * 1.7, c.pal, fade, true); }
  }

  function drawDust(t) {
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i], p = proj(d.x, d.y, d.z), a = 0.18 + 0.32 * Math.abs(Math.sin(t * 0.6 + d.ph));
      g.fillStyle = d.y2 > 0.7 ? "rgba(255,214,110," + a + ")" : "rgba(196,170,255," + a + ")";
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, 0.9 / d.z), 0, 6.2832); g.fill();
    }
  }

  function draw(t) {
    g.clearRect(0, 0, W, H);
    px += (mx - px) * 0.05; py += (my - py) * 0.05;
    drawDust(t);
    var list = spheres.concat(clusters); // far to near, so near objects cover far ones
    list.sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < list.length; i++) (list[i].kind ? drawCluster : drawSphere)(list[i], t);
  }

  function active() { return document.body.classList.contains("site") || document.documentElement.getAttribute("data-theme") === "dark"; }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - last < 28) return; // about 35 fps is plenty for a background
    last = now;
    if (!active()) return;
    draw((now - t0) / 1000);
  }
  function start() { if (running || calm) return; running = true; last = 0; requestAnimationFrame(frame); }

  function init() {
    cv = document.createElement("canvas"); cv.id = "bg3d"; cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv); g = cv.getContext("2d"); t0 = performance.now();
    small = window.innerWidth < 700; resize();
    window.addEventListener("resize", resize);
    if (CONFIG.parallax) {
      window.addEventListener("pointermove", function (e) { mx = e.clientX / W - 0.5; my = e.clientY / H - 0.5; }, { passive: true });
      window.addEventListener("scroll", function () { sy = window.scrollY || 0; }, { passive: true });
      window.addEventListener("deviceorientation", function (e) {
        if (e.gamma == null) return; mx = Math.max(-0.5, Math.min(0.5, e.gamma / 60)); my = Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 80));
      }, { passive: true });
    }
    document.addEventListener("visibilitychange", function () { running = false; if (!document.hidden) start(); });
    start();
  }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
