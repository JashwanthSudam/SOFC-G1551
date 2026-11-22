/* Perov AI 3D crystal: a rotating ABO3 perovskite supercell (A corners, B centres, O on the faces).
   Plain canvas, no external library, so it also works on a slow or offline expo network.
   createCrystal(canvas, { ordered, pulses, parallax, scale }) returns { layout, start, reset, celebrate, setVisible, setScale }.
   ordered: the lattice is perfect from the start (home page). pulses: light runs along the bonds now and then.
   Otherwise the ions drift loosely until start() is called (login page). */
(function () {
  var calmQ = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  var CAL = !!(calmQ && calmQ.matches);
  var COL = { A: [78, 205, 230], B: [150, 128, 255], O: [244, 178, 84] };
  var RAD = { A: 0.15, B: 0.13, O: 0.1 };
  var N = 2, FORM_T = 2.7, PERIOD = 7.5;

  function geometry() {
    var atoms = [], bonds = [], i, j, k;
    function add(x, y, z, t) { atoms.push({ x: x - N / 2, y: y - N / 2, z: z - N / 2, t: t, h: -1 }); }
    for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) for (k = 0; k <= N; k++) add(i, j, k, "A");
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) for (k = 0; k < N; k++) add(i + 0.5, j + 0.5, k + 0.5, "B");
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) for (k = 0; k <= N; k++) add(i + 0.5, j + 0.5, k, "O");
    for (i = 0; i < N; i++) for (j = 0; j <= N; j++) for (k = 0; k < N; k++) add(i + 0.5, j, k + 0.5, "O");
    for (i = 0; i <= N; i++) for (j = 0; j < N; j++) for (k = 0; k < N; k++) add(i, j + 0.5, k + 0.5, "O");
    atoms.forEach(function (a, ia) {
      atoms.forEach(function (b, ib) {
        if (ib <= ia || (a.t !== "O" && b.t !== "O")) return;
        var d2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2), strong = a.t === "B" || b.t === "B";
        if (strong && Math.abs(d2 - 0.25) < 0.01) bonds.push({ a: ia, b: ib, rest: 0.5, w: 1 });
        else if (!strong && a.t !== b.t && Math.abs(d2 - 0.5) < 0.01) bonds.push({ a: ia, b: ib, rest: Math.SQRT1_2, w: 0.22 });
      });
    });
    var start = 0, best = 1e9, maxH = 0, queue;
    atoms.forEach(function (a, n) { var d = a.x * a.x + a.y * a.y + a.z * a.z; if (a.t === "B" && d < best - 1e-6) { best = d; start = n; } });
    atoms[start].h = 0; queue = [start];
    while (queue.length) {
      var u = queue.shift();
      bonds.forEach(function (b) {
        var v = b.a === u ? b.b : b.b === u ? b.a : -1;
        if (v >= 0 && atoms[v].h < 0) { atoms[v].h = atoms[u].h + 1; maxH = Math.max(maxH, atoms[v].h); queue.push(v); }
      });
    }
    atoms.forEach(function (a) { if (a.h < 0) a.h = maxH; });
    return { atoms: atoms, bonds: bonds, maxH: maxH };
  }
  var G = geometry(), HOP = 2.2 / (G.maxH + 1);
  var CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  var EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  function create(cv, o) {
    o = o || {};
    var c = cv.getContext("2d"), scale = o.scale || 0.17;
    var atoms = G.atoms.map(function (a) { return { x: a.x, y: a.y, z: a.z, t: a.t, h: a.h, p: [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3] }; });
    var bonds = G.bonds, dust = [], d;
    for (d = 0; d < 70; d++) dust.push({ x: (Math.random() - 0.5) * 7, y: (Math.random() - 0.5) * 5, z: (Math.random() - 0.5) * 7, s: 0.6 + Math.random(), p: Math.random() * 6.3 });

    var W = 0, H = 0, ang = 0.6, tilt = 0.5, order = o.ordered ? 1 : 0, unlocking = false, formStart = 0, doneRes = null, doneFired = false, celeb = -1;
    var curX = 0.5, curY = 0.5, tgtX = 0.5, tgtY = 0.5, last = performance.now(), clock = 0, visible = true, running = false;
    var yawT = 0, pitchT = 0, yaw = 0, pitch = 0;

    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth || window.innerWidth; H = cv.clientHeight || window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (CAL) frame(performance.now());
    }
    if (o.parallax !== false) {
      window.addEventListener("pointermove", function (e) {
        var r = cv.getBoundingClientRect();
        if (!r.width) return;
        yawT = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1) * 0.5;
        pitchT = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1) * 0.25;
      }, { passive: true });
    }

    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
      var tF = -1, persist = unlocking;
      if (unlocking) tF = (now - formStart) / 1000;
      else if (o.pulses) tF = clock % PERIOD;
      if (o.ordered) order = 1; else order += ((unlocking ? 1 : 0) - order) * Math.min(1, dt * (unlocking ? 2.2 : 3));
      if (CAL) order = unlocking || o.ordered ? 1 : 0;
      if (!CAL) ang += dt * (unlocking ? 0.5 - 0.3 * ease(tF / FORM_T) : (o.ordered ? 0.12 : 0.16));
      var kk = Math.min(1, dt * 3.5); yaw += (yawT - yaw) * kk; pitch += (pitchT - pitch) * kk;
      var k2 = Math.min(1, dt * 4); curX += (tgtX - curX) * k2; curY += (tgtY - curY) * k2;
      if (unlocking && !doneFired && (tF >= FORM_T || CAL)) { doneFired = true; if (doneRes) doneRes(); }
      var cel = celeb >= 0 ? Math.exp(-(clock - celeb) * 1.4) : 0;

      c.clearRect(0, 0, W, H);
      var cx = W * curX, cy = H * curY, S = Math.min(W, H) * scale, amp = (1 - ease(order)) * 0.2, D = 8;
      var A = ang + yaw, T = tilt + pitch;
      var ca = Math.cos(A), sa = Math.sin(A), ct = Math.cos(T), st = Math.sin(T);
      function proj(x, y, z, a2) {
        var cA = a2 === undefined ? ca : Math.cos(a2), sA = a2 === undefined ? sa : Math.sin(a2);
        var X = x * cA + z * sA, Z = -x * sA + z * cA, Y = y * ct - Z * st, Z2 = y * st + Z * ct, f = D / (D - Z2);
        return { x: cx + X * S * f, y: cy + Y * S * f, z: Z2, f: f };
      }

      /* soft light behind the crystal and a floor glow for depth */
      var bloom = clamp(order, 0, 1) * (0.05 + 0.25 * cel), R = Math.min(W, H) * 0.62;
      var bg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
      bg.addColorStop(0, "rgba(120,110,255," + (0.12 + bloom) + ")"); bg.addColorStop(0.55, "rgba(78,205,230,.04)"); bg.addColorStop(1, "rgba(78,205,230,0)");
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      c.save(); c.translate(cx, cy + S * 2.15); c.scale(1, 0.26);
      var fg = c.createRadialGradient(0, 0, 0, 0, 0, S * 2.4);
      fg.addColorStop(0, "rgba(78,205,230," + (0.18 * (0.5 + 0.5 * order) + 0.1 * cel) + ")"); fg.addColorStop(1, "rgba(78,205,230,0)");
      c.fillStyle = fg; c.beginPath(); c.arc(0, 0, S * 2.4, 0, 6.3); c.fill(); c.restore();

      /* cell outline */
      c.globalCompositeOperation = "source-over"; c.lineWidth = 1; c.strokeStyle = "rgba(140,160,255,.16)"; c.beginPath();
      var cp = CORNERS.map(function (q) { return proj(q[0], q[1], q[2]); });
      EDGES.forEach(function (e) { c.moveTo(cp[e[0]].x, cp[e[0]].y); c.lineTo(cp[e[1]].x, cp[e[1]].y); });
      c.stroke();

      /* floating particles */
      c.globalCompositeOperation = "lighter";
      dust.forEach(function (q) {
        var pp = proj(q.x + Math.sin(clock * 0.2 + q.p) * 0.2, q.y + Math.cos(clock * 0.17 + q.p) * 0.2, q.z, A * 0.6 + 0.3);
        c.fillStyle = "rgba(170,190,255," + (0.1 + 0.18 * clamp((pp.z + 3) / 6, 0, 1)) + ")";
        c.beginPath(); c.arc(pp.x, pp.y, q.s * pp.f, 0, 6.3); c.fill();
      });

      var P = atoms.map(function (a) {
        var x = a.x + amp * Math.sin(clock * 0.7 + a.p[0]), y = a.y + amp * Math.sin(clock * 0.6 + a.p[1]), z = a.z + amp * Math.sin(clock * 0.8 + a.p[2]);
        var q = proj(x, y, z); q.wx = x; q.wy = y; q.wz = z; return q;
      });

      c.lineCap = "round";
      bonds.forEach(function (b) {
        var pa = P[b.a], pb = P[b.b], len = Math.sqrt(Math.pow(pa.wx - pb.wx, 2) + Math.pow(pa.wy - pb.wy, 2) + Math.pow(pa.wz - pb.wz, 2));
        var q = clamp(1 - Math.abs((len - b.rest) / b.rest) * 2.4, 0, 1), ha = atoms[b.a].h, hb = atoms[b.b].h;
        var near = ha <= hb ? pa : pb, far = ha <= hb ? pb : pa, hn = Math.min(ha, hb), hf = Math.max(ha, hb);
        var tt = tF - hf * HOP, lit = tF < 0 || tt < 0 ? 0 : (persist ? 0.55 + 0.45 * Math.exp(-tt * 2.2) : 0.9 * Math.exp(-tt * 1.3));
        if (CAL && unlocking) lit = 0.6;
        lit = clamp(lit + cel * 0.3, 0, 1);
        var fog = 0.45 + 0.55 * clamp(((pa.z + pb.z) / 2 + 1.9) / 3.8, 0, 1);
        c.globalCompositeOperation = "source-over";
        c.strokeStyle = "rgba(165,185,255," + (b.w * 0.55 * q * fog * (1 - lit * 0.4)) + ")"; c.lineWidth = b.w === 1 ? 1.3 : 0.8; c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
        if (lit > 0.01) {
          c.globalCompositeOperation = "lighter";
          c.strokeStyle = "rgba(255,170,50," + (0.12 * lit * b.w) + ")"; c.lineWidth = 5 * b.w + 1; c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
          c.strokeStyle = "rgba(255,196,100," + (0.75 * lit * b.w) + ")"; c.lineWidth = 1.4; c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
        }
        if (tF >= 0 && tF < FORM_T && !CAL) {
          var p = (tF - hn * HOP) / HOP;
          if (p > 0 && p < 1 && b.w === 1) {
            var px = near.x + (far.x - near.x) * p, py = near.y + (far.y - near.y) * p, r = 9 * near.f;
            var g = c.createRadialGradient(px, py, 0, px, py, r);
            g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.3, "rgba(255,190,80,.7)"); g.addColorStop(1, "rgba(255,162,31,0)");
            c.globalCompositeOperation = "lighter"; c.fillStyle = g; c.beginPath(); c.arc(px, py, r, 0, 6.3); c.fill();
          }
        }
      });

      atoms.map(function (a, n) { return n; }).sort(function (m, n) { return P[m].z - P[n].z; }).forEach(function (n) {
        var a = atoms[n], q = P[n], r = RAD[a.t] * S * q.f * 1.25, col = COL[a.t], depth = clamp((q.z + 1.9) / 3.8, 0, 1), sh = 0.7 + 0.3 * depth, fog = 0.5 + 0.5 * depth;
        var since = tF - a.h * HOP, glow = tF < 0 || since < 0 ? 0 : (persist ? clamp(since / 0.25, 0, 1) * (0.6 + 0.4 * Math.exp(-since * 2)) : 0.9 * Math.exp(-since * 1.3));
        if (CAL && unlocking) glow = 0.7;
        glow = clamp(glow + cel * 0.35, 0, 1);
        var halo = r * (2.2 + 1.1 * glow), breathe = 0.06 + 0.025 * Math.sin(clock * 1.3 + a.p[0]);
        c.globalAlpha = fog;
        c.globalCompositeOperation = "lighter";
        var hg = c.createRadialGradient(q.x, q.y, r * 0.5, q.x, q.y, halo);
        hg.addColorStop(0, "rgba(" + col.join(",") + "," + (breathe + 0.14 * glow) + ")"); hg.addColorStop(1, "rgba(" + col.join(",") + ",0)");
        c.fillStyle = hg; c.beginPath(); c.arc(q.x, q.y, halo, 0, 6.3); c.fill();
        c.globalCompositeOperation = "source-over";
        var g = c.createRadialGradient(q.x - r * 0.35, q.y - r * 0.38, r * 0.08, q.x, q.y, r);
        g.addColorStop(0, "rgba(255,255,255,.96)");
        g.addColorStop(0.26, "rgba(" + col.map(function (v) { return Math.round(Math.min(255, v * sh * (1 + glow * 0.25))); }).join(",") + ",1)");
        g.addColorStop(1, "rgba(" + col.map(function (v) { return Math.round(v * sh * 0.32); }).join(",") + ",1)");
        c.fillStyle = g; c.beginPath(); c.arc(q.x, q.y, r, 0, 6.3); c.fill();
        c.globalAlpha = 1;
      });
      c.globalCompositeOperation = "source-over";
    }

    function loop(t) {
      frame(t);
      if (!CAL && visible) requestAnimationFrame(loop); else running = false;
    }
    function run() { if (!running && !CAL && visible) { running = true; last = performance.now(); requestAnimationFrame(loop); } }

    window.addEventListener("resize", size);
    size();
    if (CAL) frame(performance.now()); else run();

    return {
      layout: function (x, y) { tgtX = x; tgtY = y; if (CAL) { curX = x; curY = y; frame(performance.now()); } },
      setScale: function (s) { scale = s; if (CAL) frame(performance.now()); },
      setVisible: function (v) { visible = v; if (v) run(); },
      start: function () {
        unlocking = true; doneFired = false; formStart = performance.now(); celeb = -1;
        return new Promise(function (res) { doneRes = res; if (CAL) frame(performance.now()); });
      },
      reset: function () { unlocking = false; celeb = -1; doneRes = null; if (CAL) frame(performance.now()); },
      celebrate: function () { celeb = clock; if (CAL) frame(performance.now()); }
    };
  }
  window.createCrystal = create;
})();
