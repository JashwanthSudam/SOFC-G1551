"""Host large model files on Hugging Face Hub and cache them on startup.

Setup:  pip install huggingface_hub
        set HF_REPO=your-name/kstar-models  and  HF_TOKEN=...   (token only needed to push or for private repos)
Push:   python hf_sync.py push      (uploads the models/ folder)
On startup app.py calls ensure_models(): if HF_REPO is set, any missing model file is downloaded into models/.
"""
import os
import sys
from pathlib import Path

NEEDED = ["perovskite_svr_pipeline.pkl", "perovskite_rf_model.pkl", "perovskite_comp_svr_pipeline.pkl",
          "perovskite_comp_rf_model.pkl", "elements.json", "meta.json", "examples.json", "metrics.json", "dataset_stats.json"]


# The K* Star random forest (ks/enhanced_rf.joblib, ~58 MB) is too big for the GitHub web uploader (25 MB limit).
# Keep it on the Hub instead and it is downloaded into ks/ on startup when it is missing.
KS_FILES = ["enhanced_rf.joblib"]


def ensure_models(model_dir):
    repo = os.environ.get("HF_REPO")
    if not repo:
        return
    from huggingface_hub import hf_hub_download
    model_dir = Path(model_dir)
    root = model_dir.parent
    for name in KS_FILES:
        if not (root / "ks" / name).exists():
            hf_hub_download(repo_id=repo, filename=f"ks/{name}", local_dir=root, token=os.environ.get("HF_TOKEN"))
            print("Downloaded ks/" + name)
    for name in NEEDED:
        if not (model_dir / name).exists():
            hf_hub_download(repo_id=repo, filename=name, local_dir=model_dir, token=os.environ.get("HF_TOKEN"))
            print("Downloaded", name)


if __name__ == "__main__" and sys.argv[1:] == ["push"]:
    from huggingface_hub import HfApi
    HfApi(token=os.environ["HF_TOKEN"]).upload_folder(
        folder_path=str(Path(__file__).parent / "models"), repo_id=os.environ["HF_REPO"], ignore_patterns=["checkpoints/*", "processed/*"])
    HfApi(token=os.environ["HF_TOKEN"]).upload_file(
        path_or_fileobj=str(Path(__file__).parent / "ks" / "enhanced_rf.joblib"), path_in_repo="ks/enhanced_rf.joblib", repo_id=os.environ["HF_REPO"])
