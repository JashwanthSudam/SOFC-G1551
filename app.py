"""
Perov AI: Flask backend for the perovskite oxygen-exchange model.

Loads the models saved at the end of the notebook (ps_1.ipynb):
  models/perovskite_svr_pipeline.pkl   StandardScaler + SVR(rbf, C=10, epsilon=0.1)   (required)
  models/perovskite_rf_model.pkl       RandomForestRegressor(n_estimators=100)         (optional)

Run:  python app.py   ->  http://127.0.0.1:5000
"""
import datetime
import hmac
import json
import math
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path

import joblib
import numpy as np
import auth
import composition
import ks_engine
import pandas as pd
import sklearn
import props
import stability
import train as trainer
from flask import Flask, jsonify, request

BASE = Path(__file__).parent
try:
    from predict_both import other_properties
except Exception as exc:
    print("Extra properties unavailable:", exc)
    def other_properties(*args, **kwargs):
        return None
# Reference values for the result summary. Change them here or with environment variables.
LSC_LOG_KSTAR = float(os.environ.get("LSC_LOG_KSTAR", "-6.40"))      # log10 k* of the LSC benchmark
EHULL_STABLE_MAX = float(os.environ.get("EHULL_STABLE_MAX", "57"))   # E_above_hull limit for "stable"

# Indian Standard Time (UTC+05:30, no daylight saving)
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30), "IST")


def to_ist(value):
    """Convert a stored timestamp (ISO string; naive values treated as UTC) to a readable IST string."""
    try:
        dt = datetime.datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(IST).strftime("%d %b %Y, %I:%M:%S %p IST")
    except Exception:
        return None
MODEL_DIR = BASE / "models"
SVR_PATH = MODEL_DIR / "perovskite_svr_pipeline.pkl"
RF_PATH = MODEL_DIR / "perovskite_rf_model.pkl"

# Position of the result marker on the "slower -> faster" scale in the UI.
# Replace with the min / max of LogKstar in your dataset.
LOGK_SCALE = (-9.0, -4.0)  # fallback; overridden by models/meta.json written by train.py
RANGES, EXAMPLES = {}, []


def load_meta():
    global LOGK_SCALE, RANGES, EXAMPLES
    try:
        meta = json.loads((MODEL_DIR / "meta.json").read_text())
        LOGK_SCALE, RANGES = tuple(meta["logk_scale"]), meta.get("ranges", {})
    except Exception:
        pass
    try:
        EXAMPLES = json.loads((MODEL_DIR / "examples.json").read_text())
    except Exception:
        EXAMPLES = []


# Temperature sweep used for the Arrhenius-style chart (degrees C).
SWEEP_C = list(range(600, 1001, 50))

# Starting values: first row of Kstar_DataSet_Pro.xlsx (La0.9Sr0.1Ga0.8Mg0.2O3 at 1000/T = 0.852).
EXAMPLE = {
    "Ion_A": 18.365,
    "Ion_B": 25.406,
    "EN_A": 1.2118,
    "EN_B": 1.71,
    "R_A": 1.368,
    "R_B": 0.64,
    "Sa_A": 0.3309,
    "Sa_B": 0.5868,
    "Delec_B": 0.0,
    "t": 0.9594,
    "Ionic_A": 0.7529,
    "Ionic_B": 0.7037,
    "Avg_Ionic_Character": 0.7283,
    "SmithAcid_A": -6.43,
    "SmithAcid_B": -2.18,
    "1000/T": 0.852,
    "Gap": 5.3114,
    "Oxide_vacancy": -5.6757,
    "E_above_hull": 101.6109,
    "TEC": 13.5824,
    "Work_Function": 2.9974,
    "Log_dieletric": 1.189,
    "O_pband": -2.0251,
}

# Short hints shown under inputs. Edit freely; missing names just show no hint.
HINTS = {
    "t": "Goldschmidt tolerance factor",
    "1000/T": "Inverse temperature, 1000 / T(K)",
    "Sa_A": "Lewis acidity, A-site",
    "Sa_B": "Lewis acidity, B-site",
    "SmithAcid_A": "Smith acidity, A-site",
    "SmithAcid_B": "Smith acidity, B-site",
    "Delec_B": "d-electron count, B-site",
    "Log_dieletric": "Log of dielectric constant",
    "Gap": "Band gap",
    "E_above_hull": "Energy above the convex hull",
    "TEC": "Thermal expansion coefficient",
    "Work_Function": "Work function",
    "O_pband": "Oxygen p-band centre",
    "Oxide_vacancy": "Oxygen vacancy descriptor",
    "EN_A": "Electronegativity, A-site",
    "EN_B": "Electronegativity, B-site",
    "R_A": "Radius, A-site",
    "R_B": "Radius, B-site",
}

# Units shown next to every descriptor (None = dimensionless). Edit freely.
UNITS = {
    "Ion_A": "eV", "Ion_B": "eV",
    "EN_A": None, "EN_B": None,
    "R_A": "\u00c5", "R_B": "\u00c5",
    "Sa_A": "v.u.", "Sa_B": "v.u.",
    "Delec_B": "electrons",
    "t": None,
    "Ionic_A": None, "Ionic_B": None, "Avg_Ionic_Character": None,
    "SmithAcid_A": None, "SmithAcid_B": None,
    "1000/T": "10\u00b3 K\u207b\u00b9",
    "Gap": "eV",
    "Oxide_vacancy": "eV",
    "E_above_hull": "meV/atom",
    "TEC": "10\u207b\u2076 K\u207b\u00b9",
    "Work_Function": "eV",
    "Log_dieletric": None,
    "O_pband": "eV",
}


def unit_of(name):
    return UNITS.get(name) or ""


def check_training_range(df):
    """Refuse inputs outside the range the model was trained on (min and max of each descriptor)."""
    bad = []
    for n, (lo, hi) in RANGES.items():
        if n not in df.columns:
            continue
        v = float(df.iloc[0][n])
        tol = 1e-6 * max(1.0, abs(lo), abs(hi))  # absorbs float rounding at the edges
        if lo - tol <= v <= hi + tol:
            continue
        if n == "1000/T":  # say it in degrees C, which is what people type
            t = 1000.0 / v - 273.15
            bad.append(f"Temperature = {t:.0f} \u00b0C (allowed {1000.0 / hi - 273.15:.0f} to {1000.0 / lo - 273.15:.0f} \u00b0C)")
        else:
            u = f" {unit_of(n)}" if unit_of(n) else ""
            bad.append(f"{n} = {v:g}{u} (allowed {lo:.4g} to {hi:.4g}{u})")
    if bad:
        raise ValueError("Out of training range, so no prediction was made: " + "; ".join(bad) + ".")


app = Flask(__name__, static_folder="static", static_url_path="")

_state = {"svr": None, "rf": None, "csvr": None, "crf": None, "tables": None, "explainer": None, "error": None, "ks": False}


