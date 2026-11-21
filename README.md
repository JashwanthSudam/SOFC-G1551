# Perovskite Property Prediction Models

Trained models for SOFC-related perovskite properties.

## Models included

| File | Target | Algorithm |
|------|--------|-----------|
| `kstar_svr_pipeline.pkl` | Log K* (oxygen surface exchange) | StandardScaler + SVR(C=10) |
| `kstar_rf_model.pkl` | Log K* | RandomForest |
| `conductivity_svr_pipeline.pkl` | log10(Conductivity) | StandardScaler + SVR(C=10) |
| `conductivity_rf_model.pkl` | log10(Conductivity) | RandomForest |
| `asr_svr_pipeline.pkl` | Log ASR @ 973 K | StandardScaler + SVR(C=10) |
| `asr_rf_model.pkl` | Log ASR @ 973 K | RandomForest |
| `tec_svr_pipeline.pkl` | TEC (×10⁻⁶ K⁻¹) | StandardScaler + SVR(C=10) |
| `tec_rf_model.pkl` | TEC (×10⁻⁶ K⁻¹) | RandomForest |

## How to load

```python
import joblib

model = joblib.load("conductivity_rf_model.pkl")
# or
pipe = joblib.load("conductivity_svr_pipeline.pkl")
```

## Notes

- All models used **material-level splits** (no composition leakage).
- Feature set is based on elemental averages (Ion, EN, R, Sa, SmithAcid, Ionic) + temperature terms where applicable.
- See the corresponding `*_metrics.json` files for R² and MAE scores.
- `elements.json` contains the elemental property lookup used for featurization.

## Notes on file size

`conductivity_rf_model.pkl` was re-saved with `joblib.dump(..., compress=3)` (~9 MB) so it can be uploaded through the GitHub web editor (25 MB limit). Predictions are identical; `joblib.load` reads it as usual.

## Versions

Models were trained with scikit-learn 1.9.1 (k* models with 1.8.0). Pin `scikit-learn==1.9.1` and `joblib` in `requirements.txt`.

## K* Star models (added)

The Predict page now runs on the K* Star models from the `crystal_kstar` project by default. Everything for them lives in `ks/`
and is wired in by `ks_engine.py` (physics in `ks_props.py`). The old Perov AI models are still there: developers can pick
them in the **Model** menu, and a formula with an element the K* Star tables do not cover (for example Mg on the B-site) falls
back to the Perov AI model with a note.

| What | Where it comes from |
|------|---------------------|
| log k*(T) | `ks/kstar_ks_svr.pkl` (StandardScaler + SVR, C=100, gamma=0.1, 16 descriptors incl. 1000/T). Refitted from `Kstar_DataSet_Pro.xlsx` if the pickle cannot be read |
| E above hull, TEC | `Kstar_Selected_Base.xlsx` or the training dataset when the formula is in them, else the random forest |
| Band gap, vacancy descriptor, work function, dielectric, O p-band | `ks/enhanced_rf.joblib` (random forest) |
| Price | `ks/price_rf.joblib` |
| Ionic conductivity, Rp | `ks_props.py` (Nernst-Einstein, Adler-Lane-Steele). Relative ranking only |
| Conductivity (air) | still this app's measured-data conductivity model; ASR = Rp + ohmic loss of a 10 um film |
| Applicability domain | Mahalanobis distance on the 15 composition descriptors |
| Low-T finder / Candidates | `ks/library.parquet` (92k compositions, needs `pyarrow`), otherwise a generated library of about 2,500 formulas |

Accuracy of the k* model (see `ks/ks_metrics.json`): R2 0.72 and MAE 0.49 log units on materials it has not seen.

**File size:** `ks/enhanced_rf.joblib` is about 58 MB, over the 25 MB limit of the GitHub web uploader. Push with git (limit 100 MB), or
host it on the Hugging Face Hub: `python hf_sync.py push` uploads it, and the app downloads it into `ks/` on startup when `HF_REPO` is set.
It needs roughly 300 MB of RAM once loaded, so use a host with at least 1 GB.
