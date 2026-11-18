"""
Builds shared/category_map.json from the TRAINING data (sorted category names -> 0,1,2,...).
Run:  python shared/build_category_map.py
Compares with the existing file and tells you if anything changed.
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "data-science" / "datasets" / "fraudTrain.csv"
OUT = Path(__file__).resolve().parent / "category_map.json"

cats = sorted(pd.read_csv(CSV, usecols=["category"])["category"].astype(str).unique())
new_map = {c: i for i, c in enumerate(cats)}
old_map = json.loads(OUT.read_text()) if OUT.exists() else None
OUT.write_text(json.dumps(new_map, indent=2) + "\n")
print(f"{len(cats)} categories written to {OUT}")
print("SAME as the previous file." if new_map == old_map else "CHANGED. Tell the lead (codes moved).")