def load_models():
    load_meta()
    _BG.clear()
    _DOM.clear()
    _STAB.clear()
    _state["error"] = None
    try:
        _state["svr"] = joblib.load(SVR_PATH)
    except FileNotFoundError:
        _state["error"] = (
            f"Model file not found: {SVR_PATH.relative_to(BASE)}. "
            "Copy perovskite_svr_pipeline.pkl from your notebook folder into models/."
        )
    except Exception as exc:  # version mismatch, corrupt file, ...
        _state["error"] = f"Could not load {SVR_PATH.name}: {exc}"
    for key, name in (("csvr", "perovskite_comp_svr_pipeline.pkl"), ("crf", "perovskite_comp_rf_model.pkl")):
        try:
            _state[key] = joblib.load(MODEL_DIR / name)
        except Exception:
            _state[key] = None
    try:
        _state["tables"] = json.loads((MODEL_DIR / "elements.json").read_text())
    except Exception:
        _state["tables"] = None
    if RF_PATH.exists():
        try:
            _state["rf"] = joblib.load(RF_PATH)
        except Exception:
            _state["rf"] = None
    try:  # the K* Star models (ks/ folder); the app works without them
        _state["ks"] = ks_engine.load()
    except Exception as exc:
        print("K* Star models skipped:", exc)
        _state["ks"] = False


def default_engine():
    """Which model the name-based prediction uses when the request does not say: the K* Star models if loaded."""
    return "ks" if _state.get("ks") else "svr"


def features():
    return list(_state["svr"].feature_names_in_)


def group_of(name):
    if name == "1000/T":
        return "Conditions"
    if name.endswith("_A"):
        return "A-site"
    if name.endswith("_B"):
        return "B-site"
    return "Structure and properties"


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/schema")
def schema():
    if _state["error"]:
        return jsonify(error=_state["error"]), 503
    names = features()
    return jsonify(
        features=[
            {
                "name": n,
                "group": group_of(n),
                "default": EXAMPLE.get(n),
                "hint": HINTS.get(n, ""),
                "unit": unit_of(n),
            }
            for n in names
        ],
        models={"svr": True, "rf": _state["rf"] is not None, "ks": bool(_state.get("ks"))},
        default_model=default_engine(),
        ks_elements=ks_engine.elements() if _state.get("ks") else None,
        ks_metrics=ks_engine.metrics() if _state.get("ks") else None,
        scale=LOGK_SCALE,
        examples=EXAMPLES,
        composition=(_state["csvr"] is not None and _state["tables"] is not None) or bool(_state.get("ks")),
        elements={s: sorted(_state["tables"][s]) for s in "AB"} if _state["tables"] else None,
        units={n: unit_of(n) for n in names},
        ranges=RANGES,
        has_temperature="1000/T" in names,
        sklearn_version=sklearn.__version__,
    )


def frame_from(values):
    names = features()
    row, missing = {}, []
    for n in names:
        raw = values.get(n)
        try:
            v = float(raw)
        except (TypeError, ValueError):
            missing.append(n)
            continue
        if not math.isfinite(v):
            missing.append(n)
            continue
        row[n] = v
    if missing:
        raise ValueError("Enter a number for: " + ", ".join(missing))
    return pd.DataFrame([row], columns=names)  # column order = training order


_BG = {}  # SHAP reference rows, cached per feature set


def background_for(columns):
    """Training rows (models/processed/X_train.npy, in real units) limited to this model's columns."""
    key = tuple(columns)
    if key not in _BG:
        try:
            # X_train.npy is stored standardized (scaled with the SVR pipeline's scaler); undo that
            # so the reference rows are in real feature units like the values being explained.
            X = np.load(MODEL_DIR / "processed" / "X_train.npy").astype(float)
            X = _state["svr"].named_steps["standardscaler"].inverse_transform(X)
            names = list(_state["svr"].feature_names_in_)
            bg = pd.DataFrame(X[:, [names.index(c) for c in columns]], columns=list(columns))
            if len(bg) > 200:  # keep it fast; fixed seed so results are repeatable
                bg = bg.sample(200, random_state=0)
            _BG[key] = bg
        except Exception:
            _BG[key] = None
    return _BG[key]


def explain_prediction(model, df, bg=None):
    """SHAP values (permutation Shapley, the same method as shap.PermutationExplainer) for one row.

    Each training row is used once as the reference, walked in a random feature order and in the
    reverse order. Contributions then add up exactly: base_value + sum(contributions) = prediction.
    Works for the SVR pipeline and the Random Forest without the shap package.
    """
    try:
        if bg is None:
            bg = background_for(df.columns)
        if bg is None or len(bg) < 5:
            return None
        cols, d = list(df.columns), df.shape[1]
        x, B = df.iloc[0].to_numpy(float), bg.to_numpy(float)
        rng = np.random.default_rng(0)
        walks, refs = [], []
        for b in B:
            p = rng.permutation(d)
            walks += [p, p[::-1]]
            refs += [b, b]
        rows = np.empty((len(walks) * (d + 1), d))
        for i, (p, b) in enumerate(zip(walks, refs)):
            cur, k0 = b.copy(), i * (d + 1)
            rows[k0] = cur
            for k, j in enumerate(p):
                cur[j] = x[j]
                rows[k0 + k + 1] = cur
        preds = model.predict(pd.DataFrame(rows, columns=cols)).reshape(len(walks), d + 1)
        phi = np.zeros(d)
        for i, p in enumerate(walks):
            phi[p] += preds[i, 1:] - preds[i, :-1]
        phi /= len(walks)
        order = np.argsort(-np.abs(phi))
        return {
            "method": "Shapley values over the training data (permutation SHAP)",
            "base_value": float(preds[:, 0].mean()),
            "prediction": float(preds[:, -1].mean()),
            "n_background": int(len(B)),
            "features": [{"feature": cols[i], "value": float(x[i]), "contribution": float(phi[i])} for i in order],
        }
    except Exception as exc:
        print("SHAP explanation skipped:", exc)
        return None


_DOM = {}  # applicability-domain ellipsoid, cached per feature set
_STAB = {}  # stability model, fitted on first use


def _raw_rows():
    """All training rows (train, validation, test) in real feature units."""
    names = list(_state["svr"].feature_names_in_)
    sc = _state["svr"].named_steps["standardscaler"]
    X = np.vstack([np.load(MODEL_DIR / "processed" / f"X_{s}.npy").astype(float) for s in ("train", "val", "test")])
    return pd.DataFrame(sc.inverse_transform(X), columns=names)


def _stability_model():
    if "m" not in _STAB:
        try:
            cols = [c for c in _state["csvr"].feature_names_in_ if c != "1000/T"]
            _STAB["m"] = stability.load_or_fit(_raw_rows(), cols, MODEL_DIR, EHULL_STABLE_MAX)
        except Exception as exc:
            print("Stability model unavailable:", exc)
            _STAB["m"] = None
    return _STAB["m"]



