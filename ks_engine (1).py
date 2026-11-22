"""K* Star models (from the crystal_kstar project) wired into Perov AI.

What this module provides, all from the K* Star project's own data and models (folder ks/):
  * log k*(T)  : StandardScaler + SVR(rbf, C=100, gamma=0.1) on 16 descriptors incl. 1000/T
                 (kstar_ks_svr.pkl; refitted from Kstar_DataSet_Pro.xlsx if the pickle cannot be read)
  * Band gap, oxygen-vacancy descriptor, E_above_hull, TEC, work function, dielectric, O p-band
                 (enhanced_rf.joblib, a Random Forest on descriptors + A/B element fractions)
  * Price      : price_rf.joblib
  * E_above_hull and TEC are taken from the screened-candidate table / training dataset when the formula is in them
  * Applicability domain (Mahalanobis distance on the 15 composition descriptors)
  * Physics chain (ks_props.py): k* -> D* -> ionic conductivity, Adler-Lane-Steele Rp, ASR
  * Candidate library for the finders (library.parquet when pyarrow is installed, else generated)

Everything is optional: if a file is missing, load() returns False and the app keeps using its own models.
"""
import json
import re
import threading
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import ks_props as P

warnings.filterwarnings("ignore")
HERE = Path(__file__).parent / "ks"
ENH = ["Gap", "Oxide_vacancy", "E_above_hull", "TEC", "Work_Function", "Log_dieletric", "O_pband"]
BASE = ["Ion_A", "Ion_B", "EN_A", "EN_B", "R_A", "R_B", "Sa_A", "Sa_B", "Delec_B", "t", "Ionic_A", "Ionic_B",
        "Avg_Ionic_Character", "SmithAcid_A", "SmithAcid_B"]
FEATURES = BASE + ["1000/T"]
LSC_FORMULA = "La0.6Sr0.4CoO3"
STABLE_EHULL = 57.0
T_MIN, T_MAX = 300.0, 1000.0

STATE = {"ok": False, "error": None}
_S = {}
_lock = threading.Lock()


def _tk(c):
    return 1000.0 / (float(c) + 273.15)


# ---------------------------------------------------------------- loading
def load():
    """Load the light assets. The two big Random Forests load on first use. Returns True when usable."""
    try:
        _S["tab"] = json.loads((HERE / "elements.json").read_text())
        _S["df"] = pd.read_excel(HERE / "Kstar_DataSet_Pro.xlsx")
        sel = pd.read_excel(HERE / "Kstar_Selected_Base.xlsx").drop_duplicates("Material composition")
        sel["Material composition"] = sel["Material composition"].astype(str).str.replace(r"\s+", "", regex=True)
        _S["sel"] = sel.set_index("Material composition")
        known = _S["df"].drop_duplicates("Material composition").copy()
        known["Material composition"] = known["Material composition"].astype(str).str.replace(r"\s+", "", regex=True)
        _S["known"] = known.set_index("Material composition")
        _S["model"] = _load_kstar()
        U = _S["df"].drop_duplicates("Material composition")[BASE].values
        _S["mu"], _S["vi"] = U.mean(0), np.linalg.pinv(np.cov(U.T))
        _S["thr"] = float(np.quantile(_md(U), 0.9))
        dt = 1000.0 / _S["df"]["1000/T"] - 273.15
        _S["trange"] = (float(dt.min()), float(dt.max()))
        try:
            _S["metrics"] = json.loads((HERE / "ks_metrics.json").read_text())
        except Exception:
            _S["metrics"] = None
        STATE.update(ok=True, error=None)
    except Exception as exc:
        STATE.update(ok=False, error=f"{type(exc).__name__}: {exc}")
        print("K* Star engine unavailable:", STATE["error"])
    return STATE["ok"]


def _load_kstar():
    try:
        return joblib.load(HERE / "kstar_ks_svr.pkl")
    except Exception as exc:  # different scikit-learn version, missing file: refit (about a second)
        print("K* Star pickle not used, refitting from the dataset:", exc)
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        from sklearn.svm import SVR
        df = _S["df"]
        return make_pipeline(StandardScaler(), SVR(kernel="rbf", C=100, epsilon=0.1, gamma=0.1)).fit(df[FEATURES], df["LogKstar"])


