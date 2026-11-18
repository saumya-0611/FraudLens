# Feature specification (13 features)

Every transaction is turned into these 13 numbers by `shared/fraud_features.py` (`build_features`).
The same code is used for training and for live scoring, so the model never sees a feature that was
computed differently in production.

| # | Feature | Plain-English meaning |
|---|---|---|
| 1 | `amount` | How much the transaction is for. |
| 2 | `log_amount` | log(1 + amount). Squashes huge amounts so the model is not dominated by a few outliers. |
| 3 | `hour` | Hour of the day (0-23, UTC). |
| 4 | `day_of_week` | 0 = Monday ... 6 = Sunday. |
| 5 | `is_night` | 1 if the hour is before 06:00 or from 22:00 onward, else 0. Fraud is more common at night. |
| 6 | `category_code` | The merchant category as a number (map in `category_map.json`). Unknown category = -1. |
| 7 | `distance_km` | Straight-line distance between the customer's home and the merchant (haversine). Far away = riskier. |
| 8 | `customer_age` | Customer age in years. |
| 9 | `tx_count_1h` | How many earlier transactions this account made in the 60 minutes before this one (this one not counted). A burst is a classic fraud sign. |
| 10 | `tx_count_24h` | Same, over 24 hours. |
| 11 | `secs_since_last_tx` | Seconds since the account's previous transaction. First transaction: 604800 (7 days). |
| 12 | `avg_amount_prior` | Average amount of the account's last 30 earlier transactions. First transaction: its own amount. |
| 13 | `amount_ratio` | `amount / max(avg_amount_prior, 1)`. "How many times bigger than usual is this?" |

## Conventions
- **Time is UTC.** The Kaggle timestamps carry no timezone; we treat them as UTC, so `hour` and `is_night` are in "dataset time".
- **Earlier = earlier in time.** Two transactions of one account in the same second are ordered by `transaction_id`, so the result is deterministic.
- **Missing values:** missing coordinates give `distance_km = -1`, missing age gives `customer_age = -1` (same idea as unknown category = -1). The Kaggle data has none of these.
- **History and parity:** features 9-13 need an account's earlier transactions. The streaming job supplies the 50 most recent rows per account. Features 11-13 are exact with that. Features 9-10 are exact unless the account made more than 50 transactions in the previous 24 hours. `shared/tests/test_features_parity.py` checks that full history and 50-row history give the same values.