def _domain_model(columns):
    key = tuple(columns)
    if key not in _DOM:
        bg = background_for(columns)
        if bg is None or len(bg) < 10:
            _DOM[key] = None
        else:
            from sklearn.covariance import LedoitWolf
            X = bg.to_numpy(float)
            mu, sd = X.mean(0), X.std(0)
            sd[sd == 0] = 1.0
            Z = (X - mu) / sd
            P = LedoitWolf().fit(Z).precision_
            dist = np.sqrt(np.einsum("ij,jk,ik->i", Z, P, Z))
            _DOM[key] = (mu, sd, P, float(np.percentile(dist, 95)), len(X))
    return _DOM[key]


def domain_check(df):
    """Is this input inside the ellipsoid (Mahalanobis distance) that holds 95% of the training materials?"""
    try:
        m = _domain_model(df.columns)
        if m is None:
            return None
        mu, sd, P, limit, n = m
        z = (df.iloc[0].to_numpy(float) - mu) / sd
        dist = float(np.sqrt(max(z @ P @ z, 0.0)))
        return {"inside": bool(dist <= limit), "distance": round(dist, 2), "limit": round(limit, 2),
                "level": 95, "n_background": n}
    except Exception as exc:
        print("Domain check skipped:", exc)
        return None


def assess(df, y):
    """The at-a-glance verdicts shown next to a prediction."""
    out = {"benchmark": {"name": "LSC", "threshold": LSC_LOG_KSTAR, "superior": bool(y > LSC_LOG_KSTAR),
                         "margin": round(y - LSC_LOG_KSTAR, 3)},
           "stability": None, "domain": domain_check(df)}
    if "E_above_hull" in df.columns:  # the person entered it
        eh = float(df["E_above_hull"].iloc[0])
        out["stability"] = {"kind": "input", "ehull": eh, "limit": EHULL_STABLE_MAX,
                            "stable": bool(eh <= EHULL_STABLE_MAX)}
    else:  # predict it from the composition
        try:
            m = _stability_model()
            if m is not None:
                out["stability"] = stability.predict(m[0], m[1], m[2], df)
        except Exception as exc:
            print("Stability prediction skipped:", exc)
    return out


def respond(df, which, svr, rf, extra_warnings=(), bg=None, assessment=None, ranges=None):
    model = rf if which == "rf" else svr
    t0 = time.perf_counter()
    y = float(model.predict(df)[0])
    latency_ms = (time.perf_counter() - t0) * 1000

    explain = explain_prediction(model, df, bg)
    trace = {"columns": list(df.columns), "latency_ms": round(latency_ms, 2)}
    if which == "svr":
        scaler = svr.named_steps["standardscaler"]
        est = svr.named_steps["svr"]
        z = scaler.transform(df)[0]
        trace.update(
            scaled=[float(v) for v in z],
            n_support_vectors=int(len(est.support_)),
            params={"kernel": est.kernel, "C": est.C, "epsilon": est.epsilon},
        )
    else:
        trace.update(n_trees=int(len(model.estimators_)), contributions=explain["features"][:10] if explain else None)

    sweep = None
    if "1000/T" in df.columns:
        rows = []
        for c in SWEEP_C:
            r = df.iloc[0].copy()
            r["1000/T"] = 1000.0 / (c + 273.15)
            rows.append(r)
        sy = model.predict(pd.DataFrame(rows, columns=df.columns))
        sweep = [
            {"temp_c": c, "inv_t": float(1000.0 / (c + 273.15)), "log_kstar": float(v)}
            for c, v in zip(SWEEP_C, sy)
        ]

    warnings = list(extra_warnings) + [
        f"{n} = {df.iloc[0][n]:g} is outside the training range ({lo:g} to {hi:g})"
        for n, (lo, hi) in (RANGES if ranges is None else ranges).items()
        if n in df.columns and not (lo <= df.iloc[0][n] <= hi)
    ]
    return {
        "model": which, "warnings": warnings, "log_kstar": y,
        "kstar": float(10.0 ** y),  # assumes LogKstar is log10
        "units": {c: unit_of(c) for c in df.columns},
        "sweep": sweep, "trace": trace, "explain": explain, "assessment": assessment if assessment is not None else assess(df, y),
    }


# ---------------------------------------------------------------- Predict-page analysis (properties, LSC comparison)
_LSC = {}        # (model, temperature) -> bundle of the LSC benchmark
_IMPORT = {}     # model-wide SHAP importance, computed once
_SCREEN = {}     # candidate screening results per temperature
TABLE_T = [400, 500, 600, 700, 800]
CHART_T = list(range(300, 901, 50))


def _ml_extra(formula, temps, which):
    """ML conductivity (log10 S/cm, in air) at each temperature, and TEC. (None, None) if unavailable."""
    try:
        import predict_both as pb
        f = pb.featurize(formula)
        suf = pb._suffix(which)
        avg = [f[k] for k in pb.AVG]
        X = np.array([avg + [1000.0 / (t + 273.15), 0.21, 0.0, 0] for t in temps])
        cond = [float(v) for v in pb._load(f"conductivity_{suf}.pkl").predict(X)]
        tec = float(pb._load(f"tec_{suf}.pkl").predict(np.array([avg]))[0])
        return cond, tec
    except Exception as exc:
        print("ML conductivity/TEC skipped:", exc)
        return None, None


def _bundle(formula, temps, which, desc=None):
    """log k*, ionic and other conductivity, polarization resistance and ASR for one formula over temperatures."""
    if which == "ks":  # K* Star models: k*, ionic conductivity, Rp and TEC from ks_engine
        d = desc or ks_engine.describe(formula)
        out = ks_engine.bundle(d, temps)
        cond, _ = _ml_extra(formula, temps, "svr")  # measured-data conductivity model of this app, if it can read the formula
        out["sigma_e_src"] = "physics"
        if cond:
            out["sigma_e"] = [10.0 ** c for c in cond]
            out["asr"] = ks_engine.asr(out["rp"], out["sigma_e"])
            out["sigma_e_src"] = "ml"
        return out
    model = _state["crf"] if which == "rf" and _state["crf"] is not None else _state["csvr"]
    cols = list(_state["csvr"].feature_names_in_)
    rows = [composition.descriptors(formula, t, _state["tables"])[0] for t in temps]
    logk = [float(v) for v in model.predict(pd.DataFrame(rows, columns=cols))]
    cond, tec = _ml_extra(formula, temps, which)
    sig_i = [props.sigma_ionic(k, t) for k, t in zip(logk, temps)]
    sig_e = [10.0 ** c for c in cond] if cond else [None] * len(temps)
    rp = [props.r_polarization(k, t) for k, t in zip(logk, temps)]
    asr = [props.asr_total(r, se) for r, se in zip(rp, sig_e)]
    return {"logk": logk, "sigma_i": sig_i, "sigma_e": sig_e, "rp": rp, "asr": asr, "tec": tec}


