"""Predict from a composition NAME, from DESCRIPTORS, or both (descriptors override name-derived values).
Keep next to featurizer.py, elements.json, meta.json, splits.json and the model .pkl files."""
import os, json, joblib, numpy as np
from featurizer import featurize

DIR = os.path.dirname(os.path.abspath(__file__))
META_RANGES = json.load(open(os.path.join(DIR, "meta.json")))["ranges"]
KSTAR_FULL = json.load(open(os.path.join(DIR, "splits.json")))["features"]       # 23 inputs, model order
KSTAR_NAME = ["Ion_A","Ion_B","EN_A","EN_B","R_A","R_B","Sa_A","Sa_B","Delec_B","t","Ionic_A",
              "Ionic_B","Avg_Ionic_Character","SmithAcid_A","SmithAcid_B","1000/T"]   # name-only model inputs
AVG = ["avg_Ion","avg_EN","avg_R","avg_Sa","avg_SmithAcid","avg_Ionic"]
COND_EXTRA = ["1000/T","PO2","PH2O","carrier_enc"]
COND_DEFAULTS = {"1000/T": 1000/973.0, "PO2": 0.21, "PH2O": 0.0, "carrier_enc": 0}   # CHECK units/encoding
KSTAR_DEFAULT_1000_T = 1000/973.0

# Units inferred from the training ranges -- please confirm; blank = unknown/dimensionless
UNITS = {"Ion_A":"eV","Ion_B":"eV","R_A":"Å","R_B":"Å","Gap":"eV","Work_Function":"eV","O_pband":"eV",
         "Oxide_vacancy":"eV","E_above_hull":"meV/atom","TEC":"×10⁻⁶ K⁻¹","1000/T":"1000/K"}

_cache = {}
def _load(fn):
    if fn not in _cache:
        p = os.path.join(DIR, fn)
        if not os.path.exists(p): raise FileNotFoundError(f"Model file missing: {fn}")
        _cache[fn] = joblib.load(p)
    return _cache[fn]
def _suffix(model): return "svr_pipeline" if model == "svr" else "rf_model"

def _gather(name, descriptors):
    f = {}
    if name and name.strip(): f.update(featurize(name.strip()))
    for k, v in (descriptors or {}).items():
        if v is not None and v != "": f[k] = float(v)
    return f

def check_range(feats, keys):
    """Return list of messages for inputs outside the k* training range."""
    out = []
    for k in keys:
        if k in feats and k in META_RANGES:
            lo, hi = META_RANGES[k]
            if not (lo <= feats[k] <= hi):
                u = UNITS.get(k, "")
                out.append(f"{k} = {feats[k]:.4g} {u} is outside the training range [{lo:.4g}, {hi:.4g}] {u}".replace("  ", " "))
    return out

def _need(feats, keys, what):
    miss = [k for k in keys if k not in feats]
    if miss: raise ValueError(f"{what}: missing {', '.join(miss)}. Enter a material name or provide these descriptors.")
    return np.array([[feats[k] for k in keys]])

def predict(target, name=None, descriptors=None, model="svr"):
    """target: kstar | conductivity | asr | tec.  Returns {'value':..., 'mode':..., 'warnings':[...]}"""
    f = _gather(name, descriptors); warn = []
    if target in ("asr", "tec"):
        x = _need(f, AVG, target.upper())
        val = _load(f"{target}_{_suffix(model)}.pkl").predict(x)[0]; mode = "descriptors" if not name else "name"
    elif target == "conductivity":
        for k, v in COND_DEFAULTS.items():
            if k not in f: f[k] = v; warn.append(f"{k} not given - using default {v:.4g}")
        x = _need(f, AVG + COND_EXTRA, "Conductivity")
        val = _load(f"conductivity_{_suffix(model)}.pkl").predict(x)[0]; mode = "descriptors" if not name else "name"
    elif target == "kstar":
        if name and name.strip() and "1000/T" not in f: f["1000/T"] = KSTAR_DEFAULT_1000_T   # default 973 K
        have_full = all(k in f for k in KSTAR_FULL)
        if have_full:
            warn += check_range(f, KSTAR_FULL); mode = "full descriptors"
            val = _load(f"kstar_{_suffix(model)}.pkl").predict(np.array([[f[k] for k in KSTAR_FULL]]))[0]
        else:
            if not name: raise ValueError("k*: give a material name, or all 23 descriptors. Missing: " +
                                          ", ".join(k for k in KSTAR_FULL if k not in f))
            warn += check_range(f, KSTAR_NAME); mode = "name only"
            val = _load(f"kstar_name_only_{_suffix(model)}.pkl").predict(np.array([[f[k] for k in KSTAR_NAME]]))[0]
    else:
        raise ValueError("target must be kstar, conductivity, asr or tec")
    return {"value": float(val), "mode": mode, "warnings": warn}

def predict_all(name=None, descriptors=None, model="svr"):
    out = {}
    for t in ("kstar", "conductivity", "asr", "tec"):
        try: out[t] = predict(t, name, descriptors, model)
        except Exception as e: out[t] = {"value": None, "error": str(e)}
    return out