def ready():
    return bool(STATE["ok"])


def model():
    return _S["model"]


def metrics():
    return _S.get("metrics")


def elements():
    return {s: sorted(_S["tab"][s]) for s in "AB"}


def _heavy(name, fname):
    with _lock:
        if name not in _S:
            _S[name] = joblib.load(HERE / fname)
    return _S[name]


def _enh_model():
    """The enhanced random forest: ks/enhanced_rf.joblib, or the same file split into enhanced_rf.joblib.part1, .part2, ...
    (the parts let you upload it through the GitHub web page, which refuses files over 25 MB)."""
    with _lock:
        if "enh" in _S:
            return _S["enh"]
        one = HERE / "enhanced_rf.joblib"
        if one.exists():
            _S["enh"] = joblib.load(one)
        else:
            import io
            parts = sorted(HERE.glob("enhanced_rf.joblib.part*"), key=lambda p: int(p.name.rsplit("part", 1)[1]))
            if not parts:
                raise FileNotFoundError("ks/enhanced_rf.joblib (or its .part1, .part2 ... pieces) is missing")
            _S["enh"] = joblib.load(io.BytesIO(b"".join(p.read_bytes() for p in parts)))
    return _S["enh"]


# ---------------------------------------------------------------- formula -> descriptors
def parse(formula):
    f = re.sub(r"O\d*\.?\d*$", "", str(formula).replace(" ", "").replace("(", "").replace(")", ""))
    items = [(m[0], float(m[1] or 1)) for m in re.findall(r"([A-Z][a-z]?)([\d.]*)", f)]
    if not items:
        raise ValueError("Could not read the formula. Example: La0.6Sr0.4CoO3")
    a, b, s = {}, {}, 0.0
    for e, x in items:  # the first group that sums to 1 is the A-site, the rest is the B-site
        (a if s < 0.999 else b)[e] = x
        s += x
    if abs(sum(a.values()) - 1) > .02 or abs(sum(b.values()) - 1) > .02:
        raise ValueError("A-site and B-site fractions must each sum to 1 (e.g. La0.6Sr0.4Co0.2Fe0.8O3)")
    tab = _S["tab"]
    for e in a:
        if e not in tab["A"]:
            raise ValueError(f'A-site element {e} is not supported by the K* Star models. Supported: {", ".join(sorted(tab["A"]))}')
    for e in b:
        if e not in tab["B"]:
            raise ValueError(f'B-site element {e} is not supported by the K* Star models. Supported: {", ".join(sorted(tab["B"]))}')
    return a, b


def featurize(formula):
    a, b = parse(formula)
    tab, r = _S["tab"], {}
    for site, comp in (("A", a), ("B", b)):
        for c in tab[site][next(iter(comp))]:
            r[c] = sum(x * tab[site][e][c] for e, x in comp.items())
    r["t"] = (r["R_A"] + 1.40) / (np.sqrt(2) * (r["R_B"] + 1.40))
    r["Avg_Ionic_Character"] = (r["Ionic_A"] + r["Ionic_B"]) / 2
    return r, a, b


def row(r, temp_c):
    x = {k: float(r[k]) for k in BASE}
    x["1000/T"] = _tk(temp_c)
    return x


def _frac(a, b, idx, n):
    v = np.zeros(n)
    for s, comp in (("A", a), ("B", b)):
        for e, x in comp.items():
            v[idx[s + e]] = x
    return v


def _idx(m):
    return {c: i for i, c in enumerate(m["cols"])}


def enhanced(r, a, b):
    m = _enh_model()
    x = np.hstack([[r[k] for k in BASE], _frac(a, b, _idx(m), len(m["cols"]))])
    return dict(zip(ENH, map(float, m["model"].predict([x])[0])))


def price(a, b):
    m = _heavy("price", "price_rf.joblib")
    return float(10 ** m["model"].predict([_frac(a, b, _idx(m), len(m["cols"]))])[0])


# ---------------------------------------------------------------- domain
def _md(X):
    d = X - _S["mu"]
    return np.sqrt(np.einsum("ij,jk,ik->i", d, _S["vi"], d))


