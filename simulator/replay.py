"""
replay.py - Transaction stream simulator for FraudLens (T1.3).

Reads `data-science/datasets/fraudTest.csv` (or generates realistic synthetic Sparkov rows
if the CSV is not present locally), maps columns to the CONTRACTS §4/§5 schema, sorts by
transaction time, and sends HTTP POST requests to `POST /api/transactions` with header
`X-Service-Token` at `--tps N`.

Options:
  --tps          Transactions per second (default: 5)
  --limit        Max transactions to send (default: 100)
  --seed         Random seed for reproducible sampling (default: 42)
  --fraud-boost  Target fraction of fraud/high-amount rows for live demos (e.g. 0.05)
  --drift-mode   Multiply transaction amounts by 3x to trigger PSI drift in demo
  --url          Backend ingest URL (default: http://localhost:5000/api/transactions)
  --csv          Path to fraudTest.csv (default: data-science/datasets/fraudTest.csv)
"""
import argparse
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import random
import time
from typing import Any, Dict, List
import uuid

import httpx
import pandas as pd

DEFAULT_CSV = Path(__file__).resolve().parents[1] / "data-science" / "datasets" / "fraudTest.csv"

CATEGORIES = [
    "shopping_net", "grocery_pos", "gas_transport", "misc_net",
    "shopping_pos", "food_dining", "entertainment", "health_fitness",
]


def _compute_age(dob_str: Any, ref_year: int = 2026) -> int:
    try:
        dt = pd.to_datetime(str(dob_str), errors="coerce")
        if pd.isna(dt):
            return 35
        return max(18, min(95, int(ref_year - dt.year)))
    except Exception:
        return 35


