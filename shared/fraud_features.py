"""
fraud_features.py - the 13 model features (CONTRACTS section 5).

build_features(df) is used by BOTH model training and the streaming job, so the model
sees exactly the same feature logic offline and live (no training/serving skew).

Input : DataFrame with the transaction columns (CONTRACTS section 4 names). It may also
        contain older "history" rows of the same accounts.
Output: a copy of the input (same rows, same order, same index) with the 13 feature
        columns added. Use out[FEATURE_COLUMNS] to get just the model input.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "amount", "log_amount", "hour", "day_of_week", "is_night", "category_code",
    "distance_km", "customer_age", "tx_count_1h", "tx_count_24h",
    "secs_since_last_tx", "avg_amount_prior", "amount_ratio",
]

CATEGORY_MAP_PATH = Path(__file__).resolve().parent / "category_map.json"
NO_PREVIOUS_TX_SECS = 604800      # 7 days: used when the account has no earlier transaction
AVG_WINDOW = 30                   # avg_amount_prior looks at the last 30 prior transactions
EARTH_RADIUS_KM = 6371.0088
MISSING = -1                      # sentinel for unknown category / missing coordinates / missing age


def load_category_map(path=CATEGORY_MAP_PATH):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km between two points (arrays of degrees)."""
    lat1, lon1, lat2, lon2 = (np.radians(x) for x in (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def _history_features(account_ref, tx_time, amount, tie_break):
    """
    The four per-account history features, fully vectorised (no Python loop over rows).
    Idea: sort rows by (account, time, tie-break). Then "prior rows of the same account"
    are simply the rows before me in the same account block, and a time window is found
    with one binary search (np.searchsorted) on a combined account+time key.
    Returns arrays in the ORIGINAL row order.
    """
    n = len(amount)
    acct = pd.factorize(account_ref.astype(str).to_numpy())[0].astype("int64")
    t_ms = np.round((tx_time - tx_time.min()).dt.total_seconds().to_numpy() * 1000).astype("int64")
    tie = pd.factorize(tie_break.astype(str).to_numpy(), sort=True)[0]
    order = np.lexsort((tie, t_ms, acct))          # last key is the primary sort key

    a, t, amt = acct[order], t_ms[order], amount[order]
    pos = np.arange(n)

    # Combined key: account block, then time. The 24 h pad stops a window from reaching
    # back into the previous account's block.
    pad = 24 * 3600 * 1000
    key = a * (int(t.max()) + pad + 1) + (t + pad)

    # tx_count_*: prior rows (earlier in sort order) whose time is >= t - window
    count_1h = pos - np.searchsorted(key, key - 3600 * 1000, side="left")
    count_24h = pos - np.searchsorted(key, key - pad, side="left")

    # secs_since_last_tx
    same_as_prev = np.zeros(n, dtype=bool)
    same_as_prev[1:] = a[1:] == a[:-1]
    gap = np.zeros(n)
    gap[1:] = (t[1:] - t[:-1]) / 1000.0
    secs_since = np.where(same_as_prev, gap, NO_PREVIOUS_TX_SECS)

    # avg_amount_prior: mean of the last up-to-30 prior amounts (none -> own amount)
    first = np.searchsorted(a, a, side="left")     # index where my account block starts
    k = np.minimum(pos - first, AVG_WINDOW)        # how many prior rows I average
    excl = pd.Series(amt).groupby(a).cumsum().to_numpy() - amt   # sum of amounts before me, per account
    sum_prior = excl - excl[pos - k]
    avg_prior = np.where(k > 0, sum_prior / np.maximum(k, 1), amt)

    inv = np.empty(n, dtype=np.int64)              # undo the sort
    inv[order] = pos
    return count_1h[inv], count_24h[inv], secs_since[inv], avg_prior[inv]


def build_features(df, category_map=None):
    out = df.copy()
    n = len(out)
    if n == 0:
        for c in FEATURE_COLUMNS:
            out[c] = pd.Series(dtype="float64")
        return out
    if category_map is None:
        category_map = load_category_map()

    tx = pd.to_datetime(out["tx_time"], utc=True)          # naive times are treated as UTC
    amount = pd.to_numeric(out["amount"]).astype("float64").to_numpy()

    # ---- features that depend only on this row ----
    hour = tx.dt.hour.to_numpy()
    out["amount"] = amount
    out["log_amount"] = np.log1p(amount)
    out["hour"] = hour.astype("int64")
    out["day_of_week"] = tx.dt.dayofweek.to_numpy().astype("int64")
    out["is_night"] = ((hour < 6) | (hour >= 22)).astype("int64")
    out["category_code"] = out["category"].map(category_map).fillna(MISSING).astype("int64").to_numpy()

    num = lambda col: pd.to_numeric(out[col], errors="coerce").to_numpy(dtype="float64")
    dist = _haversine_km(num("lat"), num("lon"), num("merch_lat"), num("merch_lon"))
    out["distance_km"] = np.where(np.isnan(dist), MISSING, dist)
    out["customer_age"] = pd.to_numeric(out["customer_age"], errors="coerce").fillna(MISSING).astype("int64").to_numpy()

    # ---- features that need the account's earlier transactions ----
    tie_break = out["transaction_id"] if "transaction_id" in out.columns else pd.Series(np.arange(n), index=out.index)
    c1, c24, secs, avg_prior = _history_features(out["account_ref"], tx, amount, tie_break)
    out["tx_count_1h"] = c1
    out["tx_count_24h"] = c24
    out["secs_since_last_tx"] = secs
    out["avg_amount_prior"] = avg_prior
    out["amount_ratio"] = amount / np.maximum(avg_prior, 1.0)
    return out