def _lsc_bundle(temps, which):
    miss = [t for t in temps if (which, t) not in _LSC]
    if miss:
        try:
            b = _bundle(props.LSC_FORMULA, miss, which)
            for i, t in enumerate(miss):
                _LSC[(which, t)] = {k: (v[i] if isinstance(v, list) else v) for k, v in b.items()}
        except Exception as exc:
            print("LSC reference unavailable:", exc)
            return None
    return {k: [_LSC[(which, t)][k] for t in temps] for k in ("logk", "sigma_i", "sigma_e", "rp", "asr")}


def _dataset_ehull(feats):
    """E_above_hull of this exact material when it is in the training data, else None."""
    try:
        raw = _raw_rows()
        cols = [c for c in feats if c != "1000/T"]
        d = np.abs(raw[cols].to_numpy(float) - np.array([feats[c] for c in cols])).max(axis=1)
        i = int(d.argmin())
        return float(raw["E_above_hull"].iloc[i]) if d[i] < 1e-3 else None
    except Exception:
        return None


def _ks_backend(d, temp, at, sigma_e_src):
    """Developer view: how every output other than k* was produced (code, inputs, output), like the k* stages."""
    import ks_props as KP
    T = float(temp) + 273.15
    ml = d["ml"]
    vref = ks_engine._lsc_vac()
    k = 10.0 ** at["logk"]
    fv = float(np.clip(np.exp(-(ml["Oxide_vacancy"] - vref) / (2 * KP.KB * T)), 0.2, 5.0))
    D = k * KP.LC0 * fv
    ea = 0.03 + 0.20 * max(ml["Gap"] - 1.0, 0.0)
    g = lambda v: None if v is None else float(f"{float(v):.4g}")
    try:
        trees = len(ks_engine._enh_model()["model"].estimators_)
    except Exception:
        trees = None
    eh = float(d["e"]["E_above_hull"])
    st = [
        {"key": "sigma_i", "title": "Ionic conductivity", "sub": "physics estimate from k*",
         "code": "f_vac   = clip(exp(-(E_vac - E_vac_LSC) / (2 kB T)), 0.2, 5)\nD*      = k* * Lc0 * f_vac        # Lc0 = 5e-3 cm\nsigma_i = 4 F^2 c_O D* / (R T)      # Nernst-Einstein",
         "inputs": {"log_kstar": g(at["logk"]), "T_K": round(T, 2), "oxide_vacancy_descriptor": g(ml["Oxide_vacancy"]),
                    "vacancy_descriptor_LSC": g(vref), "Lc0_cm": KP.LC0, "c_O_mol_cm3": KP.CO},
         "output": {"f_vac": g(fv), "D_star_cm2_s": g(D), "sigma_ionic_S_cm": g(at["sigma_i"])},
         "kv": {"type": "physics estimate (not trained)", "feeds": "polarization resistance"}},
    ]
    if sigma_e_src == "ml":
        st.append({"key": "sigma_e", "title": "Electronic conductivity", "sub": "trained conductivity model",
                   "code": "X = [avg_* descriptors from the formula, 1000/T, pO2 = 0.21, pH2O = 0, carrier = 0]\nlog10_sigma = conductivity_svr_pipeline.predict(X)\nsigma_e = 10 ** log10_sigma",
                   "inputs": {"formula": d["formula"], "T_K": round(T, 2), "1000/T": g(1000.0 / T), "pO2_atm": 0.21},
                   "output": {"sigma_electronic_S_cm": g(at["sigma_e"])},
                   "kv": {"type": "ML (measured conductivity data)", "model": "conductivity_svr_pipeline.pkl"}})
    else:
        st.append({"key": "sigma_e", "title": "Electronic conductivity", "sub": "physics estimate from the band gap",
                   "code": "Ea      = 0.03 + 0.20 * max(Gap - 1, 0)   # eV\nsigma_e = (A_E / T) * exp(-Ea / (kB T))        # small polaron",
                   "inputs": {"Gap_eV": g(ml["Gap"]), "T_K": round(T, 2), "A_E_S_K_cm": KP.A_E},
                   "output": {"Ea_eV": g(ea), "sigma_electronic_S_cm": g(at["sigma_e"])},
                   "kv": {"type": "physics estimate (not trained)", "gap_from": "enhanced random forest"}})
    st += [
        {"key": "tec", "title": "Thermal expansion (TEC)", "sub": d["source"],
         "code": "if the formula is in the screened table or training data: use the stored value\nelse: TEC = enhanced_rf.predict([15 descriptors + A/B element fractions])",
         "inputs": {"formula": d["formula"], "A_site": d["a"], "B_site": d["b"]},
         "output": {"TEC_1e-6_per_K": g(at["tec"])},
         "kv": {"type": "ML" if d["source"] == "ML estimate" else "stored value", "source": d["source"], "trees": trees}},
        {"key": "rp", "title": "Polarization resistance", "sub": "Adler-Lane-Steele model",
         "code": "Rp = (R T / 4F^2) * sqrt( tau / ((1 - eps) * Av * c_O^2 * D* * k*) )",
         "inputs": {"k_star_cm_s": g(k), "D_star_cm2_s": g(D), "T_K": round(T, 2), "tau": KP.TAU, "eps": KP.EPS, "Av_1_cm": KP.AV, "c_O_mol_cm3": KP.CO},
         "output": {"Rp_ohm_cm2": g(at["rp"])},
         "kv": {"type": "physics estimate (not trained)", "uses": "D* from the ionic conductivity stage"}},
        {"key": "asr", "title": "ASR", "sub": "area specific resistance",
         "code": "ASR = Rp + THK * tau / ((1 - eps) * sigma_e)   # 10 um cathode layer",
         "inputs": {"Rp_ohm_cm2": g(at["rp"]), "sigma_e_S_cm": g(at["sigma_e"]), "THK_cm": KP.THK, "tau": KP.TAU, "eps": KP.EPS},
         "output": {"ASR_ohm_cm2": g(at["asr"])},
         "kv": {"type": "physics estimate (not trained)", "electronic_part_from": "ML conductivity model" if sigma_e_src == "ml" else "band-gap estimate"}},
        {"key": "ehull", "title": "E above hull, price and enhanced descriptors", "sub": d["source"],
         "code": "x = [15 composition descriptors, A/B element fractions]\nGap, Oxide_vacancy, E_above_hull, TEC, Work_Function, Log_dieletric, O_pband = enhanced_rf.predict([x])\nprice = 10 ** price_rf.predict([A/B element fractions])\nstable = E_above_hull <= 57 meV/atom",
         "inputs": {"formula": d["formula"], "A_site": d["a"], "B_site": d["b"]},
         "output": {"E_above_hull_meV_atom": g(eh), "stable": bool(eh <= EHULL_STABLE_MAX), "price_usd_per_kg": g(d["price"]),
                    "Gap_eV": g(ml["Gap"]), "Oxide_vacancy": g(ml["Oxide_vacancy"]), "Work_Function": g(ml["Work_Function"]),
                    "Log_dieletric": g(ml["Log_dieletric"]), "O_pband": g(ml["O_pband"])},
         "kv": {"type": "ML" if d["source"] == "ML estimate" else "stored value", "source": d["source"], "trees": trees,
                "in_domain": d["domain"].get("inside")}},
    ]
    return st