def _load_or_generate_rows(
    csv_path: Path,
    limit: int,
    seed: int,
    fraud_boost: float,
    drift_mode: bool,
) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    rows: List[Dict[str, Any]] = []

    if csv_path.exists():
        print(f"[simulator] Loading rows from {csv_path}...")
        read_cap = max(limit * 20, 5000)
        df = pd.read_csv(csv_path, nrows=read_cap)

        if fraud_boost > 0 and "is_fraud" in df.columns:
            fraud_df = df[df["is_fraud"] == 1]
            legit_df = df[df["is_fraud"] == 0]
            n_fraud = min(len(fraud_df), max(1, int(limit * fraud_boost)))
            n_legit = max(0, limit - n_fraud)
            sampled = pd.concat(
                [
                    fraud_df.sample(n=n_fraud, random_state=seed, replace=len(fraud_df) < n_fraud),
                    legit_df.sample(n=min(len(legit_df), n_legit), random_state=seed),
                ],
                ignore_index=True,
            )
        else:
            sampled = df.head(limit).copy()

        time_col = "trans_date_trans_time" if "trans_date_trans_time" in sampled.columns else "tx_time"
        if time_col in sampled.columns:
            sampled = sampled.sort_values(time_col).reset_index(drop=True)

        run_tag = uuid.uuid4().hex[:6]
        now_utc = datetime.now(timezone.utc)
        total_rows = min(len(sampled), limit)

        for idx, (_, r) in enumerate(sampled.head(limit).iterrows()):
            amt = float(r.get("amt", r.get("amount", 45.0)))
            if drift_mode:
                amt = round(amt * 3.5, 2)
            tx_dt = now_utc - timedelta(seconds=max(0, (total_rows - 1 - idx) * 2))
            base_tx_id = str(r.get("trans_num", r.get("transaction_id", uuid.uuid4().hex[:12])))
            rows.append(
                {
                    "transaction_id": f"{base_tx_id}-{run_tag}",
                    "account_ref": str(r.get("cc_num", r.get("account_ref", "2703186189652095"))),
                    "amount": round(amt, 2),
                    "tx_time": tx_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "category": str(r.get("category", "shopping_net")),
                    "merchant": str(r.get("merchant", "fraud_Kutch LLC")),
                    "lat": float(r.get("lat", 36.0788)),
                    "lon": float(r.get("long", r.get("lon", -81.1781))),
                    "merch_lat": float(r.get("merch_lat", 36.011293)),
                    "merch_lon": float(r.get("merch_long", r.get("merch_lon", -82.048315))),
                    "customer_age": (
                        int(r["customer_age"])
                        if "customer_age" in r and not pd.isna(r["customer_age"])
                        else _compute_age(r.get("dob"))
                    ),
                }
            )
        return rows

    print(f"[simulator] {csv_path} not found; generating {limit} synthetic Sparkov transactions...")
    accounts = ["2703186189652095", "4532015112830366", "6011000990139424", "378282246310005"]
    base_time = datetime.now(timezone.utc) - timedelta(seconds=limit * 2)

    for i in range(limit):
        roll = rng.random()
        is_boosted_fraud = roll < max(fraud_boost, 0.12)
        is_suspicious_tier = (not is_boosted_fraud) and (roll < max(fraud_boost, 0.12) + 0.18)
        tx_dt = base_time + timedelta(seconds=i * 2)

        if is_boosted_fraud:
            amt = rng.uniform(1800.0, 4400.0)
            cat = rng.choice(["shopping_net", "misc_net"])
            merch = "fraud_Kutch LLC"
            m_lat, m_lon = 38.6012, -84.2048
        elif is_suspicious_tier:
            amt = rng.uniform(450.0, 820.0)
            cat = rng.choice(["shopping_net", "entertainment", "misc_net"])
            merch = "OutOfState_Vendor_Net"
            m_lat, m_lon = 37.2512, -82.6548
        else:
            amt = rng.uniform(12.0, 125.0)
            cat = rng.choice(CATEGORIES)
            merch = "Local_Merchant_POS"
            m_lat, m_lon = 36.0812, -81.1795

        if drift_mode:
            amt *= 3.5

        rows.append(
            {
                "transaction_id": f"sim-{seed}-{i:05d}-{uuid.uuid4().hex[:8]}",
                "account_ref": rng.choice(accounts),
                "amount": round(amt, 2),
                "tx_time": tx_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "category": cat,
                "merchant": merch,
                "lat": 36.0788,
                "lon": -81.1781,
                "merch_lat": m_lat,
                "merch_lon": m_lon,
                "customer_age": rng.randint(22, 68),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="FraudLens Transaction Stream Simulator")
    parser.add_argument("--tps", type=float, default=5.0, help="Transactions per second")
    parser.add_argument("--limit", type=int, default=100, help="Number of transactions to replay")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--fraud-boost", type=float, default=0.05, help="Fraction of fraud rows to oversample")
    parser.add_argument("--drift-mode", action="store_true", help="Multiply amounts by 3x to trigger drift")
    parser.add_argument(
        "--url",
        type=str,
        default=os.getenv("SIMULATOR_TARGET_URL", "http://localhost:5000/api/transactions"),
        help="Backend POST /api/transactions URL",
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to fraudTest.csv")
    args = parser.parse_args()

    token = os.getenv("SERVICE_TOKEN", "fl_service_token_simulator_2026")
    headers = {"X-Service-Token": token, "Content-Type": "application/json"}

    rows = _load_or_generate_rows(args.csv, args.limit, args.seed, args.fraud_boost, args.drift_mode)
    interval = 1.0 / max(args.tps, 0.1)

    sent = 0
    failed = 0
    print(
        f"[simulator] Replaying {len(rows)} transactions to {args.url} at {args.tps} TPS "
        f"(fraud_boost={args.fraud_boost}, drift_mode={args.drift_mode})..."
    )

    with httpx.Client(timeout=5.0) as client:
        for row in rows:
            t0 = time.perf_counter()
            try:
                res = client.post(args.url, json=row, headers=headers)
                if res.status_code in (200, 201, 202):
                    sent += 1
                else:
                    failed += 1
                    print(f"[simulator] HTTP {res.status_code}: {res.text[:120]}")
            except Exception as exc:
                failed += 1
                print(f"[simulator] Request error: {exc}")

            elapsed = time.perf_counter() - t0
            sleep_for = interval - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)

    print(f"[simulator] Done. sent={sent}, failed={failed}")


if __name__ == "__main__":
    main()
