"""
load_data.py - Dataset Loader and Schema Mapper for FraudLens
Author: Riya (Backend + Data Science)
Part of Task D1: Dataset and loader (Mon 16 Nov)

This module loads the Kaggle "Credit Card Transactions Fraud Detection Dataset"
(Sparkov-generated) and maps raw CSV columns to the exact names and types
specified in CONTRACTS.md Section 5.

Raw CSV Columns -> CONTRACTS.md Section 5 Target Schema:
- cc_num                 -> account_ref (converted to string)
- amt                    -> amount (float)
- trans_date_trans_time  -> tx_time (pd.to_datetime in UTC)
- trans_num              -> transaction_id (string)
- long                   -> lon (float)
- merch_long             -> merch_lon (float)
- dob                    -> customer_age (computed age in years at transaction time)
- category               -> category (string)
- merchant               -> merchant (string)
- lat                    -> lat (float)
- merch_lat              -> merch_lat (float)
- is_fraud               -> is_fraud (label: 0 for legit, 1 for fraud)
"""

import os
import sys
import numpy as np
import pandas as pd
from pathlib import Path

# Paths
DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "datasets"
TRAIN_FILENAME = "fraudTrain.csv"
TEST_FILENAME = "fraudTest.csv"

# Expected target columns defined in CONTRACTS.md Section 4 & Section 5
CONTRACT_COLUMNS = [
    "transaction_id",
    "account_ref",
    "amount",
    "tx_time",
    "category",
    "merchant",
    "lat",
    "lon",
    "merch_lat",
    "merch_lon",
    "customer_age",
    "is_fraud"  # Training/evaluation label
]

COLUMN_MAPPING = {
    "trans_num": "transaction_id",
    "cc_num": "account_ref",
    "amt": "amount",
    "trans_date_trans_time": "tx_time",
    "category": "category",
    "merchant": "merchant",
    "lat": "lat",
    "long": "lon",
    "merch_lat": "merch_lat",
    "merch_long": "merch_lon",
    "is_fraud": "is_fraud"
}


def calculate_customer_age(df: pd.DataFrame) -> pd.Series:
    """
    Computes customer age (in full years) at the time of the transaction.
    Uses tx_time and dob from the raw Sparkov dataset.
    """
    if "dob" not in df.columns:
        if "customer_age" in df.columns:
            return df["customer_age"].astype(int)
        return pd.Series(35, index=df.index, dtype=int)  # Fallback default

    dob = pd.to_datetime(df["dob"])
    tx_time = pd.to_datetime(df["trans_date_trans_time"])

    # Accurate age accounting for leap years and calendar birthdays
    age = tx_time.dt.year - dob.dt.year
    # Subtract 1 if the birthday hasn't occurred yet in the transaction year
    has_had_birthday = (
        (tx_time.dt.month > dob.dt.month) |
        ((tx_time.dt.month == dob.dt.month) & (tx_time.dt.day >= dob.dt.day))
    )
    age = age - (~has_had_birthday).astype(int)
    return age.clip(lower=18, upper=100).astype(int)


def process_raw_dataframe(raw_df: pd.DataFrame) -> pd.DataFrame:
    """
    Transforms raw Kaggle dataframe to match CONTRACTS schema:
    1. Computes customer_age from dob and trans_date_trans_time.
    2. Renames columns according to CONTRACTS.md Section 5.
    3. Formats account_ref as string and tx_time as UTC datetime.
    4. Selects only the contracted columns.
    """
    df = raw_df.copy()

    # Drop index column if present (Kaggle sparkov files often include "Unnamed: 0")
    if "Unnamed: 0" in df.columns:
        df = df.drop(columns=["Unnamed: 0"])

    # Compute customer age before renaming columns
    df["customer_age"] = calculate_customer_age(df)

    # Rename columns
    df = df.rename(columns=COLUMN_MAPPING)

    # Ensure correct data types
    df["account_ref"] = df["account_ref"].astype(str)
    df["transaction_id"] = df["transaction_id"].astype(str)
    df["amount"] = df["amount"].astype(float)
    df["tx_time"] = pd.to_datetime(df["tx_time"], utc=True)
    df["category"] = df["category"].astype(str)
    df["merchant"] = df["merchant"].astype(str)

    # Coordinate floats
    for col in ["lat", "lon", "merch_lat", "merch_lon"]:
        if col in df.columns:
            df[col] = df[col].astype(float)

    # Label (if present)
    if "is_fraud" in df.columns:
        df["is_fraud"] = df["is_fraud"].astype(int)

    # Filter to only contracted columns that are present
    available_cols = [c for c in CONTRACT_COLUMNS if c in df.columns]
    df = df[available_cols]

    # Sort chronologically by transaction time (essential for time-window features)
    df = df.sort_values(by="tx_time").reset_index(drop=True)
    return df