def build_analysis(formula, temp, sites, feats, which, out, ks=None):
    try:
        temps = sorted(set(CHART_T + TABLE_T + [round(float(temp))]))
        sel = temps.index(round(float(temp)))
        mine = _bundle(formula, temps, which, ks)
        lsc = _lsc_bundle(temps, which)
        at = {k: (v[sel] if isinstance(v, list) else v) for k, v in mine.items()}
        ref = {k: lsc[k][sel] for k in lsc} if lsc else None
        stab = (out.get("assessment") or {}).get("stability") or {}
        if ks:
            eh, source = float(ks["e"]["E_above_hull"]), ks["source"]
        else:
            eh = _dataset_ehull(feats)
            source = "training dataset" if eh is not None else "ML prediction"
            if eh is None and stab.get("ehull") is not None:
                eh = float(stab["ehull"])
        limit = EHULL_STABLE_MAX
        vs = None
        if ref:
            vs = {
                "logk": round(at["logk"] - ref["logk"], 2),
                "sigma_i": props.versus(at["sigma_i"], ref["sigma_i"], True),
                "sigma_e": props.versus(at["sigma_e"], ref["sigma_e"], True),
                "rp": props.versus(at["rp"], ref["rp"], False),
                "asr": props.versus(at["asr"], ref["asr"], False),
            }
        delta = vs["logk"] if vs else at["logk"] - LSC_LOG_KSTAR
        result = {
            "temp_c": float(temp), "temps": temps, "table_temps": TABLE_T, "low_t_max": props.LOW_T_MAX,
            "low_t": float(temp) <= props.LOW_T_MAX, "series": mine, "lsc": lsc, "at": at, "lsc_at": ref, "vs": vs,
            "delta": round(delta, 2), "rating": props.rating(delta), "lsc_formula": props.LSC_FORMULA,
            "ehull": None if eh is None else round(eh, 1), "ehull_source": source, "ehull_limit": limit,
            "stability_band": None if eh is None else props.stability_band(eh, limit),
            "p_stable": stab.get("p_stable"),
            "price": props.price_per_kg(sites["A"], sites["B"]), "engine": "ks" if ks else "perov",
        }
        if ks:
            e = ks["e"]
            result.update(
                price=round(ks["price"], 1), domain=ks["domain"], in_dataset=bool(ks["domain"].get("in_dataset")),
                measured=ks_engine.measured_near(ks, float(temp)),
                extra={"gap": e["Gap"], "oxide_vacancy": e["Oxide_vacancy"], "work_function": e["Work_Function"],
                       "dielectric": e["Log_dieletric"], "o_pband": e["O_pband"]})
            try:
                result["backend"] = _ks_backend(ks, float(temp), at, mine.get("sigma_e_src"))
            except Exception as exc:
                print("Developer backend trace skipped:", exc)
        return result
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print("Analysis skipped:", exc)
        return None


def model_importance():
    """Mean |SHAP| over a sample of training materials, for the composition model. Cached in memory and on disk."""
    if "v" in _IMPORT:
        return _IMPORT["v"]
    f = MODEL_DIR / "shap_importance.json"
    try:
        _IMPORT["v"] = json.loads(f.read_text())
        return _IMPORT["v"]
    except Exception:
        pass
    try:
        model = _state["csvr"]
        cols = list(model.feature_names_in_)
        raw = _raw_rows()
        have = [c for c in cols if c in raw.columns]
        sample = raw.sample(min(30, len(raw)), random_state=0)
        tot, n = {c: 0.0 for c in cols}, 0
        for _, r in sample.iterrows():
            row = pd.DataFrame([[float(r[c]) for c in cols]], columns=cols)
            ex = explain_prediction(model, row)
            if not ex:
                continue
            for it in ex["features"]:
                tot[it["feature"]] += abs(it["contribution"])
            n += 1
        v = sorted(({"feature": c, "importance": tot[c] / n} for c in cols), key=lambda x: -x["importance"]) if n else None
        _IMPORT["v"] = {"n": n, "features": v} if v else None
        if v:
            try:
                f.write_text(json.dumps(_IMPORT["v"]))
            except Exception:
                pass
    except Exception as exc:
        print("Model-wide SHAP skipped:", exc)
        _IMPORT["v"] = None
    return _IMPORT["v"]


def model_importance_ks():
    """Mean |SHAP| of the K* Star k* model over a sample of its training rows. Cached in memory and on disk."""
    if "ks" in _IMPORT:
        return _IMPORT["ks"]
    f = BASE / "ks" / "shap_importance.json"
    try:
        _IMPORT["ks"] = json.loads(f.read_text())
        return _IMPORT["ks"]
    except Exception:
        pass
    try:
        model, bg, cols = ks_engine.model(), ks_engine.background(), ks_engine.FEATURES
        sample = ks_engine.training_rows().sample(30, random_state=0)
        tot, n = {c: 0.0 for c in cols}, 0
        for _, r in sample.iterrows():
            ex = explain_prediction(model, pd.DataFrame([[float(r[c]) for c in cols]], columns=cols), bg)
            if not ex:
                continue
            for it in ex["features"]:
                tot[it["feature"]] += abs(it["contribution"])
            n += 1
        v = {"n": n, "features": sorted(({"feature": c, "importance": tot[c] / n} for c in cols), key=lambda x: -x["importance"])} if n else None
        _IMPORT["ks"] = v
        if v:
            try:
                f.write_text(json.dumps(v))
            except Exception:
                pass
    except Exception as exc:
        print("K* Star SHAP importance skipped:", exc)
        _IMPORT["ks"] = None
    return _IMPORT["ks"]


