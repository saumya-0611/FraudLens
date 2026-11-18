"""
test_pipeline.py - Unit tests for FraudLens streaming batch validation, account masking,
and hybrid risk classification (T1.1, CONTRACTS §2, §4, §7).
"""
import pandas as pd

from streaming.jobs.classify import classify_risk, load_thresholds, mask_account
from streaming.jobs.pipeline import _validate_rows


def test_mask_account_never_exposes_full_number():
    assert mask_account("2703186189652095") == "XXXX-2095"
    assert mask_account("1234") == "XXXX-1234"


def test_classify_risk_decision_logic():
    high, low = load_thresholds()
    # p >= high -> HIGH_RISK
    assert classify_risk(0.85, False, high, low) == "HIGH_RISK"
    # p >= low and is_anomaly -> HIGH_RISK
    assert classify_risk(0.45, True, high, low) == "HIGH_RISK"
    # p >= low without anomaly -> SUSPICIOUS
    assert classify_risk(0.50, False, high, low) == "SUSPICIOUS"
    # p < low but is_anomaly -> SUSPICIOUS
    assert classify_risk(0.15, True, high, low) == "SUSPICIOUS"
    # p < low and not anomaly -> LEGITIMATE
    assert classify_risk(0.10, False, high, low) == "LEGITIMATE"


def test_validate_rows_splits_valid_and_dlq():
    df = pd.DataFrame(
        [
            {
                "transaction_id": "tx-valid-1",
                "account_ref": "2703186189652095",
                "amount": 125.50,
                "tx_time": "2026-11-20T03:12:45Z",
                "category": "shopping_net",
                "ingested_at": "2026-11-20T03:12:45.412Z",
            },
            {
                "transaction_id": "tx-bad-neg-amount",
                "account_ref": "2703186189652095",
                "amount": -10.0,
                "tx_time": "2026-11-20T03:12:45Z",
                "category": "shopping_net",
                "ingested_at": "2026-11-20T03:12:45.412Z",
            },
            {
                "transaction_id": "tx-missing-category",
                "account_ref": "2703186189652095",
                "amount": 50.0,
                "tx_time": "2026-11-20T03:12:45Z",
                "category": None,
                "ingested_at": "2026-11-20T03:12:45.412Z",
            },
        ]
    )
    valid_df, dlq = _validate_rows(df)
    assert len(valid_df) == 1
    assert valid_df.iloc[0]["transaction_id"] == "tx-valid-1"
    assert len(dlq) == 2
    assert dlq[0]["source"] == "streaming"


if __name__ == "__main__":
    test_mask_account_never_exposes_full_number()
    test_classify_risk_decision_logic()
    test_validate_rows_splits_valid_and_dlq()
    print("All streaming pipeline unit tests PASSED!")
