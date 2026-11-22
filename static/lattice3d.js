/* Rotating perovskite unit cell (ABO3): A-site ions on the corners, B-site ion in the centre, oxygen on the face centres. */
(function () {
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COLORS = { A: [91, 214, 236], B: [214, 76, 214], O: [212, 160, 70] };
  var pts = [], i, j, k;
  for (i = -1; i <= 1; i += 2) for (j = -1; j <= 1; j += 2) for (k = -1; k <= 1; k += 2) pts.push({ x: i, y: j, z: k, t: "A", r: 0.2 });
  pts.push({ x: 0, y: 0, z: 0, t: "B", r: 0.17 });
  [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(function (p) { pts.push({ x: p[0], y: p[1], z: p[2], t: "O", r: 0.13 }); });
  var EDGES = [];
  pts.forEach(function (a, ia) {
    pts.forEach(function (b, ib) {
      if (ib <= ia) return;
      var d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
      if (a.t === "A" && b.t === "A" && d === 2) EDGES.push([ia, ib, 0.16]);
      if ((a.t === "B" && b.t === "O") || (a.t === "O" && b.t === "B")) EDGES.push([ia, ib, 0.4]);
    });
  });
  function mount(cv) {
    var c = cv.getContext("2d"), ang = 0.6, tilt = 0.45, speed = 0.35, last = performance.now();
    function size() { var d = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 320; cv.width = w * d; cv.height = w * d; c.setTransform(d, 0, 0, d, 0, 0); }
    function proj(p, W) {
      var ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt);
      var x = p.x * ca + p.z * sa, z = -p.x * sa + p.z * ca, y = p.y * ct - z * st, z2 = p.y * st + z * ct;
      var f = 3.6 / (3.6 - z2 * 0.55), s = W * 0.2;
      return { x: W / 2 + x * s * f, y: W / 2 + y * s * f, z: z2, f: f };
    }
    function draw(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!calm) ang += dt * speed;
      var W = cv.clientWidth || 320; c.clearRect(0, 0, W, W);
      var P = pts.map(function (p) { return proj(p, W); });
      c.lineCap = "round";
      EDGES.forEach(function (e) { var a = P[e[0]], b = P[e[1]]; c.strokeStyle = "rgba(150,170,200," + e[2] + ")"; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); });
      pts.map(function (p, n) { return n; }).sort(function (a, b) { return P[a].z - P[b].z; }).forEach(function (n) {
        var p = pts[n], q = P[n], r = p.r * W * 0.5 * q.f, col = COLORS[p.t], sh = 0.75 + 0.25 * (q.z + 1.4) / 2.8;
        var g = c.createRadialGradient(q.x - r * 0.35, q.y - r * 0.35, r * 0.1, q.x, q.y, r);
        g.addColorStop(0, "rgba(255,255,255,.95)");
        g.addColorStop(0.25, "rgba(" + col.map(function (v) { return Math.round(v * sh); }).join(",") + ",1)");
        g.addColorStop(1, "rgba(" + col.map(function (v) { return Math.round(v * sh * 0.45); }).join(",") + ",1)");
        c.fillStyle = g; c.beginPath(); c.arc(q.x, q.y, r, 0, 6.3); c.fill();
      });
      if (!calm) requestAnimationFrame(draw);
    }
    size(); window.addEventListener("resize", function () { size(); if (calm) draw(performance.now()); });
    window.kstarCell = { faster: function (logk) { speed = 0.25 + 0.9 * Math.max(0, Math.min(1, (logk + 10.3) / 6.4)); } };
    requestAnimationFrame(draw);
  }
  document.addEventListener("DOMContentLoaded", function () { var cv = document.getElementById("cell3d"); if (cv) mount(cv); });
})();