def screen_library(temp):
    """Rank the built-in composition library at one temperature. Cached."""
    key = round(float(temp))
    if key in _SCREEN:
        return _SCREEN[key]
    cols = list(_state["csvr"].feature_names_in_)
    rows, names, price = [], [], []
    for fm in props.library():
        try:
            feats, sites, _ = composition.descriptors(fm, key, _state["tables"])
        except Exception:
            continue
        rows.append(feats)
        names.append(fm)
        price.append(props.price_per_kg(sites["A"], sites["B"]))
    df = pd.DataFrame(rows, columns=cols)
    y = _state["csvr"].predict(df)
    m = _stability_model()
    eh = m[0].predict(df[m[2]]) if m else [None] * len(df)
    lsc = _lsc_bundle([key], "svr")
    ref = lsc["logk"][0] if lsc else LSC_LOG_KSTAR
    res = []
    for fm, k, e, p in zip(names, y, eh, price):
        res.append({"formula": fm, "logk": round(float(k), 2), "delta": round(float(k) - ref, 2),
                    "ehull": None if e is None else round(float(e), 1),
                    "stable": None if e is None else bool(e <= EHULL_STABLE_MAX),
                    "price": None if p is None else round(p, 1)})
    res.sort(key=lambda r: -r["logk"])
    _SCREEN[key] = {"temp_c": key, "lsc_logk": round(float(ref), 2), "n": len(res), "rows": res}
    return _SCREEN[key]


def _save(user, *args):
    """Save a search to history. Never breaks the prediction; tells the page whether it worked."""
    try:
        sid = auth.add_search(user["id"], *args)
        return {"ok": True, "id": sid, "time_ist": datetime.datetime.now(IST).strftime("%d %b %Y, %I:%M:%S %p IST")}
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(exc)}


@app.post("/api/predict")
def predict():
    user, deny = need_user()
    if deny:
        return deny
    if _state["error"]:
        return jsonify(error=_state["error"]), 503
    body = request.get_json(silent=True) or {}
    which = body.get("model", "svr")
    if which == "rf" and _state["rf"] is None:
        return jsonify(error="The Random Forest model file was not found in models/."), 400
    try:
        df = frame_from(body.get("values", {}))
        check_training_range(df)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    out = respond(df, which, _state["svr"], _state["rf"])
    out["properties"] = other_properties(descriptors=body.get("values"), model=which)
    inv = float(df.iloc[0]["1000/T"]) if "1000/T" in df.columns else None
    out["saved"] = _save(user, "descriptors", "Custom descriptors", (1000 / inv - 273.15) if inv else None,
                         which, out["log_kstar"], out["kstar"], body.get("values"))
    return jsonify(out)


def _predict_ks(user, formula, temp):
    """Name-based prediction with the K* Star models. Raises ValueError for input problems."""
    if not ks_engine.T_MIN <= temp <= ks_engine.T_MAX:
        raise ValueError(f"Choose a temperature between {ks_engine.T_MIN:.0f} and {ks_engine.T_MAX:.0f} \u00b0C.")
    d = ks_engine.describe(formula)
    feats = ks_engine.row(d["r"], temp)
    df = pd.DataFrame([feats], columns=ks_engine.FEATURES)
    y = float(ks_engine.model().predict(df)[0])
    ref = ks_engine.lsc_logk(temp)
    eh = float(d["e"]["E_above_hull"])
    assessment = {
        "benchmark": {"name": "LSC", "threshold": round(ref, 3), "superior": bool(y > ref), "margin": round(y - ref, 3)},
        "stability": {"kind": "ks", "ehull": round(eh, 1), "limit": EHULL_STABLE_MAX, "stable": bool(eh <= EHULL_STABLE_MAX),
                      "source": d["source"]},
        "domain": d["domain"],
    }
    out = respond(df, "svr", ks_engine.model(), None, ks_engine.warnings_for(d, temp),
                  bg=ks_engine.background(), assessment=assessment, ranges={})
    sites = {"A": d["a"], "B": d["b"]}
    out.update(descriptors=feats, units={k: unit_of(k) for k in feats}, sites=sites, formula=d["formula"], engine="ks")
    props_ = other_properties(name=d["formula"], descriptors={"1000/T": 1000 / (temp + 273.15)}, model="svr")
    if props_ is not None:  # TEC comes from the K* Star model, so the Result page does not show two different values
        props_["tec"] = {"value": float(d["e"]["TEC"]), "mode": "the K* Star model (" + d["source"] + ")"}
    out["properties"] = props_
    out["analysis"] = build_analysis(d["formula"], temp, sites, feats, "ks", out, d)
    out["saved"] = _save(user, "name", out["formula"], temp, "ks", out["log_kstar"], out["kstar"])
    return jsonify(out)


@app.post("/api/predict_composition")
def predict_composition():
    user, deny = need_user()
    if deny:
        return deny
    body = request.get_json(silent=True) or {}
    which = body.get("model") or default_engine()
    if which == "svr" and _state.get("ks"):  # the Predict page sends "svr" by default: that now runs the K* Star models
        which = "ks"
    try:
        temp = float(body.get("temp_c"))
        if not math.isfinite(temp) or not -100 < temp < 3000:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify(error="Enter a temperature in \u00b0C, for example 800."), 400
    fallback = None
    if which == "ks":
        if not _state.get("ks"):
            return jsonify(error="The K* Star models are not available on this server (ks/ folder). Choose another model."), 503
        try:
            return _predict_ks(user, body.get("formula", ""), temp)
        except ValueError as exc:
            can_fall_back = _state["csvr"] is not None and _state["tables"] is not None
            if "not supported" in str(exc) and can_fall_back:  # an element the K* Star tables do not cover
                fallback = f"{exc} Used the Perov AI model for this material instead."
                which = "svr"
            else:
                return jsonify(error=str(exc)), 400
    if _state["csvr"] is None or _state["tables"] is None:
        return jsonify(error="Composition models not found in models/. Run train.py again."), 503
    if which == "rf" and _state["crf"] is None:
        return jsonify(error="The composition Random Forest was not found in models/."), 400
    try:
        feats, sites, warns = composition.descriptors(body.get("formula", ""), temp, _state["tables"])
    except (ValueError, KeyError) as exc:
        return jsonify(error=str(fallback or exc)), 400
    if fallback:
        warns = [fallback] + list(warns)
    df = pd.DataFrame([feats], columns=list(_state["csvr"].feature_names_in_))
    try:
        check_training_range(df)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    out = respond(df, which, _state["csvr"], _state["crf"], warns)
    out.update(descriptors=feats, units={k: unit_of(k) for k in feats}, sites=sites, formula=str(body.get("formula", "")).strip(), engine="perov")
    out["properties"] = other_properties(name=out["formula"], descriptors={"1000/T": 1000 / (temp + 273.15)}, model=which)
    out["analysis"] = build_analysis(out["formula"], temp, sites, feats, which, out)
    out["saved"] = _save(user, "name", out["formula"], temp, which, out["log_kstar"], out["kstar"])
    return jsonify(out)


@app.get("/api/importance")
def importance():
    user, deny = need_user()
    if deny:
        return deny
    if (request.args.get("model") or default_engine()) == "ks" and _state.get("ks"):
        return jsonify(importance=model_importance_ks())
    return jsonify(importance=model_importance())