def load_dataset(filepath: str | Path, nrows: int | None = None) -> pd.DataFrame:
    """
    Loads and processes a CSV dataset file.
    
    Args:
        filepath: Path to the raw CSV file.
        nrows: Optional number of rows to read (useful for quick testing/EDA).
        
    Returns:
        pd.DataFrame adhering to CONTRACTS schema.
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found at: {path}\n"
            f"Please download the dataset from Kaggle:\n"
            f"https://www.kaggle.com/datasets/kartik2112/fraud-detection\n"
            f"Place 'fraudTrain.csv' and 'fraudTest.csv' in '{DEFAULT_DATA_DIR}'."
        )

    print(f"Loading {path.name} (nrows={nrows if nrows else 'all'})...")
    raw_df = pd.read_csv(path, nrows=nrows)
    print(f"Loaded {len(raw_df)} rows. Processing columns to CONTRACTS schema...")
    df = process_raw_dataframe(raw_df)
    return df


def load_train(data_dir: str | Path | None = None, nrows: int | None = None) -> pd.DataFrame:
    """Convenience helper to load the training dataset."""
    base = Path(data_dir) if data_dir else DEFAULT_DATA_DIR
    return load_dataset(base / TRAIN_FILENAME, nrows=nrows)


def load_test(data_dir: str | Path | None = None, nrows: int | None = None) -> pd.DataFrame:
    """Convenience helper to load the test dataset."""
    base = Path(data_dir) if data_dir else DEFAULT_DATA_DIR
    return load_dataset(base / TEST_FILENAME, nrows=nrows)


def generate_sample_data(num_rows: int = 500) -> pd.DataFrame:
    """
    Generates synthetic sample dataset matching Kaggle Sparkov schema.
    Used for local testing and CI when full Kaggle CSVs are not present.
    """
    np.random.seed(42)
    categories = [
        "misc_net", "grocery_pos", "entertainment", "gas_transport",
        "shopping_net", "shopping_pos", "food_dining", "personal_care"
    ]
    merchants = [f"fraud_Merchant_{i}" for i in range(20)]
    
    start_date = pd.Timestamp("2020-01-01", tz="UTC")
    timestamps = [start_date + pd.Timedelta(seconds=int(s)) for s in np.sort(np.random.randint(0, 86400 * 30, size=num_rows))]
    
    # 20 unique accounts generating 500 transactions
    account_pool = [str(1000000000000000 + i) for i in range(20)]
    accounts = np.random.choice(account_pool, size=num_rows)
    
    raw_data = {
        "trans_num": [f"tx_{i:06d}" for i in range(num_rows)],
        "cc_num": accounts,
        "amt": np.round(np.random.exponential(scale=50.0, size=num_rows) + 5.0, 2),
        "trans_date_trans_time": [t.strftime("%Y-%m-%d %H:%M:%S") for t in timestamps],
        "category": np.random.choice(categories, size=num_rows),
        "merchant": np.random.choice(merchants, size=num_rows),
        "lat": np.random.uniform(30.0, 45.0, size=num_rows),
        "long": np.random.uniform(-100.0, -70.0, size=num_rows),
        "merch_lat": np.random.uniform(30.0, 45.0, size=num_rows),
        "merch_long": np.random.uniform(-100.0, -70.0, size=num_rows),
        "dob": ["1985-05-15"] * num_rows,
        "is_fraud": np.random.choice([0, 1], size=num_rows, p=[0.99, 0.01])
    }
    raw_df = pd.DataFrame(raw_data)
    return process_raw_dataframe(raw_df)


def report_dataset_summary(df: pd.DataFrame, name: str = "Dataset") -> None:
    """Prints a clear summary of dataset shape, date ranges, and fraud rates."""
    print(f"\n{'='*20} {name} Summary {'='*20}")
    print(f"Total Rows:            {len(df):,}")
    print(f"Unique Accounts:       {df['account_ref'].nunique():,}")
    print(f"Date Range Start:      {df['tx_time'].min()}")
    print(f"Date Range End:        {df['tx_time'].max()}")
    print(f"Timespan:              {(df['tx_time'].max() - df['tx_time'].min()).days} days")
    
    if "is_fraud" in df.columns:
        fraud_count = df["is_fraud"].sum()
        fraud_rate = (fraud_count / len(df)) * 100
        print(f"Fraudulent Rows:       {fraud_count:,} ({fraud_rate:.3f}%)")
    
    print("Columns and Types:")
    for col, dtype in df.dtypes.items():
        print(f"  - {col:<18}: {dtype}")
    print(f"{'='*56}\n")


if __name__ == "__main__":
    print("Checking dataset files in:", DEFAULT_DATA_DIR)
    train_path = DEFAULT_DATA_DIR / TRAIN_FILENAME
    test_path = DEFAULT_DATA_DIR / TEST_FILENAME
    
    if train_path.exists():
        print(f"Found {TRAIN_FILENAME}! Checking schema and date ranges on a sample...")
        train_sample = load_dataset(train_path, nrows=5000)
        report_dataset_summary(train_sample, name="fraudTrain.csv (Sample)")
    else:
        print(f"Note: {TRAIN_FILENAME} not found yet in {DEFAULT_DATA_DIR}.")
        print("Testing schema processor with synthetic sample data...")
        sample_df = generate_sample_data(num_rows=200)
        report_dataset_summary(sample_df, name="Synthetic Sample Validation")
        print("\n[OK] load_data.py is ready to process the Kaggle datasets once downloaded.")
