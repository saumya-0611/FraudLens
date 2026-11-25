import pandas as pd

from training import train


def test_synthetic_holdout_is_fixed_across_candidate_seeds(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "DATASETS_DIR", tmp_path)
    first_train, first_holdout = train.load_train_test_splits(80, 40, seed=42)
    candidate_train, candidate_holdout = train.load_train_test_splits(80, 40, seed=47)

    pd.testing.assert_frame_equal(first_holdout, candidate_holdout)
    assert not first_train.equals(candidate_train)


def test_feedback_cannot_leak_holdout_rows_into_training(tmp_path, monkeypatch):
    monkeypatch.setattr(train, "DATASETS_DIR", tmp_path)
    original_train, holdout = train.load_train_test_splits(80, 40)
    overlap = holdout.iloc[[0]].copy()
    correction = original_train.iloc[[0]].copy()
    correction["is_fraud"] = 1 - correction["is_fraud"]
    monkeypatch.setattr(train, "_load_db_feedback_rows", lambda: pd.concat([overlap, correction]))

    updated, _ = train.load_train_test_splits(80, 40, include_db_feedback=True)

    assert len(updated) == len(original_train)
    assert updated["transaction_id"].is_unique
    assert not updated["transaction_id"].isin(holdout["transaction_id"]).any()
    saved = updated.loc[updated["transaction_id"] == correction.iloc[0]["transaction_id"]]
    assert saved.iloc[0]["is_fraud"] == correction.iloc[0]["is_fraud"]
