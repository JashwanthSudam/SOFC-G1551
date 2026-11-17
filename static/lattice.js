/* Perovskite lattice with oxygen ions hopping between sites. Faster exchange (higher log k*) means faster hopping. */
(function () {
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var speed = 1, P = 44, hosts = [];
  window.kstarLattice = { setFromLog: function (v) { speed = 0.5 + 2.6 * Math.max(0, Math.min(1, (v + 10.3) / 6.4)); } };
  function Ion(w, h) { this.reset(w, h); }
  Ion.prototype.reset = function (w, h) {
    this.i = Math.floor(Math.random() * (w / P)); this.j = Math.floor(Math.random() * (h / P));
    this.ni = this.i; this.nj = this.j; this.t = 1; this.w = w; this.h = h;
  };
  Ion.prototype.step = function (dt) {
    this.t += dt * 0.9 * speed;
    if (this.t >= 1) {
      this.i = this.ni; this.j = this.nj; this.t = 0;
      var d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
      this.ni = Math.max(0, Math.min(Math.floor(this.w / P), this.i + d[0]));
      this.nj = Math.max(0, Math.min(Math.floor(this.h / P), this.j + d[1]));
    }
    var e = this.t * this.t * (3 - 2 * this.t);
    this.x = (this.i + (this.ni - this.i) * e) * P; this.y = (this.j + (this.nj - this.j) * e) * P;
  };
  function mount(host) {
    var cv = document.createElement("canvas"); cv.className = "lattice";
    host.insertBefore(cv, host.firstChild);
    var c = cv.getContext("2d"), ions = [], last = performance.now(), w = 0, h = 0;
    function size() {
      var r = host.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height; cv.width = w * d; cv.height = h * d; c.setTransform(d, 0, 0, d, 0, 0);
      ions = []; for (var n = 0; n < (w < 600 ? 5 : 9); n++) ions.push(new Ion(w, h));
    }
    function draw(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      c.clearRect(0, 0, w, h);
      for (var i = 0; i * P <= w + P; i++) for (var j = 0; j * P <= h + P; j++) {
        var A = i % 4 === 0 && j % 4 === 0, B = i % 4 === 2 && j % 4 === 2;
        c.fillStyle = A ? "rgba(255,226,150,.55)" : B ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.14)";
        c.beginPath(); c.arc(i * P, j * P, A ? 5 : B ? 3.4 : 1.6, 0, 6.3); c.fill();
      }
      ions.forEach(function (o) {
        if (!calm) o.step(dt); else { o.x = o.i * P; o.y = o.j * P; }
        var g = c.createRadialGradient(o.x, o.y, 0, o.x, o.y, 15);
        g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(.35, "rgba(255,214,140,.55)"); g.addColorStop(1, "rgba(255,160,80,0)");
        c.fillStyle = g; c.beginPath(); c.arc(o.x, o.y, 15, 0, 6.3); c.fill();
      });
      if (!calm) requestAnimationFrame(draw);
    }
    size(); window.addEventListener("resize", size); requestAnimationFrame(draw);
  }
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".intro, .hero-art").forEach(mount);
  });
})();
