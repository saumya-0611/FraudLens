"""
test_load_data.py - Unit tests for data-science/load_data.py
Author: Riya (Backend + Data Science)
Part of Task D1: Dataset and loader
"""

import unittest
import pandas as pd
from load_data import generate_sample_data, process_raw_dataframe, calculate_customer_age, CONTRACT_COLUMNS


class TestLoadData(unittest.TestCase):
    def setUp(self):
        self.sample_df = generate_sample_data(num_rows=50)

    def test_contract_columns_presence(self):
        """Verifies all required contract columns are present."""
        for col in CONTRACT_COLUMNS:
            self.assertIn(col, self.sample_df.columns, f"Missing contract column: {col}")

    def test_account_ref_is_string(self):
        """Verifies account_ref is formatted as string to prevent loss of leading zeros or precision."""
        self.assertTrue(
            pd.api.types.is_string_dtype(self.sample_df["account_ref"]),
            "account_ref must be string type"
        )

    def test_tx_time_is_utc_datetime(self):
        """Verifies tx_time is timezone-aware UTC datetime."""
        self.assertTrue(
            pd.api.types.is_datetime64_any_dtype(self.sample_df["tx_time"]),
            "tx_time must be datetime type"
        )
        self.assertIsNotNone(self.sample_df["tx_time"].dt.tz, "tx_time must be timezone-aware")

    def test_customer_age_calculation(self):
        """Verifies customer_age is correctly computed from dob and transaction timestamp."""
        test_raw = pd.DataFrame({
            "trans_num": ["tx_001"],
            "cc_num": [123456789],
            "amt": [50.0],
            "trans_date_trans_time": ["2020-06-15 14:30:00"],
            "category": ["grocery_pos"],
            "merchant": ["merchant_1"],
            "lat": [40.0],
            "long": [-74.0],
            "merch_lat": [40.1],
            "merch_long": [-74.1],
            "dob": ["1990-06-14"],  # Had birthday yesterday -> age 30
            "is_fraud": [0]
        })
        processed = process_raw_dataframe(test_raw)
        self.assertEqual(processed["customer_age"].iloc[0], 30)

        # Before birthday in that year
        test_raw2 = test_raw.copy()
        test_raw2["dob"] = ["1990-06-16"]  # Birthday tomorrow -> age 29
        processed2 = process_raw_dataframe(test_raw2)
        self.assertEqual(processed2["customer_age"].iloc[0], 29)

    def test_chronological_ordering(self):
        """Verifies transactions are sorted in chronological order."""
        timestamps = self.sample_df["tx_time"].tolist()
        self.assertEqual(timestamps, sorted(timestamps), "Transactions must be sorted chronologically")


if __name__ == "__main__":
    unittest.main()
