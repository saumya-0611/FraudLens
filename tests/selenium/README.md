# FraudLens browser tests

The Selenium suite covers role-based navigation, transaction analysis and polling, alert transport status, and the dashboard and admin screens.

## Controlled browser fixtures

Start the frontend with `VITE_USE_MOCKS=false` so the browser tests can supply their own API and WebSocket responses.

```powershell
$env:VITE_USE_MOCKS='false'
npm.cmd --prefix frontend run dev -- --host 127.0.0.1
```

In another shell, install Selenium and HTTPX in a Python environment with Chrome WebDriver support.

```powershell
python -m pip install selenium httpx
$env:FRAUDLENS_E2E_MODE='fixture'
$env:FRAUDLENS_FRONTEND_URL='http://127.0.0.1:5173'
python -m unittest discover -s tests/selenium -p test_fraudlens_e2e.py -v
```

Set `CHROME_BINARY` if Chrome is installed in a custom location. Tests report skips when the browser or frontend is unavailable.

## Local stack verification

Use a disposable loopback stack with an active ML model and a provisioned admin account. Set `FRAUDLENS_E2E_MODE=real` and `FRAUDLENS_E2E_ALLOW_WRITES=1`. Supply `FRAUDLENS_E2E_ADMIN_USER` and `FRAUDLENS_E2E_ADMIN_PASSWORD` from the local test account, then run the same command. The write test submits a synthetic transaction and checks that the browser displays its persisted model result.
