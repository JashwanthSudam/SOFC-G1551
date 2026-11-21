"""Run in your k* notebook folder (where the k* dataframe lives) to save name-only k* models.
Edit the 4 CONFIG lines to match your dataframe, then run:  python train_kstar_name_only.py"""
import json, joblib, pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from sklearn.ensemble import RandomForestRegressor

# ---- CONFIG ----
DATA_CSV   = "kstar_dataset.csv"     # your k* data (311 rows)
NAME_COL   = "Material"              # column with the formula
TARGET_COL = "Log K*"                # target column
SPLITS     = "splits.json"           # from the models zip (train/val/test material names)
# ----------------
FEATURES = ["Ion_A","Ion_B","EN_A","EN_B","R_A","R_B","Sa_A","Sa_B","Delec_B",
            "t","Ionic_A","Ionic_B","Avg_Ionic_Character","SmithAcid_A","SmithAcid_B","1000/T"]
df = pd.read_csv(DATA_CSV); sp = json.load(open(SPLITS))
tr = df[df[NAME_COL].isin(sp["train"] + sp["val"])]; te = df[df[NAME_COL].isin(sp["test"])]
svr = make_pipeline(StandardScaler(), SVR(C=10)).fit(tr[FEATURES], tr[TARGET_COL])
rf  = RandomForestRegressor(n_estimators=100, random_state=42).fit(tr[FEATURES], tr[TARGET_COL])
from sklearn.metrics import r2_score, mean_absolute_error as mae
for n, m in [("svr", svr), ("rf", rf)]:
    p = m.predict(te[FEATURES]); print(n, "test R2", round(r2_score(te[TARGET_COL], p), 3), "MAE", round(mae(te[TARGET_COL], p), 3))
joblib.dump(svr, "kstar_name_only_svr_pipeline.pkl")
joblib.dump(rf,  "kstar_name_only_rf_model.pkl", compress=3)