@app.get("/api/screen")
def screen():
    user, deny = need_user()
    if deny:
        return deny
    use_ks = (request.args.get("model") or default_engine()) == "ks" and bool(_state.get("ks"))
    if not use_ks and (_state["csvr"] is None or _state["tables"] is None):
        return jsonify(error="Composition models not found in models/."), 503
    try:
        temp = float(request.args.get("temp", 600))
        if not 300 <= temp <= 900:
            raise ValueError
    except ValueError:
        return jsonify(error="Choose a temperature between 300 and 900 \u00b0C."), 400
    if use_ks:
        try:
            floor_ = float(request.args.get("min_delta", "nan"))
        except ValueError:
            floor_ = float("nan")
        lim = max(1, min(100, int(request.args.get("limit", 25))))
        data = ks_engine.screen(temp, stable_only=request.args.get("stable") == "1",
                                min_delta=None if floor_ != floor_ else floor_, limit=lim)
        return jsonify(temp_c=data["temp_c"], lsc_logk=data["lsc_logk"], lsc_formula=ks_engine.LSC_FORMULA, screened=data["n"],
                       matched=data["matched"], rows=data["rows"], engine="ks", library=data["library"], library_size=data["library_size"])
    data = screen_library(temp)
    rows = data["rows"]
    if request.args.get("stable") == "1":
        rows = [r for r in rows if r["stable"]]
    try:
        floor = float(request.args.get("min_delta", "nan"))
    except ValueError:
        floor = float("nan")
    if floor == floor:  # keep compositions at least this far from LSC (0 = must beat it)
        rows = [r for r in rows if r["delta"] >= floor]
    limit = max(1, min(100, int(request.args.get("limit", 25))))
    return jsonify(temp_c=data["temp_c"], lsc_logk=data["lsc_logk"], lsc_formula=props.LSC_FORMULA,
                   screened=data["n"], matched=len(rows), rows=rows[:limit])


# ---------------------------------------------------------------- accounts and saved searches
auth.init()
auth.seed_developer()
print(f"History saving: ON (IST). Database: {'Postgres' if auth.USE_PG else auth.DB}")
_fail = {}


def need_user():
    u = auth.user_from_header(request.headers.get("Authorization", ""))
    if not u:
        return None, (jsonify(error="Please sign in first."), 401)
    return u, None


def _session(u):
    return jsonify(token=auth.make_token(u), role=u["role"], email=u["email"])


@app.post("/api/auth/signup")
def signup():
    b = request.get_json(silent=True) or {}
    try:
        return _session(auth.create_user(b.get("email"), b.get("password"), "user"))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@app.post("/api/auth/login")
def login():
    b = request.get_json(silent=True) or {}
    key, now = str(b.get("email", "")).strip().lower(), time.time()
    recent = [t for t in _fail.get(key, []) if now - t < 600]
    if len(recent) >= 5:
        return jsonify(error="Too many attempts. Wait 10 minutes and try again."), 429
    role = "dev" if b.get("role") == "dev" else "user"
    u = auth.check_login(key, b.get("password"), role)
    if not u:
        _fail[key] = recent + [now]
        return jsonify(error="Wrong email or password."), 401
    _fail.pop(key, None)
    return _session(u)


@app.get("/api/auth/me")
def me():
    u, deny = need_user()
    return deny if deny else jsonify(email=u["email"], role=u["role"])


@app.get("/api/history")
def history():
    u, deny = need_user()
    if deny:
        return deny
    searches = auth.list_searches(u["id"])
    for item in searches:
        item["time_ist"] = to_ist(item.get("created"))
    return jsonify(searches=searches)


@app.delete("/api/history/<int:sid>")
def history_delete(sid):
    u, deny = need_user()
    if deny:
        return deny
    return jsonify(deleted=auth.delete_search(u["id"], sid))


@app.post("/api/history/clear")
def history_clear():
    u, deny = need_user()
    if deny:
        return deny
    auth.clear_searches(u["id"])
    return jsonify(ok=True)


# ---------------------------------------------------------------- operations, security, analytics
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024
CKPT = MODEL_DIR / "checkpoints"
_M = {"start": time.time(), "requests": 0, "errors": 0, "lat": []}
_job = {"status": "idle", "message": "", "checkpoint": None}


@app.before_request
def _start_timer():
    request._t0 = time.perf_counter()


@app.after_request
def _after(resp):
    if request.path in ("/sw.js", "/manifest.json"):
        resp.headers["Cache-Control"] = "no-cache"
    if request.path.startswith("/api/"):
        _M["requests"] += 1
        _M["errors"] += resp.status_code >= 400
        _M["lat"] = (_M["lat"] + [(time.perf_counter() - request._t0) * 1000])[-200:]
        allowed = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
        origin = request.headers.get("Origin")
        val = "*" if "*" in allowed else (origin if origin in allowed else None)
        if val:
            resp.headers["Access-Control-Allow-Origin"] = val
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
            resp.headers["Vary"] = "Origin"
    return resp


@app.errorhandler(413)
def _too_big(_):
    return jsonify(error="That file is too large (limit 5 MB)."), 413


def _read_json(name):
    try:
        return json.loads((MODEL_DIR / name).read_text())
    except Exception:
        return None


def _active_name():
    try:
        return (MODEL_DIR / "active.txt").read_text().strip()
    except Exception:
        return "initial"


@app.get("/api/health")
def health():
    lat = _M["lat"]
    return jsonify(
        status="degraded" if _state["error"] else "ok",
        models={**{k: _state[k] is not None for k in ("svr", "rf", "csvr", "crf")}, "ks": bool(_state.get("ks"))},
        sklearn=sklearn.__version__, uptime_s=round(time.time() - _M["start"]),
        requests=_M["requests"], errors=_M["errors"],
        avg_latency_ms=round(sum(lat) / len(lat), 1) if lat else None,
        active_checkpoint=_active_name(), training=_job["status"],
        history_saving="on, IST", saved_searches_total=auth.count_searches(),
    )


@app.get("/api/analytics")
def analytics():
    return jsonify(dataset=_read_json("dataset_stats.json"), metrics=_read_json("metrics.json"), system=health().get_json())


