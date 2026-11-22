/* Perov AI unlock screen: a rotating ABO3 perovskite supercell (A corners, B centres, O on the faces).
   Idle: the ions drift loosely and the bonds flicker. Unlock: the ions settle into the crystal and light runs along the bonds. */
(function () {
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cv = document.getElementById("crystal"), c = cv.getContext("2d");
  var COL = { A: [91, 214, 236], B: [214, 76, 214], O: [212, 160, 70] };
  var RAD = { A: 0.15, B: 0.13, O: 0.1 };
  var N = 2, atoms = [], bonds = [], i, j, k;

  function add(x, y, z, t) {
    atoms.push({ x: x - N / 2, y: y - N / 2, z: z - N / 2, t: t, p: [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3], h: -1 });
  }
  for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) for (k = 0; k <= N; k++) add(i, j, k, "A");
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) for (k = 0; k < N; k++) add(i + 0.5, j + 0.5, k + 0.5, "B");
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) for (k = 0; k <= N; k++) add(i + 0.5, j + 0.5, k, "O");
  for (i = 0; i < N; i++) for (j = 0; j <= N; j++) for (k = 0; k < N; k++) add(i + 0.5, j, k + 0.5, "O");
  for (i = 0; i <= N; i++) for (j = 0; j < N; j++) for (k = 0; k < N; k++) add(i, j + 0.5, k + 0.5, "O");

  atoms.forEach(function (a, ia) {
    atoms.forEach(function (b, ib) {
      if (ib <= ia || (a.t !== "O" && b.t !== "O")) return;
      var d2 = Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2), strong = (a.t === "B" || b.t === "B");
      if (strong && Math.abs(d2 - 0.25) < 0.01) bonds.push({ a: ia, b: ib, rest: 0.5, w: 1 });
      else if (!strong && a.t !== b.t && Math.abs(d2 - 0.5) < 0.01) bonds.push({ a: ia, b: ib, rest: Math.SQRT1_2, w: 0.22 });
    });
  });

  /* hop distance from the B ion nearest the middle: the order in which the light reaches each ion */
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
  var FORM_T = 2.7, HOP = 2.2 / (maxH + 1);

  var W = 0, H = 0, ang = 0.5, tilt = 0.5, order = 0, unlocking = false, formStart = 0, doneRes = null, doneFired = false, celeb = -1;
  var curX = 0.5, curY = 0.5, tgtX = 0.5, tgtY = 0.5, last = performance.now(), clock = 0;

  function size() {
    var d = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * d; cv.height = H * d; c.setTransform(d, 0, 0, d, 0, 0);
    if (calm) frame(performance.now());
  }
  function ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    var tForm = unlocking ? (now - formStart) / 1000 : -1;
    order += ((unlocking ? 1 : 0) - order) * Math.min(1, dt * (unlocking ? 2.2 : 3));
    if (calm) order = unlocking ? 1 : 0;
    if (!calm) ang += dt * (unlocking ? 0.5 - 0.3 * ease(tForm / FORM_T) : 0.16);
    var k2 = Math.min(1, dt * 4); curX += (tgtX - curX) * k2; curY += (tgtY - curY) * k2;
    if (unlocking && !doneFired && (tForm >= FORM_T || calm)) { doneFired = true; if (doneRes) doneRes(); }
    var cel = celeb >= 0 ? Math.exp(-(clock - celeb) * 1.4) : 0;

    c.clearRect(0, 0, W, H);
    var cx = W * curX, cy = H * curY, S = Math.min(W, H) * 0.17, amp = (1 - ease(order)) * 0.2, D = 8;
    var ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt);

    var bloom = clamp(order, 0, 1) * (0.1 + 0.25 * cel), R = Math.min(W, H) * 0.6;
    var bg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, "rgba(255,162,31," + (0.04 + bloom * 0.6) + ")"); bg.addColorStop(1, "rgba(255,162,31,0)");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    var P = atoms.map(function (a) {
      var x = a.x + amp * Math.sin(clock * 0.7 + a.p[0]), y = a.y + amp * Math.sin(clock * 0.6 + a.p[1]), z = a.z + amp * Math.sin(clock * 0.8 + a.p[2]);
      var X = x * ca + z * sa, Z = -x * sa + z * ca, Y = y * ct - Z * st, Z2 = y * st + Z * ct, f = D / (D - Z2);
      return { x: cx + X * S * f, y: cy + Y * S * f, z: Z2, f: f, wx: x, wy: y, wz: z };
    });

    c.lineCap = "round";
    bonds.forEach(function (b) {
      var A = P[b.a], B = P[b.b], len = Math.sqrt(Math.pow(A.wx - B.wx, 2) + Math.pow(A.wy - B.wy, 2) + Math.pow(A.wz - B.wz, 2));
      var q = clamp(1 - Math.abs((len - b.rest) / b.rest) * 2.4, 0, 1), ha = atoms[b.a].h, hb = atoms[b.b].h;
      var near = ha <= hb ? A : B, far = ha <= hb ? B : A, hn = Math.min(ha, hb), hf = Math.max(ha, hb);
      var lit = tForm < 0 ? 0 : (tForm - hf * HOP < 0 ? 0 : 0.55 + 0.45 * Math.exp(-(tForm - hf * HOP) * 2.2));
      if (calm && unlocking) lit = 0.6;
      lit = clamp(lit + cel * 0.3, 0, 1);
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = "rgba(150,165,235," + (b.w * 0.5 * q * (1 - lit * 0.4)) + ")"; c.lineWidth = 1; c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
      if (lit > 0) {
        c.globalCompositeOperation = "lighter";
        c.strokeStyle = "rgba(255,170,50," + (0.1 * lit * b.w) + ")"; c.lineWidth = 5 * b.w + 1; c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
        c.strokeStyle = "rgba(255,196,100," + (0.7 * lit * b.w) + ")"; c.lineWidth = 1.4; c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
      }
      if (tForm >= 0 && !calm) {
        var p = (tForm - hn * HOP) / HOP;
        if (p > 0 && p < 1 && b.w === 1) {
          var px = near.x + (far.x - near.x) * p, py = near.y + (far.y - near.y) * p, r = 9 * near.f;
          var g = c.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.3, "rgba(255,190,80,.7)"); g.addColorStop(1, "rgba(255,162,31,0)");
          c.globalCompositeOperation = "lighter"; c.fillStyle = g; c.beginPath(); c.arc(px, py, r, 0, 6.3); c.fill();
        }
      }
    });

    atoms.map(function (a, n) { return n; }).sort(function (m, n) { return P[m].z - P[n].z; }).forEach(function (n) {
      var a = atoms[n], q = P[n], r = RAD[a.t] * S * q.f * 1.25, col = COL[a.t], sh = 0.72 + 0.28 * (q.z + 1.8) / 3.6;
      var since = tForm - a.h * HOP, glow = tForm < 0 ? 0 : (since < 0 ? 0 : clamp(since / 0.25, 0, 1) * (0.6 + 0.4 * Math.exp(-since * 2)));
      if (calm && unlocking) glow = 0.7;
      glow = clamp(glow + cel * 0.35, 0, 1);
      var halo = r * (2.2 + 1.1 * glow), breathe = 0.07 + 0.03 * Math.sin(clock * 1.3 + a.p[0]);
      c.globalCompositeOperation = "lighter";
      var hg = c.createRadialGradient(q.x, q.y, r * 0.5, q.x, q.y, halo);
      hg.addColorStop(0, "rgba(" + col.join(",") + "," + (breathe + 0.13 * glow) + ")"); hg.addColorStop(1, "rgba(" + col.join(",") + ",0)");
      c.fillStyle = hg; c.beginPath(); c.arc(q.x, q.y, halo, 0, 6.3); c.fill();
      c.globalCompositeOperation = "source-over";
      var g = c.createRadialGradient(q.x - r * 0.35, q.y - r * 0.35, r * 0.1, q.x, q.y, r);
      g.addColorStop(0, "rgba(255,255,255,.95)");
      g.addColorStop(0.28, "rgba(" + col.map(function (v) { return Math.round(Math.min(255, v * sh * (1 + glow * 0.25))); }).join(",") + ",1)");
      g.addColorStop(1, "rgba(" + col.map(function (v) { return Math.round(v * sh * 0.4); }).join(",") + ",1)");
      c.fillStyle = g; c.beginPath(); c.arc(q.x, q.y, r, 0, 6.3); c.fill();
    });
    c.globalCompositeOperation = "source-over";
    if (!calm) requestAnimationFrame(frame);
  }

  window.addEventListener("resize", size);
  size();
  if (!calm) requestAnimationFrame(frame);

  window.Crystal = {
    layout: function (x, y) { tgtX = x; tgtY = y; if (calm) { curX = x; curY = y; frame(performance.now()); } },
    start: function () {
      unlocking = true; doneFired = false; formStart = performance.now(); celeb = -1;
      return new Promise(function (res) { doneRes = res; if (calm) { frame(performance.now()); } });
    },
    reset: function () { unlocking = false; celeb = -1; doneRes = null; if (calm) frame(performance.now()); },
    celebrate: function () { celeb = clock; if (calm) frame(performance.now()); }
  };
})();
