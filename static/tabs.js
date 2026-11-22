/* Inside the app: choose whether menu pages (Predict, History, Batch...) open in this tab or each in its own tab. */
(function () {
  var KEY = "kstar-newtab";
  function get() { try { if (window.matchMedia && matchMedia("(max-width:640px)").matches) return false; return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function nm(p) { return "kstar-" + new URL(p, location.href).pathname.replace(/\W/g, ""); }
  window.name = nm(location.pathname);                      // lets other pages find this tab again
  function set(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }
  document.addEventListener("DOMContentLoaded", function () {
    var role = document.querySelector("header.top .role"); if (!role) return;
    var g = document.createElement("div");
    g.className = "openin-seg"; g.setAttribute("role", "group"); g.setAttribute("aria-label", "Open pages in");
    g.innerHTML = '<span>Open in</span><button type="button" data-v="0">This tab</button><button type="button" data-v="1">New tab</button>';
    function paint() {
      var n = get();
      g.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", (b.dataset.v === "1") === n); });
    }
    g.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; set(b.dataset.v === "1"); paint(); });
    window.addEventListener("storage", function (e) { if (e.key === KEY) paint(); });
    paint(); role.insertBefore(g, role.firstChild);
  });
  document.addEventListener("click", function (e) {
    if (!get() || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var a = e.target.closest && e.target.closest("header.top .nav a, header.top .brand, .crumbs a, .actions a[href$='.html']");
    if (!a || a.origin !== location.origin || a.pathname === location.pathname) return;
    e.preventDefault();
    window.open(a.href, nm(a.pathname));   // each page keeps its own tab
  });
  // Predict stays put; every result opens in its own new tab. The tab is opened at click time (so pop-up blockers allow it)
  // and filled in when the prediction arrives. The result travels through localStorage.
  window.kstarPrepResult = function () {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), w = null;
    try { w = window.open("about:blank", "kstar-result-" + id); } catch (e) {}
    if (w) { try { w.document.title = "Predicting\u2026"; w.document.body.style.cssText = "font:16px system-ui,sans-serif;padding:32px;background:#12121C;color:#EEF0FF"; w.document.body.textContent = "Predicting\u2026"; } catch (e) {} }
    return { id: id, w: w };
  };
  window.kstarAbortResult = function (h) { if (h && h.w) { try { h.w.close(); } catch (e) {} } };
  window.kstarGoResult = function (h) {
    var last = null; try { last = sessionStorage.getItem("kstar-last"); } catch (e) {}
    if (h && h.w && !h.w.closed && last) {
      try { localStorage.setItem("kstar-handoff-" + h.id, last); } catch (e) {}
      h.w.location.href = "result.html?r=" + h.id; return;
    }
    location.href = "result.html";   // new tab was blocked: fall back to this tab
  };
})();
