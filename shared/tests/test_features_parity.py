"""
Tests for shared/fraud_features.py.   Run:  python shared/tests/test_features_parity.py

1. test_hand_checked_example  - tiny example worked out by hand from CONTRACTS section 5
2. test_matches_slow_reference - vectorised code == simple per-row Python loops (incl. same-second ties)
3. test_row_order_independent  - shuffling the input rows does not change any feature
4. test_parity_*               - features with FULL history == features with only the 50 most recent
                                 prior rows per account (what the streaming job does)
The parity test uses the real fraudTrain.csv if it is present, otherwise synthetic data.
"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "data-science"))
from fraud_features import FEATURE_COLUMNS, build_features, load_category_map  # noqa: E402

TRAIN_CSV = ROOT / "data-science" / "datasets" / "fraudTrain.csv"


def make_synthetic(n_accounts=300, seed=0):
    rng = np.random.default_rng(seed)
    cats = list(load_category_map())
    base = pd.Timestamp("2026-01-01", tz="UTC")
    parts = []
    for i in range(n_accounts):
        n = int(rng.integers(60, 260))
        secs = np.sort(rng.integers(0, 60 * 86400, n))
        secs = np.sort(np.where(rng.random(n) < 0.03, np.roll(secs, 1), secs))   # some same-second ties
        parts.append(pd.DataFrame({
            "transaction_id": [f"a{i}_t{j}" for j in range(n)],
            "account_ref": str(4000000000000000 + i),
            "amount": np.round(rng.lognormal(3.5, 1.0, n), 2),
            "tx_time": base + pd.to_timedelta(secs, unit="s"),
            "category": rng.choice(cats, n),
            "merchant": "m",
            "lat": rng.uniform(30, 45, n), "lon": rng.uniform(-100, -70, n),
            "merch_lat": rng.uniform(30, 45, n), "merch_lon": rng.uniform(-100, -70, n),
            "customer_age": int(rng.integers(18, 80)),
        }))
    return pd.concat(parts, ignore_index=True)


def reference_features(df):
    """Slow, obviously-correct version of the 4 history features (for cross-checking)."""
    d = df.copy()
    d["_t"] = pd.to_datetime(d["tx_time"], utc=True)
    d = d.sort_values(["account_ref", "_t", "transaction_id"])
    rows = {}
    for _, g in d.groupby("account_ref"):
        t = g["_t"].tolist(); amt = g["amount"].tolist(); ids = g["transaction_id"].tolist()
        for i in range(len(g)):
            prior_t, prior_a = t[:i], amt[:i]
            c1 = sum(1 for x in prior_t if (t[i] - x).total_seconds() <= 3600)
            c24 = sum(1 for x in prior_t if (t[i] - x).total_seconds() <= 86400)
            secs = (t[i] - t[i - 1]).total_seconds() if i > 0 else 604800
            last = prior_a[-30:]
            avg = sum(last) / len(last) if last else amt[i]
            rows[ids[i]] = (c1, c24, secs, avg, amt[i] / max(avg, 1))
    return pd.DataFrame.from_dict(
        rows, orient="index",
        columns=["tx_count_1h", "tx_count_24h", "secs_since_last_tx", "avg_amount_prior", "amount_ratio"])


def compare(a, b, label):
    """a, b: frames indexed by transaction_id. Raise with details if any feature differs."""
    bad = []
    for c in FEATURE_COLUMNS:
        if c in a.columns and c in b.columns:
            if not np.allclose(a.loc[b.index, c].to_numpy(float), b[c].to_numpy(float), rtol=1e-7, atol=1e-6):
                bad.append(c)
    assert not bad, f"{label}: features differ: {bad}"


class FeatureTests(unittest.TestCase):

    def test_hand_checked_example(self):
        t0 = pd.Timestamp("2026-01-05 00:00:00", tz="UTC")          # a Monday
        mins = [0, 30, 70, 300]
        df = pd.DataFrame({
            "transaction_id": ["a0", "a1", "a2", "a3", "b0"],
            "account_ref": ["A", "A", "A", "A", "B"],
            "amount": [10.0, 20.0, 30.0, 100.0, 5.0],
            "tx_time": [t0 + pd.Timedelta(minutes=m) for m in mins] + [t0],
            "category": ["travel", "travel", "home", "nonexistent", "travel"],
            "merchant": "m", "lat": 0.0, "lon": 0.0, "merch_lat": 0.0, "merch_lon": 1.0,
            "customer_age": 40,
        })
        f = build_features(df).set_index("transaction_id")
        self.assertEqual(f.loc["a0", "tx_count_1h"], 0)
        self.assertEqual(f.loc["a0", "secs_since_last_tx"], 604800)
        self.assertEqual(f.loc["a0", "avg_amount_prior"], 10.0)        # no history -> own amount
        self.assertEqual(f.loc["a1", "tx_count_1h"], 1)
        self.assertEqual(f.loc["a1", "secs_since_last_tx"], 1800)
        self.assertAlmostEqual(f.loc["a1", "amount_ratio"], 2.0)
        self.assertEqual(f.loc["a2", "tx_count_1h"], 1)                 # a0 is 70 min ago: outside 1 h
        self.assertEqual(f.loc["a2", "tx_count_24h"], 2)
        self.assertAlmostEqual(f.loc["a2", "avg_amount_prior"], 15.0)
        self.assertEqual(f.loc["a3", "tx_count_1h"], 0)
        self.assertEqual(f.loc["a3", "tx_count_24h"], 3)
        self.assertEqual(f.loc["a3", "secs_since_last_tx"], 230 * 60)
        self.assertAlmostEqual(f.loc["a3", "avg_amount_prior"], 20.0)
        self.assertAlmostEqual(f.loc["a3", "amount_ratio"], 5.0)
        self.assertEqual(f.loc["b0", "tx_count_24h"], 0)                # other account is not mixed in
        self.assertEqual(f.loc["a3", "category_code"], -1)              # unknown category
        self.assertEqual(f.loc["a0", "category_code"], load_category_map()["travel"])
        self.assertEqual(f.loc["a0", "day_of_week"], 0)
        self.assertAlmostEqual(f.loc["a0", "distance_km"], 111.19, delta=0.1)   # 1 degree of longitude at the equator
        self.assertEqual(list(f.loc[["a0", "a3"], "is_night"]), [1, 1])         # 00:00 and 05:00 are night

    def test_is_night_boundaries(self):
        hours = [5, 6, 21, 22, 23]
        df = pd.DataFrame({
            "transaction_id": [f"t{h}" for h in hours], "account_ref": [f"x{h}" for h in hours],
            "amount": 1.0, "category": "home", "merchant": "m",
            "tx_time": [pd.Timestamp(f"2026-01-05 {h:02d}:00:00", tz="UTC") for h in hours],
            "lat": 0.0, "lon": 0.0, "merch_lat": 0.0, "merch_lon": 0.0, "customer_age": 30,
        })
        self.assertEqual(list(build_features(df)["is_night"]), [1, 0, 0, 1, 1])

    def test_matches_slow_reference(self):
        df = make_synthetic(n_accounts=15, seed=3)
        fast = build_features(df).set_index("transaction_id")
        compare(fast, reference_features(df), "fast vs reference")

    def test_row_order_independent(self):
        df = make_synthetic(n_accounts=20, seed=4)
        a = build_features(df).set_index("transaction_id")
        b = build_features(df.sample(frac=1.0, random_state=1)).set_index("transaction_id")
        compare(a, b, "shuffled")

    def test_output_keeps_rows_and_adds_13_columns(self):
        df = make_synthetic(n_accounts=5, seed=5)
        out = build_features(df)
        self.assertEqual(len(out), len(df))
        self.assertTrue((out.index == df.index).all())
        self.assertFalse(out[FEATURE_COLUMNS].isna().any().any())
        self.assertEqual(len(FEATURE_COLUMNS), 13)


def check_parity(df, n_accounts=200, batch_size=20, history=50, seed=1):
    """Streaming simulation: per account, a batch of new rows plus the `history` most recent prior rows."""
    rng = np.random.default_rng(seed)
    accounts = df["account_ref"].unique()
    pick = rng.choice(accounts, size=min(n_accounts, len(accounts)), replace=False)
    sub = df[df["account_ref"].isin(pick)].sort_values(["tx_time", "transaction_id"]).reset_index(drop=True)
    full = build_features(sub).set_index("transaction_id")

    pieces = []
    for _, g in sub.groupby("account_ref", sort=False):
        if len(g) < 2:
            continue
        cut = int(rng.integers(1, len(g)))                       # rows before `cut` are older history
        part = g.iloc[max(0, cut - history):cut + batch_size]    # last `history` old rows + the new batch
        pieces.append(part.assign(_is_batch=np.arange(len(part)) >= min(cut, history)))
    trunc_in = pd.concat(pieces, ignore_index=True).sort_values(["tx_time", "transaction_id"])
    is_batch = trunc_in["_is_batch"]
    trunc = build_features(trunc_in.drop(columns="_is_batch"))[is_batch]   # keep only batch rows
    trunc = trunc.set_index("transaction_id")
    compare(full, trunc, "full history vs 50-row history")
    return len(trunc)


class ParityTests(unittest.TestCase):

    def test_parity_synthetic(self):
        n = check_parity(make_synthetic(n_accounts=300, seed=0))
        print(f"\n[parity synthetic] {n} batch rows compared: all 13 features equal")

    @unittest.skipUnless(TRAIN_CSV.exists(), "fraudTrain.csv not downloaded yet")
    def test_parity_real_data(self):
        from load_data import load_train
        n = check_parity(load_train())
        print(f"\n[parity real data] {n} batch rows compared: all 13 features equal")


if __name__ == "__main__":
    unittest.main(verbosity=2)