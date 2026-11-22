# FraudLens Selenium End-to-End UI Tests (`tests/selenium/`)

Automated browser E2E test suite using **Selenium WebDriver 4 (Headless Chrome)** covering Login, form validation, RBAC sidebar navigation, and dashboard access.

## How to Run
```bash
# 1. Start the FraudLens stack (or frontend with VITE_USE_MOCKS=true)
docker compose up -d

# 2. Install Selenium and run the E2E suite
pip install selenium pytest httpx
python tests/selenium/test_fraudlens_e2e.py
```
