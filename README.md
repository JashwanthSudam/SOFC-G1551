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