def _upload_ks(user, df, filename):
    rows, ok = [], []
    for _, r in df.iterrows():
        item = {"formula": str(r["formula"]).strip(), "temp_c": None if pd.isna(r["temp_c"]) else r["temp_c"]}
        try:
            try:
                t = float(r["temp_c"])
            except (TypeError, ValueError):
                raise ValueError("temp_c must be a number.")
            if not ks_engine.T_MIN <= t <= ks_engine.T_MAX:
                raise ValueError(f"temp_c must be between {ks_engine.T_MIN:.0f} and {ks_engine.T_MAX:.0f}.")
            d = ks_engine.describe(item["formula"])
            item["warnings"] = ks_engine.warnings_for(d, t)
            ok.append((len(rows), ks_engine.row(d["r"], t)))
        except (ValueError, TypeError, KeyError) as exc:
            item["error"] = str(exc)
        rows.append(item)
    if ok:
        X = pd.DataFrame([x for _, x in ok], columns=ks_engine.FEATURES)
        for (idx, _), v in zip(ok, ks_engine.model().predict(X)):
            rows[idx].update(log_kstar=float(v), kstar=float(10.0 ** v))
    saved = _save(user, "batch", f"{filename} ({len(ok)} of {len(rows)} rows)", None, "ks", None, None, rows)
    return jsonify(model="ks", n=len(rows), n_ok=len(ok), rows=rows, saved=saved)


@app.post("/api/upload")
def upload():
    user, deny = need_user()
    if deny:
        return deny
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="Choose a CSV or Excel file with the columns formula and temp_c."), 400
    want = request.form.get("model") or default_engine()
    if want == "ks" and not _state.get("ks"):
        want = "svr"
    if want != "ks" and (_state["csvr"] is None or _state["tables"] is None):
        return jsonify(error="Composition models not found in models/. Run train.py again."), 503
    try:
        df = pd.read_excel(f) if f.filename.lower().endswith((".xlsx", ".xls")) else pd.read_csv(f)
    except Exception:
        return jsonify(error="Could not read that file. Use .csv or .xlsx."), 400
    df.columns = [str(c).strip().lower() for c in df.columns]
    if not {"formula", "temp_c"} <= set(df.columns):
        return jsonify(error="The file needs the columns: formula, temp_c."), 400
    if not 0 < len(df) <= 500:
        return jsonify(error="Upload between 1 and 500 rows."), 400
    if want == "ks":
        return _upload_ks(user, df, f.filename)
    which = "rf" if request.form.get("model") == "rf" and _state["crf"] is not None else "svr"
    model = _state["crf"] if which == "rf" else _state["csvr"]
    rows, ok = [], []
    for _, r in df.iterrows():
        item = {"formula": str(r["formula"]).strip(), "temp_c": None if pd.isna(r["temp_c"]) else r["temp_c"]}
        try:
            try:
                t = float(r["temp_c"])
            except (TypeError, ValueError):
                raise ValueError("temp_c must be a number.")
            if not math.isfinite(t) or not -100 < t < 3000:
                raise ValueError("temp_c must be a number between -100 and 3000.")
            feats, _, warns = composition.descriptors(item["formula"], t, _state["tables"])
            item["warnings"] = warns
            check_training_range(pd.DataFrame([feats]))
            ok.append((len(rows), feats))
        except (ValueError, TypeError, KeyError) as exc:
            item["error"] = str(exc)
        rows.append(item)
    if ok:
        X = pd.DataFrame([f for _, f in ok], columns=list(_state["csvr"].feature_names_in_))
        for (idx, _), v in zip(ok, model.predict(X)):
            rows[idx].update(log_kstar=float(v), kstar=float(10.0 ** v))
    saved = _save(user, "batch", f"{f.filename} ({len(ok)} of {len(rows)} rows)", None, which, None, None, rows)
    return jsonify(model=which, n=len(rows), n_ok=len(ok), rows=rows, saved=saved)


def _admin():
    u = auth.user_from_header(request.headers.get("Authorization", ""))
    return bool(u and u["role"] == "dev")


DENY = ({"error": "Developer sign-in required."}, 401)


def _train_job(data, name, seed):
    _job.update(status="running", message="Training started", checkpoint=name)
    try:
        trainer.run(data, CKPT / name, seed=seed, log=lambda m: _job.update(message=m))
        _job.update(status="done", message="Finished. Activate the checkpoint to use it.")
    except Exception as exc:
        shutil.rmtree(CKPT / name, ignore_errors=True)
        _job.update(status="failed", message=str(exc))


@app.post("/api/admin/train")
def admin_train():
    if not _admin():
        return jsonify(DENY[0]), 401
    if os.environ.get("VERCEL"):
        return jsonify(error="Training is not available on this Vercel deployment (no background jobs or writable storage). "
                             "Run 'python train.py' locally, commit the updated models/ folder, and push."), 501
    if _job["status"] == "running":
        return jsonify(error="A training job is already running."), 409
    data_dir = BASE / "data"
    data_dir.mkdir(exist_ok=True)
    data = next(iter(sorted(data_dir.glob("dataset.*"))), None)
    f = request.files.get("file")
    if f and f.filename:
        suffix = Path(f.filename).suffix.lower()
        if suffix not in (".xlsx", ".csv"):
            return jsonify(error="Upload an .xlsx or .csv dataset."), 400
        data = data_dir / f"upload_{int(time.time())}{suffix}"
        f.save(data)
    if data is None:
        return jsonify(error="No dataset available yet. Upload the .xlsx file."), 400
    try:
        seed = int(request.form.get("seed", 42))
    except ValueError:
        return jsonify(error="Seed must be a whole number."), 400
    name = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    threading.Thread(target=_train_job, args=(data, name, seed), daemon=True).start()
    return jsonify(started=name)


@app.get("/api/admin/status")
def admin_status():
    if not _admin():
        return jsonify(DENY[0]), 401
    return jsonify(_job)


@app.get("/api/admin/checkpoints")
def admin_checkpoints():
    if not _admin():
        return jsonify(DENY[0]), 401
    out = []
    for d in sorted(CKPT.glob("*"), reverse=True) if CKPT.exists() else []:
        m = (json.loads((d / "metrics.json").read_text()) if (d / "metrics.json").exists() else None)
        if m:
            out.append({"name": d.name, "created": m["created"], "seed": m["seed"], "rows": m["rows"],
                        "grouped_cv_r2": {k: v["grouped_cv"]["r2"] for k, v in m["models"].items()}, "active": d.name == _active_name()})
    return jsonify(checkpoints=out, active=_active_name())


@app.post("/api/admin/activate")
def admin_activate():
    if not _admin():
        return jsonify(DENY[0]), 401
    name = str((request.get_json(silent=True) or {}).get("name", ""))
    src = CKPT / name
    if not re.fullmatch(r"[\w-]+", name) or not src.is_dir():
        return jsonify(error="Unknown checkpoint."), 404
    for p in list(src.glob("*.pkl")) + list(src.glob("*.json")):
        shutil.copy(p, MODEL_DIR / p.name)
    (MODEL_DIR / "active.txt").write_text(name)
    load_models()
    return jsonify(active=name, error=_state["error"])


try:  # optional: fetch large model files from Hugging Face Hub on startup (see hf_sync.py)
    import hf_sync
    hf_sync.ensure_models(MODEL_DIR)
except Exception as exc:
    print("Model sync skipped:", exc)


load_models()

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)), debug=False)