def domain(r):
    """Distance of this composition from the training materials (inside = within 1.15 x the 90th-percentile distance)."""
    d = float(_md(np.array([[r[k] for k in BASE]]))[0])
    lim = _S["thr"] * 1.15
    return {"inside": bool(d <= lim), "distance": round(d, 2), "limit": round(lim, 2), "level": 90}


# ---------------------------------------------------------------- one material
def describe(formula):
    """Everything the K* Star models know about one formula (no temperature needed)."""
    key = re.sub(r"\s+", "", str(formula))
    r, a, b = featurize(key)
    ml = enhanced(r, a, b)  # ML values; Gap and the vacancy descriptor always come from here
    e, src = dict(ml), "ML estimate"
    if key in _S["sel"].index:
        s = _S["sel"].loc[key]
        e["E_above_hull"], e["TEC"], src = float(s.iloc[0]), float(s.iloc[1]), "screened-candidate table"
    elif key in _S["known"].index:
        k = _S["known"].loc[key]
        e["E_above_hull"], e["TEC"], src = float(k["E_above_hull"]), float(k["TEC"]), "training dataset"
    dom = domain(r)
    if key in _S["known"].index:  # a material the model was trained on is not an extrapolation
        dom.update(inside=True, in_dataset=True)
    return {"formula": key, "r": r, "a": a, "b": b, "e": e, "ml": ml, "source": src, "domain": dom,
            "price": price(a, b), "measured": measured(key)}


def measured(key, temp_c=None):
    """Closest measured log k* of this exact material in the training data (any temperature)."""
    df = _S["df"]
    m = df[df["Material composition"].astype(str).str.replace(r"\s+", "", regex=True) == key]
    if not len(m):
        return None
    return [{"T": round(1000.0 / float(x["1000/T"]) - 273.15), "logk": round(float(x["LogKstar"]), 3)} for _, x in m.iterrows()]


def measured_near(d, temp_c, within=60):
    ms = d.get("measured") or []
    ms = [x for x in ms if abs(x["T"] - temp_c) <= within]
    return min(ms, key=lambda x: abs(x["T"] - temp_c)) if ms else None


def warnings_for(d, temp_c):
    out = []
    lo, hi = _S["trange"]
    if not lo - 1 <= temp_c <= hi + 1:
        out.append(f"{temp_c:g} \u00b0C is outside the measured range of the k* training data ({lo:.0f} to {hi:.0f} \u00b0C), so this is an extrapolation.")
    if not d["domain"]["inside"]:
        out.append("This composition is far from the materials the k* model was trained on, so treat the value as an extrapolation.")
    return out


def predict_logk(r, temps):
    X = pd.DataFrame([row(r, t) for t in temps])[FEATURES]
    return [float(v) for v in _S["model"].predict(X)]


def _lsc_vac():
    if "lsc_vac" not in _S:
        r, a, b = featurize(LSC_FORMULA)
        _S["lsc_vac"] = enhanced(r, a, b)["Oxide_vacancy"]
    return _S["lsc_vac"]


def bundle(d, temps):
    """log k*, ionic and electronic conductivity, polarization resistance and ASR over temperatures (physics chain)."""
    logk = predict_logk(d["r"], temps)
    p = P.properties(logk, temps, d["ml"]["Gap"], d["ml"]["Oxide_vacancy"], _lsc_vac())
    f = lambda v: [float(x) for x in np.atleast_1d(v)]
    return {"logk": logk, "sigma_i": f(p["sigma_i"]), "sigma_e": f(p["sigma_e"]), "rp": f(p["rp"]), "asr": f(p["asr"]),
            "tec": float(d["e"]["TEC"])}


def asr(rp, sigma_e):
    return [float(x) for x in np.atleast_1d(P.asr_from(rp, sigma_e))]


def background(n=200):
    df = _S["df"][FEATURES]
    return df.sample(n, random_state=0) if len(df) > n else df


# ---------------------------------------------------------------- finders
def _frac_rows(forms, parsed, m):
    idx, n = _idx(m), len(m["cols"])
    return np.array([_frac(a, b, idx, n) for (_, a, b) in parsed])


