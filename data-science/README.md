# Data Science (FraudLens)

Owner: Riya (Backend + Data Science)

## 1. Setup Datasets
Download the Kaggle "Credit Card Transactions Fraud Detection Dataset" (Sparkov-generated):
- URL: https://www.kaggle.com/datasets/kartik2112/fraud-detection
- Place `fraudTrain.csv` and `fraudTest.csv` inside `data-science/datasets/` (this folder is git-ignored).

## 2. Dataset Loader (`load_data.py`)
Maps raw Sparkov CSV columns to the `docs/CONTRACTS.md` Section 5 schema:
- `cc_num` -> `account_ref` (string)
- `amt` -> `amount` (float)
- `trans_date_trans_time` -> `tx_time` (datetime UTC)
- `trans_num` -> `transaction_id` (string)
- `long` -> `lon` (float)
- `merch_long` -> `merch_lon` (float)
- `dob` -> `customer_age` (calculated age in years)
- `category` -> `category`
- `merchant` -> `merchant`
- `lat` -> `lat`
- `merch_lat` -> `merch_lat`
- `is_fraud` -> `is_fraud` (label)

### How to Run:
```bash
python data-science/load_data.py
```
*(If the Kaggle CSV files are not yet in `datasets/`, it will automatically validate using synthetic sample data).*

### How to Test:
```bash
python data-science/test_load_data.py
```
