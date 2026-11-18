"""
classify.py - Risk tier classification and account masking helpers for FraudLens streaming
(CONTRACTS.md §2 & §7, FR-08).
"""
import json
from pathlib import Path
from typing import Tuple

THRESHOLDS_PATH = Path(__file__).resolve().parents[2] / "shared" / "thresholds.json"


def load_thresholds(path: Path = THRESHOLDS_PATH) -> Tuple[float, float]:
    """Read high and low risk thresholds from shared/thresholds.json."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return float(data.get("high", 0.80)), float(data.get("low", 0.40))


def classify_risk(prob: float, is_anomaly: bool, high: float, low: float) -> str:
    """
    CONTRACTS §7 decision logic (FR-08):
      if p >= high or (p >= low and is_anomaly): HIGH_RISK     -> creates an alert
      elif p >= low or is_anomaly:               SUSPICIOUS    -> no alert, visible in transactions
      else:                                       LEGITIMATE
    """
    if prob >= high or (prob >= low and is_anomaly):
        return "HIGH_RISK"
    if prob >= low or is_anomaly:
        return "SUSPICIOUS"
    return "LEGITIMATE"


def mask_account(account_ref: str) -> str:
    """Masking rule (CONTRACTS §2): never return full account_ref; return XXXX-last4."""
    return "XXXX-" + str(account_ref or "")[-4:]
