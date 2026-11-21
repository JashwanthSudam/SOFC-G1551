/* Predict page dashboard: renders everything from /api/predict_composition (data.analysis, data.explain),
   plus the Low-T finder and Candidates tabs (/api/screen) and model-wide SHAP importance (/api/importance). */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SUP = { "-": "\u207B", "0": "\u2070", "1": "\u00B9", "2": "\u00B2", "3": "\u00B3", "4": "\u2074", "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079" };
  const minus = (v, d = 2) => (v < 0 ? "\u2212" : "") + Math.abs(v).toFixed(d);
  const signed = (v, d = 2) => (v < 0 ? "\u2212" : "+") + Math.abs(v).toFixed(d);
  function sci(v) {
    if (v == null || !isFinite(v)) return "n/a";
    const a = Math.abs(v);
    if (a >= 0.01 && a < 1000) return String(+v.toPrecision(3));
    const [m, e] = v.toExponential(2).split("e");
    return `${(+m).toString()}\u00D710${String(+e).split("").map(ch => SUP[ch] || ch).join("")}`;
  }
  const lg = v => (v != null && v > 0 ? Math.log10(v) : null);
  const PROPS = [
    { key: "logk", label: "log k* (cm/s)", short: "log k*", get: (s, i) => s.logk[i], val: v => v },
    { key: "sigma_i", label: "log \u03C3 ionic (S/cm)", short: "\u03C3 ionic (S/cm)", get: (s, i) => lg(s.sigma_i[i]) },
    { key: "sigma_e", label: "log conductivity (S/cm)", short: "Conductivity (S/cm)", get: (s, i) => lg(s.sigma_e && s.sigma_e[i]) },
    { key: "rp", label: "log Rp (\u03A9\u00B7cm\u00B2)", short: "Rp (\u03A9\u00B7cm\u00B2)", get: (s, i) => lg(s.rp[i]) },
    { key: "asr", label: "log ASR (\u03A9\u00B7cm\u00B2)", short: "ASR (\u03A9\u00B7cm\u00B2)", get: (s, i) => lg(s.asr[i]) },
  ];
  let LAST = null, importance = null;

  /* ---------- result cards ---------- */
  function vsText(v, what) {
    if (!v) return "";
    return `<div class="vs ${v.good ? "good" : "bad"}">${v.up ? "\u2191" : "\u2193"} ${sci(v.factor)}\u00D7 ${v.up ? "higher" : "lower"} than LSC</div>`;
  }
  function cards(a, d) {
    const at = a.at, ref = a.lsc_at, vs = a.vs || {};
    const list = [
      { n: "log k*", v: minus(at.logk), u: `cm/s at ${a.temp_c} \u00B0C`, t: "ml", sub: ref ? `<div class="vs ref">LSC ${minus(ref.logk)}</div>` : "" },
      { n: "Ionic conductivity", v: sci(at.sigma_i), u: "S/cm", t: "ph", sub: vsText(vs.sigma_i) },
      { n: "Conductivity (air)", v: sci(at.sigma_e), u: "S/cm", t: "ml", sub: vsText(vs.sigma_e) },
      { n: "Thermal expansion", v: at.tec == null ? "n/a" : at.tec.toFixed(2), u: "\u00D710\u207B\u2076 /K", t: "ml", sub: "" },
      { n: "Polarization resistance", v: sci(at.rp), u: "\u03A9\u00B7cm\u00B2", t: "ph", sub: vsText(vs.rp) },
      { n: "ASR", v: sci(at.asr), u: "\u03A9\u00B7cm\u00B2", t: "ph", sub: vsText(vs.asr) },
      { n: "E above hull", v: a.ehull == null ? "n/a" : a.ehull.toFixed(1), u: `meV/atom \u00B7 ${a.stability_band || ""}`, t: "ml", sub: `<div class="vs ref">${esc(a.ehull_source)}</div>` },
    ];
    return list.map(c => `<div class="pcard"><div class="nm">${c.n}</div><div class="val">${c.v}</div><div class="un">${c.u}</div><span class="tag ${c.t}">${c.t === "ml" ? "ML" : "Physics estimate"}</span>${c.sub}</div>`).join("");
  }

  /* ---------- temperature chart + table ---------- */
  function chart(a, pk) {
    const P = PROPS.find(p => p.key === pk) || PROPS[0], T = a.temps;
    const mine = T.map((t, i) => P.get(a.series, i)), ref = a.lsc ? T.map((t, i) => P.get(a.lsc, i)) : [];
    const vals = mine.concat(ref).filter(v => v != null && isFinite(v));
    if (!vals.length) return `<p class="note">No ${esc(P.label)} values for this material.</p>`;
    const W = 680, H = 300, m = { l: 52, r: 16, t: 14, b: 40 };
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 || 0.5; lo -= pad; hi += pad;
    const x = t => m.l + (t - T[0]) / (T[T.length - 1] - T[0]) * (W - m.l - m.r);
    const y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const path = arr => arr.map((v, i) => v == null ? "" : `${arr.slice(0, i).some(q => q != null) ? "L" : "M"}${x(T[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const yt = [0, 1, 2, 3, 4].map(i => lo + (hi - lo) * i / 4), xt = [];
    for (let t = Math.ceil(T[0] / 100) * 100; t <= T[T.length - 1]; t += 100) xt.push(t);
    const si = T.indexOf(Math.round(a.temp_c)), sv = si >= 0 ? mine[si] : null, zx = Math.min(a.low_t_max, T[T.length - 1]);
    return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(P.label)} against temperature">
      <rect class="zone" x="${x(T[0])}" y="${m.t}" width="${x(zx) - x(T[0])}" height="${H - m.t - m.b}"/>
      <text x="${x(T[0]) + 6}" y="${m.t + 12}">low-temperature zone</text>
      ${yt.map(v => `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${minus(v, 1)}</text>`).join("")}
      ${xt.map(t => `<text x="${x(t)}" y="${H - m.b + 16}" text-anchor="middle">${t}</text>`).join("")}
      <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">Temperature (\u00B0C)</text>
      ${ref.length ? `<path class="ref" d="${path(ref)}"/>` : ""}<path class="mine" d="${path(mine)}"/>
      ${sv != null ? `<line class="ax" x1="${x(T[si])}" x2="${x(T[si])}" y1="${m.t}" y2="${H - m.b}"/><circle class="pin" cx="${x(T[si])}" cy="${y(sv)}" r="6"/>` : ""}</svg>
      <div class="legendrow"><span style="color:var(--chart)">\u25AC</span> ${esc(LAST.formula)} <span style="color:var(--signal)">- - -</span> ${esc(a.lsc_formula)} (LSC)</div>`;
  }
  function table(a) {
    const rows = a.table_temps.map(t => {
      const i = a.temps.indexOf(t), s = a.series;
      return `<tr class="${t === Math.round(a.temp_c) ? "sel" : ""}"><td>${t}</td><td>${minus(s.logk[i])}</td><td>${sci(s.sigma_i[i])}</td><td>${sci(s.sigma_e && s.sigma_e[i])}</td><td>${sci(s.rp[i])}</td><td>${sci(s.asr[i])}</td></tr>`;
    }).join("");
    return `<div class="tscroll"><table class="dtable"><thead><tr><th>T (\u00B0C)</th><th>log k*</th><th>\u03C3 ionic (S/cm)</th><th>Conductivity (S/cm)</th><th>Rp (\u03A9\u00B7cm\u00B2)</th><th>ASR (\u03A9\u00B7cm\u00B2)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /* ---------- SHAP + stability ---------- */
  function shr(label, v, max, tip) {
    const w = Math.abs(v) / max * 50, st = v >= 0 ? `left:50%;width:${w}%;background:var(--chart)` : `left:${50 - w}%;width:${w}%;background:var(--signal)`;
    return `<div class="shr"><span class="nm" title="${esc(tip || label)}">${esc(label)}</span><span class="tr"><span class="zero"></span><span class="fill" style="${st}"></span></span><span class="num">${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(2)}</span></div>`;
  }
  function shap(ex) {
    if (!ex) return `<p class="sub">SHAP values are not available for this prediction.</p>`;
    const top = ex.features.slice(0, 8), max = Math.max(...top.map(r => Math.abs(r.contribution)), 1e-9);
    return `<div class="avgline"><span>Dataset average</span><b>${minus(ex.base_value, 3)}</b></div>
      ${top.map(r => shr(`${r.feature} = ${+r.value.toPrecision(3)}`, r.contribution, max)).join("")}`;
  }
  function stabilityBox(a) {
    if (a.ehull == null) return `<p class="sub">Stability could not be estimated.</p>`;
    const cap = 200, pos = Math.min(a.ehull, cap) / cap * 100, lim = a.ehull_limit / cap * 100;
    return `<span class="badge ${a.stability_band === "Stable" ? "Good" : a.stability_band === "Moderate stability" ? "Comparable" : "Below"}">${esc(a.stability_band)}</span>
      <div class="gauge"><span class="lim" style="left:${lim}%"></span><span class="pinm" style="left:${pos}%"><span>${a.ehull.toFixed(0)}</span></span></div>
      <div class="gscale"><span>0</span><span>${a.ehull_limit} (stable limit)</span><span>${cap}+ meV/atom</span></div>
      ${a.p_stable != null && a.ehull_source === "ML prediction" ? `<p class="sub" style="margin-top:8px">Chance of being below the stable limit: about ${Math.round(a.p_stable * 100)}%.</p>` : ""}`;
  }
  async function importanceHTML() {
    if (!importance) {
      try { const r = await api("/api/importance"); importance = (await r.json()).importance || { features: [] }; } catch { importance = { features: [] }; }
    }
    const f = (importance.features || []).slice(0, 8);
    if (!f.length) return `<p class="sub">Not available.</p>`;
    const max = Math.max(...f.map(r => r.importance), 1e-9);
    return f.map(r => shr(r.feature, r.importance, max).replace('class="zero"', 'class="zero" hidden')).join("");
  }

  /* ---------- main render ---------- */
  function render(data, formula, temp) {
    const a = data.analysis, box = $("#dash");
    LAST = { data, formula, temp, a };
    const lat = $("#cellnote"); if (lat && data.sites) lat.innerHTML = latticeLegend(data.sites);
    if (window.kstarCell) kstarCell.faster(data.log_kstar);
    if (!a) {
      box.innerHTML = `<section class="panel dsec"><div class="headline" style="border:0;margin:0;padding:0"><div class="logbig">${minus(data.log_kstar)}</div><div class="unitline">log k* (cm/s) at ${temp} \u00B0C</div></div><p class="sub">The extra properties could not be worked out for this material.</p></section>`;
      box.hidden = false; return;
    }
    const cls = a.rating === "Below LSC" ? "Below" : a.rating;
    box.innerHTML = `
      <section class="panel dsec" id="headline">
        <div class="headline" style="border:0;margin:0;padding:0">
          <div class="logbig">${minus(data.log_kstar)}</div>
          <div class="badges"><span class="badge ${cls}">${esc(a.rating)}: ${signed(a.delta)} vs LSC at ${a.temp_c} \u00B0C</span>${a.low_t ? `<span class="badge lowt">Low-temperature operation</span>` : ""}</div>
          <div class="unitline">log k* (cm/s) at ${a.temp_c} \u00B0C${a.lsc_at ? ` \u00B7 LSC = ${minus(a.lsc_at.logk)}` : ""}</div>
          <dl class="summary">
            <dt>Composition</dt><dd>${esc(data.formula || formula)}</dd>
            <dt>Temperature</dt><dd>${a.temp_c} \u00B0C</dd>
            <dt>E above hull</dt><dd>${a.ehull == null ? "n/a" : a.ehull.toFixed(1) + " meV/atom"}</dd>
            <dt>TEC</dt><dd>${a.at.tec == null ? "n/a" : a.at.tec.toFixed(2) + " \u00D710\u207B\u2076 /K"}</dd>
            <dt>Est. price</dt><dd>${a.price == null ? "n/a" : a.price.toFixed(1) + " $/kg"}</dd>
            <dt>Source of stability</dt><dd>${esc(a.ehull_source)}</dd>
          </dl>
          ${(data.warnings || []).length ? `<div class="msg" role="alert" style="margin-top:12px">${data.warnings.map(esc).join("<br>")}</div>` : ""}
        </div>
      </section>
      <section class="panel dsec"><h2>Predicted properties at the selected temperature</h2>
        <p class="sub"><span class="tag ml">ML</span> trained on measured data &nbsp; <span class="tag ph">Physics estimate</span> derived from log k* with documented formulas (relative ranking, not measured values).</p>
        <div class="cardgrid">${cards(a, data)}</div>
        <p class="dnote">Ionic conductivity: Nernst\u2013Einstein with D* = k*\u00B7L<sub>c</sub>. Polarization resistance: R<sub>p</sub> = RT/(4F\u00B2c<sub>O</sub>k*). ASR = R<sub>p</sub> plus the ohmic loss of a 10 \u00B5m layer. LSC is ${esc(a.lsc_formula)} from the same model at the same temperature.</p>
      </section>
      <section class="panel dsec"><div class="chartbar"><div><h2>Property vs temperature</h2><p class="sub">Your composition against the LSC benchmark. Shaded zone = low temperature (\u2264 ${a.low_t_max} \u00B0C).</p></div>
        <select id="proppick" aria-label="Property to plot">${PROPS.map(p => `<option value="${p.key}">${p.label}</option>`).join("")}</select></div>
        <div id="chartbox">${chart(a, "logk")}</div>${table(a)}
      </section>
      <div class="two">
        <section class="panel"><h2>SHAP \u2014 why this value?</h2><p class="sub">Right = pushes k* up, left = pushes it down.</p>${shap(data.explain)}</section>
        <section class="panel"><h2>Stability</h2>${stabilityBox(a)}<h3 style="font-size:15px;margin:18px 0 4px">Model-wide SHAP importance</h3><div id="impbox"><p class="sub">Loading\u2026</p></div></section>
      </div>
      <p class="dnote"><a href="result.html" target="_blank" rel="noopener">Open the detailed report</a> (SHAP waterfall, model stages and trace).</p>`;
    box.hidden = false;
    $("#proppick").onchange = e => { $("#chartbox").innerHTML = chart(a, e.target.value); };
    importanceHTML().then(h => { const b = $("#impbox"); if (b) b.innerHTML = h; });
  }
  function latticeLegend(s) {
    const j = o => Object.keys(o).join(", ");
    return `<i style="background:#5bd6ec"></i>A: ${esc(j(s.A))}<i style="background:#d64cd6"></i>B: ${esc(j(s.B))}<i style="background:#d4a046"></i>O`;
  }

  /* ---------- tabs ---------- */
  const PANES = { predict: "#pane-predict", lowt: "#pane-lowt", cand: "#pane-cand" };
  function showTab(name) {
    Object.entries(PANES).forEach(([k, sel]) => { const el = $(sel); if (el) el.hidden = k !== name; });
    document.querySelectorAll(".dtabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    if (name === "lowt") loadScreen("lowt"); if (name === "cand") loadScreen("cand");
    try { sessionStorage.setItem("kstar-tab", name); } catch {}
  }
  const SCREEN = { lowt: { temp: 600, stable: false, floor: null }, cand: { temp: 600, stable: true, floor: -0.5 } };
  async function loadScreen(which) {
    const st = SCREEN[which], out = $(`#${which}-out`);
    out.innerHTML = `<p class="sub">Screening compositions\u2026</p>`;
    try {
      const r = await api(`/api/screen?temp=${st.temp}&limit=25${st.stable ? "&stable=1" : ""}${st.floor != null ? "&min_delta=" + st.floor : ""}`);
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Screening failed.");
      if (!d.rows.length) { out.innerHTML = `<p class="sub">No composition in the library matches at ${d.temp_c} \u00B0C. Try another temperature.</p>`; return; }
      out.innerHTML = `<p class="sub">${d.screened.toLocaleString()} compositions screened at ${d.temp_c} \u00B0C \u00B7 ${d.matched} match \u00B7 LSC (${esc(d.lsc_formula)}) = ${minus(d.lsc_logk)}</p>
        <div class="tscroll"><table class="dtable"><thead><tr><th>#</th><th>Composition</th><th>log k*</th><th>vs LSC</th><th>E hull</th><th>Stable</th><th>$/kg</th><th></th></tr></thead><tbody>
        ${d.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.formula)}</td><td>${minus(r.logk)}</td><td class="${r.delta >= 0 ? "up" : "down"}">${signed(r.delta)}</td><td>${r.ehull == null ? "n/a" : r.ehull.toFixed(1)}</td><td>${r.stable == null ? "?" : r.stable ? "yes" : "no"}</td><td>${r.price == null ? "n/a" : r.price.toFixed(1)}</td><td><button type="button" data-f="${esc(r.formula)}" data-t="${d.temp_c}">Predict</button></td></tr>`).join("")}
        </tbody></table></div>`;
    } catch (ex) { out.innerHTML = `<div class="msg" role="alert">${esc(ex.message)}</div>`; }
  }
  function wireScreen(which) {
    const pane = $(`#pane-${which}`);
    pane.querySelectorAll(".presets button").forEach(b => b.onclick = () => {
      SCREEN[which].temp = +b.dataset.t;
      pane.querySelectorAll(".presets button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      loadScreen(which);
    });
    const chk = pane.querySelector(".chk input"); if (chk) chk.onchange = () => { SCREEN[which].stable = chk.checked; loadScreen(which); };
    pane.addEventListener("click", e => {
      const b = e.target.closest("button[data-f]"); if (!b) return;
      showTab("predict"); $("#by-name").click();
      $("#formula").value = b.dataset.f; $("#tempname").value = b.dataset.t; $("#tempname").dispatchEvent(new Event("input"));
      $("#nameform").requestSubmit();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".dtabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
    wireScreen("lowt"); wireScreen("cand");
    let t = "predict"; try { t = sessionStorage.getItem("kstar-tab") || "predict"; } catch {}
    showTab(PANES[t] ? t : "predict");
  });
  window.kstarDash = { render };
})();