def _generated_library():
    import props as user_props  # the app's own composition list (a few thousand ABO3 formulas)
    parsed, rs = [], []
    for f in user_props.library():
        try:
            r, a, b = featurize(f)
        except Exception:
            continue
        parsed.append((f, a, b))
        rs.append(r)
    enh, prc = _enh_model(), _heavy("price", "price_rf.joblib")
    Xb = np.array([[r[k] for k in BASE] for r in rs])
    E = enh["model"].predict(np.hstack([Xb, _frac_rows(None, parsed, enh)]))
    lib = pd.DataFrame(Xb, columns=BASE)
    lib.insert(0, "Material composition", [p[0] for p in parsed])
    for i, c in enumerate(ENH):
        lib[c] = E[:, i]
    lib["Price_usd_per_kg"] = 10 ** prc["model"].predict(_frac_rows(None, parsed, prc))
    for i, f in enumerate(lib["Material composition"]):  # use the tables where the formula is in them
        if f in _S["sel"].index:
            s = _S["sel"].loc[f]
            lib.loc[i, "E_above_hull"], lib.loc[i, "TEC"] = float(s.iloc[0]), float(s.iloc[1])
        elif f in _S["known"].index:
            lib.loc[i, "E_above_hull"], lib.loc[i, "TEC"] = float(_S["known"].loc[f, "E_above_hull"]), float(_S["known"].loc[f, "TEC"])
    return lib.drop_duplicates("Material composition").reset_index(drop=True)


def library():
    """Candidate library: ks/library.parquet (92k compositions, needs pyarrow) or, failing that, a generated one."""
    with _lock:
        if "lib" in _S:
            return _S["lib"], _S["lib_src"]
    lib, src = None, "generated"
    try:
        pq = pd.read_parquet(HERE / "library.parquet")
        need = {"Material composition", "E_above_hull", "TEC", "Price_usd_per_kg", *BASE}
        if need <= set(pq.columns):
            lib, src = pq, "library.parquet"
    except Exception as exc:
        print("library.parquet not used (", type(exc).__name__, "):", exc)
    if lib is None:
        lib = _generated_library()
    lib = lib.reset_index(drop=True)
    lib["md_ratio"] = _md(lib[BASE].values.astype(float)) / _S["thr"]
    with _lock:
        _S["lib"], _S["lib_src"] = lib, src
    return lib, src


def lsc_logk(temp_c):
    r, _, _ = featurize(LSC_FORMULA)
    return predict_logk(r, [temp_c])[0]


def screen(temp_c, stable_only=False, min_delta=None, limit=25, max_md=2.2):
    lib, src = library()
    key = round(float(temp_c))
    ck = ("logk", key)
    if ck not in _S:
        X = lib[BASE].copy()
        X["1000/T"] = _tk(key)
        _S[ck] = _S["model"].predict(X[FEATURES])
    logk = _S[ck]
    ref = lsc_logk(key)
    keep = (lib["md_ratio"].values <= max_md)
    n_eval = int(keep.sum())
    if stable_only:
        keep &= lib["E_above_hull"].values <= STABLE_EHULL
    if min_delta is not None:
        keep &= (logk - ref) >= min_delta
    idx = np.flatnonzero(keep)
    idx = idx[np.argsort(-logk[idx])]
    rows = []
    for i in idx[:limit]:
        x = lib.iloc[i]
        rows.append({"formula": str(x["Material composition"]), "logk": round(float(logk[i]), 2), "delta": round(float(logk[i] - ref), 2),
                     "ehull": round(float(x["E_above_hull"]), 1), "stable": bool(x["E_above_hull"] <= STABLE_EHULL),
                     "price": round(float(x["Price_usd_per_kg"]), 1), "tec": round(float(x["TEC"]), 2),
                     "conf": "High" if x["md_ratio"] <= 1.15 else "Medium"})
    return {"temp_c": key, "lsc_logk": round(float(ref), 2), "n": n_eval, "matched": int(len(idx)), "rows": rows,
            "library": src, "library_size": int(len(lib))}


def training_rows():
    """The measured training rows in real units (reference rows for SHAP)."""
    return _S["df"][FEATURES]
