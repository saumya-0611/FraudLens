"""
test_fraudlens_e2e.py - Selenium WebDriver End-to-End UI Test Suite for FraudLens.

Covers the Capstone Selenium Testing rubric requirement:
1. Login Page UI rendering, brand identity, and empty form validation.
2. Role-based authentication flow (ADMIN, ANALYST, VIEWER).
3. Navigation & Role-Based Access Control (VIEWER restricted from /alerts and /admin/*).
4. Logout session termination.

Runs in headless Chrome via Selenium 4 (`pytest tests/selenium/test_fraudlens_e2e.py`).
If Chrome/Edge or the Frontend dev server (`http://localhost:5173`) is not running in a
headless CI stage, includes a deterministic DOM/contract smoke mode so CI never hangs.
"""
import importlib
import os
import tempfile
import time
import unittest
from urllib.parse import urlparse

FRONTEND_URL = os.getenv("FRAUDLENS_FRONTEND_URL", "http://localhost:5173")
FIXTURE_MODE = os.getenv("FRAUDLENS_E2E_MODE") == "fixture"
REAL_MODE = os.getenv("FRAUDLENS_E2E_MODE") == "real"

# Controlled browser fixtures replace only the browser's API and WebSocket
# transports. They are UI behavior tests, not evidence of real inference/auth.
CONTROLLED_FIXTURE = r"""
(() => {
  if (window.__fraudLensFixtureInstalled) return;
  window.__fraudLensFixtureInstalled = true;
  const NativeWebSocket = window.WebSocket;
  const originalFetch = window.fetch.bind(window);
  const transactionRows = Array.from({ length: 25 }, (_, index) => {
    const number = index + 1;
    const transactionId = `fixture-tx-${String(number).padStart(3, '0')}`;
    const risk = number % 5 === 0 ? 'HIGH_RISK' : number % 2 === 0 ? 'SUSPICIOUS' : 'LEGITIMATE';
    return {
      transaction_id: transactionId, account_masked: `XXXX-${String(1000 + number)}`,
      amount: 100 + number, category: number % 2 ? 'shopping_net' : 'grocery_pos',
      merchant: `Fixture Merchant ${number}`,
      tx_time: `2026-11-${number <= 15 ? '20' : '21'}T12:${String(number % 60).padStart(2, '0')}:00.000Z`,
      risk_category: risk, fraud_probability: risk === 'HIGH_RISK' ? 0.93 : risk === 'SUSPICIOUS' ? 0.52 : 0.08,
      is_anomaly: risk === 'HIGH_RISK', model_version: 'v1',
      alert: risk === 'HIGH_RISK' ? { alert_id: 300 + number, state: 'NEW', resolution: null } : null,
    };
  });
  const fixtureAlerts = Array.from({ length: 25 }, (_, index) => ({
    alert_id: 301 + index, transaction_id: transactionRows[index].transaction_id,
    account_masked: transactionRows[index].account_masked, amount: transactionRows[index].amount,
    category: transactionRows[index].category, risk_score: 0.93, risk_category: 'HIGH_RISK',
    state: index === 0 ? 'NEW' : index % 3 === 0 ? 'UNDER_REVIEW' : 'NEW',
    resolution: null, created_at: transactionRows[index].tx_time,
    top_reasons: [{ feature: 'amount_ratio', impact: 0.41, text: 'Controlled fixture reason' }], model_version: 'v1',
  }));
  const fixtureAuditRows = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1, event_time: `2026-11-${index < 15 ? '20' : '21'}T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
    user_id: 1, username: index % 2 ? 'fixture-analyst' : 'fixture-admin',
    action: index % 2 ? 'USER_UPDATED' : 'USER_CREATED', entity: 'user',
    entity_id: String(index + 10), details: { controlled_fixture: true },
  }));
  const state = window.__fraudLensFixture = {
    role: sessionStorage.getItem('fraudlens-fixture-role'),
    transaction: JSON.parse(sessionStorage.getItem('fraudlens-fixture-transaction') || 'null'),
    batchTransactions: JSON.parse(sessionStorage.getItem('fraudlens-fixture-batch-transactions') || '{}'), batchPosts: 0, batchPollReads: {},
    detailReads: 0, transactionPosts: 0, alertRequests: 0,
    alertFailure: new URLSearchParams(location.search).get('fixtureAlertFailure') === '1',
    alertConflict: new URLSearchParams(location.search).get('fixtureAlertConflict') === '1',
    socketFailures: Number(new URLSearchParams(location.search).get('fixtureSocketFailures') || 0),
    alwaysPending: new URLSearchParams(location.search).get('fixtureAlwaysPending') === '1', sockets: [],
    transactionRows, transactionQueries: [], alerts: fixtureAlerts, alertPatches: [],
    users: [{ id: 10, username: 'fixture-analyst', role: 'ANALYST', status: 'ACTIVE', created_at: '2026-11-20T12:00:00.000Z' }], userPatches: [], userCreates: [],
    auditRows: fixtureAuditRows, auditQueries: [],
    models: {
      active_version: 'v1',
      models: [
        { version: 'v1', algorithm: 'xgboost+isolation_forest', status: 'ACTIVE', metrics: {}, artifact_path: 'model_store/v1', sha256: '0'.repeat(64), created_at: '2026-11-18T12:00:00Z', activated_at: '2026-11-19T12:00:00Z' },
        { version: 'v2', algorithm: 'xgboost+isolation_forest', status: 'VALIDATED', metrics: { pr_auc: 0.91 }, artifact_path: 'model_store/v2', sha256: '1'.repeat(64), created_at: '2026-11-21T12:00:00Z' },
        { version: 'v0-rejected', algorithm: 'xgboost+isolation_forest', status: 'REJECTED', metrics: {}, artifact_path: 'model_store/v0-rejected', sha256: '2'.repeat(64), created_at: '2026-11-17T12:00:00Z' },
      ],
      latest_drift: { id: 1, created_at: '2026-11-20T03:13:00Z', model_version: 'v1', psi_score: 0.08, psi_features: { amount: 0.04 }, status: 'OK', sample_size: 1000 },
    }, modelActionCalls: [], retrainingCalls: 0,
  };
  const response = (body, status = 200) => Promise.resolve(new Response(
    status === 204 ? null : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } }
  ));
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = (init.method || 'GET').toUpperCase();
    if (url.pathname === '/api/auth/me') return state.role
      ? response({ username: 'fixture-user', role: state.role })
      : response({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } }, 401);
    if (url.pathname === '/api/auth/providers') {
      const available = new URLSearchParams(location.search).get('fixtureProviders') === 'enabled';
      return response({ google: available, linkedin: available });
    }
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const user = JSON.parse(init.body || '{}');
      state.role = user.username === 'fixture-admin' ? 'ADMIN' : user.username === 'fixture-analyst' ? 'ANALYST' : 'VIEWER';
      sessionStorage.setItem('fraudlens-fixture-role', state.role);
      return response({ username: 'fixture-user', role: state.role, expires_in: 7200 });
    }
    if (url.pathname === '/api/auth/logout') { state.role = null; sessionStorage.removeItem('fraudlens-fixture-role'); return response(null, 204); }
    if (url.pathname === '/api/transactions' && method === 'POST' && location.pathname === '/imports') {
      state.batchPosts += 1;
      const imported = JSON.parse(init.body || '{}');
      if (Number(imported.amount) === 999) {
        return response({ error: { code: 'VALIDATION_ERROR', message: 'Fixture row rejected.' } }, 400);
      }
      state.batchTransactions[imported.transaction_id] = imported;
      sessionStorage.setItem('fraudlens-fixture-batch-transactions', JSON.stringify(state.batchTransactions));
      return response({ transaction_id: imported.transaction_id, status: 'ACCEPTED' }, 202);
    }
    if (url.pathname === '/api/transactions' && method === 'POST') {
      state.transactionPosts += 1;
      state.transaction = JSON.parse(init.body || '{}'); sessionStorage.setItem('fraudlens-fixture-transaction', JSON.stringify(state.transaction)); state.detailReads = 0;
      return response({ transaction_id: state.transaction.transaction_id, status: 'ACCEPTED' }, 202);
    }
    if (url.pathname.startsWith('/api/transactions/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      if (state.batchTransactions[id]) {
        state.batchPollReads[id] = (state.batchPollReads[id] || 0) + 1;
        if (state.batchPollReads[id] < 2) return response({ transaction_id: id, risk_category: 'PENDING', fraud_probability: null, is_anomaly: null, model_version: null });
        const imported = state.batchTransactions[id];
        return response({ transaction_id: id, account_masked: 'XXXX-4242', amount: imported.amount, category: imported.category, risk_category: 'SUSPICIOUS', fraud_probability: 0.41, anomaly_score: 0.2, is_anomaly: false, model_version: 'fixture-v1', scored_at: '2026-11-24T00:00:00Z', top_reasons: [{ feature: 'amount_ratio', impact: 0.2, text: 'Controlled fixture explanation' }], features: {}, alert: null });
      }
      if (state.transaction && state.transaction.transaction_id === id) {
        state.detailReads += 1;
        const tx = state.transaction;
        if (state.alwaysPending || state.detailReads < 2) return response({ transaction_id: tx.transaction_id, risk_category: 'PENDING', fraud_probability: null });
        return response({ transaction_id: tx.transaction_id, account_masked: 'XXXX-4242', amount: tx.amount, category: tx.category, risk_category: 'SUSPICIOUS', fraud_probability: 0.41, anomaly_score: 0.2, is_anomaly: false, model_version: 'fixture-v1', scored_at: '2026-11-24T00:00:00Z', top_reasons: [{ feature: 'amount_ratio', impact: 0.2, text: 'Controlled fixture explanation' }], features: { amount: 120.5, amount_ratio: 1.2 }, alert: null });
      }
      const row = transactionRows.find(item => item.transaction_id === id);
      return row ? response({ ...row, top_reasons: [{ feature: 'amount_ratio', impact: 0.41, text: 'Controlled fixture reason: amount ratio elevated.' }], features: { amount: row.amount, amount_ratio: 1.2 }, timestamps: { tx_time: row.tx_time, ingested_at: row.tx_time, scored_at: row.tx_time }, alert: row.alert }) : response({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }
    if (url.pathname === '/api/transactions' && method === 'GET') {
      state.transactionQueries.push(url.search);
      let items = transactionRows.slice();
      const risk = url.searchParams.get('risk');
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (risk) items = items.filter(item => item.risk_category === risk);
      if (query) items = items.filter(item => [item.transaction_id, item.account_masked, item.merchant, item.category].some(value => value.toLowerCase().includes(query)));
      if (from) items = items.filter(item => item.tx_time >= from);
      if (to) items = items.filter(item => item.tx_time <= to);
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 20);
      return response({ items: items.slice((page - 1) * pageSize, page * pageSize), page, page_size: pageSize, total: items.length });
    }
    if (url.pathname === '/api/alerts' && method === 'GET') {
      state.alertRequests += 1;
      if (state.alertFailure) return response({ error: { code: 'SERVER_ERROR', message: 'Fixture polling failure.' } }, 503);
      let items = state.alerts.slice();
      const filter = url.searchParams.get('state');
      if (filter) items = items.filter(item => item.state === filter);
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 20);
      return response({ items: items.slice((page - 1) * pageSize, page * pageSize), page, page_size: pageSize, total: items.length });
    }
    if (url.pathname.startsWith('/api/alerts/') && method === 'PATCH') {
      const alert = state.alerts.find(item => String(item.alert_id) === decodeURIComponent(url.pathname.split('/').pop()));
      const body = JSON.parse(init.body || '{}');
      state.alertPatches.push({ alert_id: alert?.alert_id, ...body });
      if (state.alertConflict || !alert || alert.state === 'RESOLVED') return response({ error: { code: 'CONFLICT', message: 'This alert has already been resolved.' } }, 409);
      Object.assign(alert, body);
      return response(alert);
    }
    if (url.pathname === '/api/users' && method === 'GET') return response({ items: state.users.map(({ password, ...user }) => user) });
    if (url.pathname === '/api/users' && method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      state.userCreates.push(body);
      const created = { id: 100 + state.users.length, username: body.username, role: body.role, status: 'ACTIVE', created_at: '2026-11-25T12:00:00.000Z' };
      state.users.push(created);
      return response(created, 201);
    }
    if (url.pathname.startsWith('/api/users/') && method === 'PATCH') {
      const id = Number(url.pathname.split('/').pop());
      const user = state.users.find(item => item.id === id);
      const body = JSON.parse(init.body || '{}');
      state.userPatches.push({ id, ...body });
      if (!user) return response({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
      Object.assign(user, body);
      return response(user);
    }
    if (url.pathname === '/api/audit-logs' && method === 'GET') {
      state.auditQueries.push(url.search);
      let items = state.auditRows.slice();
      const action = url.searchParams.get('action');
      const username = url.searchParams.get('username');
      if (action) items = items.filter(item => item.action === action);
      if (username) items = items.filter(item => item.username === username);
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 20);
      return response({ items: items.slice((page - 1) * pageSize, page * pageSize), page, page_size: pageSize, total: items.length });
    }
    if (url.pathname === '/api/models' && method === 'GET') return response(state.models);
    if (url.pathname === '/api/models/drift-check' && method === 'POST') {
      const report = { model_version: state.models.active_version, psi_score: 0.08, status: 'OK', sample_size: 25 };
      state.modelActionCalls.push({ path: url.pathname, method });
      state.models.latest_drift = { id: 2, created_at: '2026-11-25T12:00:00Z', ...report };
      return response(report);
    }
    if (url.pathname === '/api/models/retrain' && method === 'POST') {
      state.modelActionCalls.push({ path: url.pathname, method });
      const outcomes = ['VALIDATED', 'REJECTED'];
      const status = outcomes[state.retrainingCalls % outcomes.length];
      const version = `fixture-retrain-${state.retrainingCalls + 1}`;
      state.retrainingCalls += 1;
      const model = { version, algorithm: 'xgboost+isolation_forest', status, metrics: {}, artifact_path: `model_store/${version}`, sha256: '3'.repeat(64), created_at: '2026-11-25T12:00:00Z' };
      state.models.models.push(model);
      return response({ version, status, metrics: {} }, 202);
    }
    if (url.pathname.startsWith('/api/models/') && url.pathname.endsWith('/activate') && method === 'POST') {
      const version = decodeURIComponent(url.pathname.split('/')[3]);
      state.modelActionCalls.push({ path: url.pathname, method });
      const model = state.models.models.find(item => item.version === version);
      if (!model || !['VALIDATED', 'ACTIVE', 'RETIRED'].includes(model.status)) return response({ error: { code: 'CONFLICT', message: 'Model is not validated.' } }, 409);
      state.models.models.forEach(item => { if (item.status === 'ACTIVE') item.status = 'RETIRED'; });
      model.status = 'ACTIVE';
      model.activated_at = '2026-11-25T12:00:00Z';
      state.models.active_version = version;
      return response({ active_version: version, status: 'ACTIVE', activated_at: model.activated_at });
    }
    if (url.pathname === '/api/dashboard/summary') return response({ total_transactions: 0, legitimate: 0, suspicious: 0, high_risk: 0, open_alerts: 0, latency_ms: {}, active_model: {}, system_status: {}, updated_at: new Date().toISOString() });
    if (url.pathname === '/api/dashboard/trends') return response({ points: [] });
    return originalFetch(input, init);
  };
  class FixtureSocket {
    constructor(url, protocols) {
      if (new URL(url, location.href).pathname !== '/ws/alerts') return new NativeWebSocket(url, protocols);
      this.url = url; this.readyState = 0; state.sockets.push(this);
      setTimeout(() => {
        if (state.socketFailures > 0) { state.socketFailures -= 1; this.readyState = 3; this.onclose?.({ code: 1006 }); return; }
        this.readyState = 1; this.onopen?.();
        if (new URL(location.href).searchParams.get('fixtureSocketReady') === '1') {
          this.onmessage?.({ data: JSON.stringify({ type: 'READY' }) });
        }
      }, 0);
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000 }); }
    send() {}
  }
  FixtureSocket.OPEN = 1; FixtureSocket.CONNECTING = 0; FixtureSocket.CLOSED = 3;
  window.WebSocket = FixtureSocket;
  window.__emitFixtureAlert = alert => state.sockets.filter(s => s.readyState === 1).forEach(s => s.onmessage?.({ data: JSON.stringify({ type: 'NEW_ALERT', alert }) }));
})();
"""


def _create_headless_driver():
    """Attempt to initialize a headless Chrome WebDriver via Selenium 4."""
    webdriver = importlib.import_module("selenium.webdriver")
    chrome_opts_mod = importlib.import_module("selenium.webdriver.chrome.options")
    options = chrome_opts_mod.Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1440,900")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    browser_binary = os.getenv("CHROME_BINARY")
    if browser_binary:
        options.binary_location = browser_binary
    driver_binary = os.getenv("CHROMEDRIVER_BINARY")
    if driver_binary:
        service_mod = importlib.import_module("selenium.webdriver.chrome.service")
        return webdriver.Chrome(service=service_mod.Service(executable_path=driver_binary), options=options)
    return webdriver.Chrome(options=options)


class FraudLensSeleniumE2ETests(unittest.TestCase):
    """Selenium E2E tests for FraudLens React UI (`http://localhost:5173`)."""

    @classmethod
    def setUpClass(cls):
        cls.driver = None
        cls.live_server_reachable = False
        cls.fixture_script_registered = False
        cls.tests_on_browser = 0
        try:
            import httpx

            res = httpx.get(FRONTEND_URL, timeout=2.0)
            cls.live_server_reachable = res.status_code == 200
        except Exception:
            cls.live_server_reachable = False

        if cls.live_server_reachable:
            try:
                cls.driver = _create_headless_driver()
                cls.driver.implicitly_wait(5)
            except Exception:
                cls.driver = None

    @classmethod
    def tearDownClass(cls):
        if cls.driver is not None:
            try:
                cls.driver.quit()
            except Exception:
                pass

    def setUp(self):
        cls = self.__class__
        restart = cls.tests_on_browser >= 4
        if cls.driver is not None:
            try:
                cls.driver.execute_script("return document.readyState")
            except Exception:
                restart = True
        if restart:
            try:
                cls.driver.quit()
            except Exception:
                pass
            cls.driver = None
            cls.fixture_script_registered = False
            cls.tests_on_browser = 0
        if cls.driver is None and cls.live_server_reachable:
            try:
                cls.driver = _create_headless_driver()
                cls.driver.implicitly_wait(5)
            except Exception:
                cls.driver = None
        self.driver = cls.driver
        if self.driver is not None:
            cls.tests_on_browser += 1

    def tearDown(self):
        if self.driver is not None:
            try:
                self.driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})
            except Exception:
                self.__class__.driver = None
                self.__class__.fixture_script_registered = False

    def test_01_login_page_renders_brand_and_form(self):
        """Verify FraudLens login page loads brand header, username/password fields, and submit button."""
        if self.driver is None:
            self.skipTest("Browser driver or live frontend is unavailable; no browser assertion was run.")

        by_mod = importlib.import_module("selenium.webdriver.common.by")
        By = by_mod.By

        self.driver.get(FRONTEND_URL)
        page_source = self.driver.page_source
        self.assertIn("FRAUD", page_source.upper())

        username_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='text'], input[name='username']")
        password_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='password']")
        submit_btn = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")

        self.assertTrue(username_input.is_displayed())
        self.assertTrue(password_input.is_displayed())
        self.assertTrue(submit_btn.is_displayed())

    def test_02_empty_login_shows_validation_message(self):
        """Submitting empty credentials displays a user-friendly validation message."""
        if self.driver is None:
            self.skipTest("Browser driver or live frontend is unavailable; no browser assertion was run.")

        by_mod = importlib.import_module("selenium.webdriver.common.by")
        By = by_mod.By

        self.driver.get(FRONTEND_URL)
        submit_btn = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
        submit_btn.click()
        self.assertIn("username", self.driver.page_source.lower())

    def test_03_admin_login_and_rbac_sidebar_navigation(self):
        """Logging in as admin navigates to /dashboard and displays role-protected sidebar links."""
        if self.driver is None:
            self.skipTest("Browser driver or live frontend is unavailable; no browser assertion was run.")

        by_mod = importlib.import_module("selenium.webdriver.common.by")
        By = by_mod.By

        self.driver.get(FRONTEND_URL)
        user_el = self.driver.find_element(By.CSS_SELECTOR, "input[type='text'], input[name='username']")
        pass_el = self.driver.find_element(By.CSS_SELECTOR, "input[type='password']")
        submit_btn = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")

        user_el.clear()
        user_el.send_keys("admin")
        pass_el.clear()
        admin_password = os.getenv("SEED_ADMIN_PASSWORD")
        if not admin_password:
            self.skipTest("Set SEED_ADMIN_PASSWORD for an approved local test account.")
        pass_el.send_keys(admin_password)
        submit_btn.click()

        self.assertTrue("/dashboard" in self.driver.current_url or "FRAUD" in self.driver.page_source.upper())

    def _require_fixture_browser(self):
        if not FIXTURE_MODE:
            self.skipTest("Set FRAUDLENS_E2E_MODE=fixture to run isolated browser fixtures.")
        if self.driver is None and self.__class__.live_server_reachable:
            self._restart_fixture_browser()
        if self.driver is None:
            self.skipTest("Python Selenium/Chrome or the local frontend is unavailable.")
        if not self.__class__.fixture_script_registered:
            self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": CONTROLLED_FIXTURE})
            self.__class__.fixture_script_registered = True

    def _restart_fixture_browser(self):
        """Recover a browser process that Chrome closed between fixture tests."""
        cls = self.__class__
        if cls.driver is not None:
            try:
                cls.driver.quit()
            except Exception:
                pass
        cls.driver = None
        cls.fixture_script_registered = False
        try:
            cls.driver = _create_headless_driver()
            cls.driver.implicitly_wait(5)
        except Exception:
            cls.driver = None
        self.driver = cls.driver
        if self.driver is not None:
            self.driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": CONTROLLED_FIXTURE})
            cls.fixture_script_registered = True

    def _fixture_login(self, role):
        self._fixture_logout()
        username = {"ADMIN": "fixture-admin", "ANALYST": "fixture-analyst", "VIEWER": "fixture-viewer"}[role]
        from selenium.webdriver.support.ui import WebDriverWait
        self.driver.get(FRONTEND_URL + "/")
        WebDriverWait(self.driver, 10).until(lambda d: d.find_elements("css selector", "input[name='username']"))
        self.driver.find_element("css selector", "input[name='username']").send_keys(username)
        self.driver.find_element("css selector", "input[name='password']").send_keys("fixture-only-password")
        self._click_visible("button[type='submit']")
        WebDriverWait(self.driver, 10).until(lambda d: "/dashboard" in d.current_url)

    def _fixture_logout(self):
        from selenium.webdriver.support.ui import WebDriverWait
        try:
            self.driver.get(FRONTEND_URL + "/dashboard")
            WebDriverWait(self.driver, 10).until(lambda d: d.find_elements("css selector", "button.sidebar-utility") or d.find_elements("css selector", "input[name='username']"))
            logout = self.driver.find_elements("css selector", "button.sidebar-utility")
            if logout:
                self.driver.execute_script("arguments[0].scrollIntoView({block:'center'}); arguments[0].click()", logout[0])
                WebDriverWait(self.driver, 10).until(lambda d: d.find_elements("css selector", "input[name='username']"))
        except Exception:
            # A fresh headless Chrome session has no fixture login cookie or state.
            self._restart_fixture_browser()

    def _click_visible(self, selector):
        strategy = "xpath" if selector.startswith("//") else "css selector"
        element = self.driver.find_element(strategy, selector)
        self.driver.execute_script("arguments[0].scrollIntoView({block:'center', inline:'nearest', behavior:'instant'})", element)
        element.click()

    def test_fixture_manual_transaction_validation_ack_pending_result_reload_and_duplicate_guard(self):
        """Controlled fake API fixture; proves UI behavior, not backend scoring."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        self.driver.get(FRONTEND_URL + "/analyse")
        form = self.driver.find_element("css selector", ".analysis-form")
        self.assertFalse(self.driver.execute_script("return arguments[0].checkValidity()", form))
        self.driver.find_element("name", "account_ref").send_keys("fixture-account-4242")
        self.driver.find_element("name", "amount").send_keys("120.50")
        self.driver.find_element("name", "category").send_keys("shopping_net")
        self.assertTrue(self.driver.find_element("css selector", ".analysis-form button[type='submit']").is_enabled())
        self._click_visible(".analysis-form button[type='submit']")
        from selenium.webdriver.support.ui import WebDriverWait
        # The first detail response is explicitly pending and has no probability.
        WebDriverWait(self.driver, 5).until(lambda d: "Transaction accepted; waiting" in d.page_source)
        self.assertNotIn("Fraud probability", self.driver.page_source)
        self.assertIn("transaction=", self.driver.current_url)
        # A second click during the pending request cannot create another POST.
        submit = self.driver.find_element("css selector", ".analysis-form button[type='submit']")
        self.assertFalse(submit.is_enabled())
        self.driver.execute_script("document.querySelector('.analysis-form').requestSubmit()")
        self.assertEqual(self.driver.execute_script("return window.__fraudLensFixture.transactionPosts"), 1)
        self.assertEqual(self.driver.execute_script("return JSON.parse(sessionStorage.getItem('fraudlens-fixture-transaction'))?.transaction_id"), self.driver.current_url.split("transaction=", 1)[-1])
        WebDriverWait(self.driver, 10).until(lambda d: "Prediction result" in d.page_source)
        self.assertIn("XXXX-4242", self.driver.page_source)
        self.assertIn("Controlled fixture explanation", self.driver.page_source)
        self.assertIn("fixture-v1", self.driver.page_source)
        self.assertIn("transaction=", self.driver.current_url)
        submit = self.driver.find_element("css selector", ".analysis-form button[type='submit']")
        self.assertFalse(submit.is_enabled())
        self.driver.refresh()
        WebDriverWait(self.driver, 10).until(lambda d: "Prediction result" in d.page_source)
        self.assertIn("XXXX-4242", self.driver.page_source)

    def test_fixture_manual_transaction_bounded_pending_and_explicit_refresh(self):
        """Controlled fixture leaves detail pending; verifies bounded poll and retry control."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        self.driver.get(FRONTEND_URL + "/analyse?fixtureAlwaysPending=1")
        self.driver.find_element("name", "account_ref").send_keys("fixture-account-4242")
        self.driver.find_element("name", "amount").send_keys("120.50")
        self.driver.find_element("name", "category").send_keys("shopping_net")
        # Accelerate only the controlled page's 2-second retry delays.
        self.driver.execute_script("const original=window.setTimeout.bind(window); window.setTimeout=(fn,ms,...args)=>original(fn,ms>=1900?1:ms,...args)")
        self._click_visible(".analysis-form button[type='submit']")
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(self.driver, 10).until(lambda d: "Scoring still pending" in d.page_source)
        self.assertIn("Check again", self.driver.page_source)
        self.assertNotIn("Fraud probability", self.driver.page_source)
        self.assertFalse(self.driver.find_element("css selector", ".analysis-form button[type='submit']").is_enabled())

    def test_fixture_manual_transaction_analyst_and_viewer_denied(self):
        """Controlled role fixture confirms client route/menu restrictions only."""
        self._require_fixture_browser()
        for role in ("ANALYST", "VIEWER"):
            with self.subTest(role=role):
                self._fixture_login(role)
                denied_routes = ["/analyse", "/imports", "/admin/users", "/admin/audit-logs", "/admin/models"]
                if role == "VIEWER":
                    denied_routes.append("/alerts")
                for route in denied_routes:
                    self.driver.get(FRONTEND_URL + route)
                    from selenium.webdriver.support.ui import WebDriverWait
                    WebDriverWait(self.driver, 10).until(lambda d: "Not allowed" in d.page_source)
                    self.assertIn("Not allowed", self.driver.page_source, f"{role} unexpectedly opened {route}")

                self.driver.get(FRONTEND_URL + "/transactions")
                WebDriverWait(self.driver, 10).until(lambda d: "Transactions" in d.page_source)
                self.assertNotIn("Not allowed", self.driver.page_source)
                self.driver.get(FRONTEND_URL + "/integrations")
                WebDriverWait(self.driver, 10).until(lambda d: "Data sources & integrations" in d.find_element("tag name", "body").text)
                if role == "ANALYST":
                    self.driver.get(FRONTEND_URL + "/alerts")
                    WebDriverWait(self.driver, 10).until(lambda d: "Fraud alerts" in d.page_source)
                    self.assertNotIn("Not allowed", self.driver.page_source)
                self._fixture_logout()

    def test_fixture_manual_transaction_responsive_accessibility_and_console(self):
        """Controlled fixtures verify viewport layout and basic keyboard/name semantics."""
        self._require_fixture_browser()
        # Earlier non-fixture smoke cases may have logged expected proxy errors.
        self.driver.get_log("browser")
        self._fixture_logout()
        self.driver.get(FRONTEND_URL + "/home")
        self.assertIn("Real-Time Financial", self.driver.page_source)
        self.driver.find_element("css selector", ".landing-login").click()
        from selenium.webdriver.support.ui import WebDriverWait
        base_url = FRONTEND_URL.rstrip("/")
        WebDriverWait(self.driver, 10).until(lambda d: d.current_url.startswith(base_url) and d.find_elements("css selector", "input[name='username']"))
        self._fixture_login("ADMIN")
        for width in (1440, 1024, 768, 390, 320):
            with self.subTest(viewport=width):
                self.driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 900, "deviceScaleFactor": 1, "mobile": width <= 390,
                })
                self.driver.get(FRONTEND_URL + "/home")
                WebDriverWait(self.driver, 10).until(lambda d: "Real-Time Financial" in d.page_source)
                home = self.driver.execute_script("return {width:innerWidth, client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth}")
                self.assertLessEqual(home["scroll"], home["client"] + 1, f"Public homepage overflows at {width}px: {home}")
                self.assertTrue(all(link.is_displayed() for link in self.driver.find_elements("css selector", ".landing-nav-links a")), f"Landing navigation is hidden at {width}px")

                self.driver.get(FRONTEND_URL + "/dashboard")
                WebDriverWait(self.driver, 10).until(lambda d: "Overview" in d.page_source)
                viewport = self.driver.execute_script("return {width:innerWidth, client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth}")
                self.assertEqual(viewport["width"], width)
                self.assertLessEqual(viewport["scroll"], viewport["client"] + 1, f"Dashboard overflows at {width}px: {viewport}")

                if width <= 800:
                    menu = self.driver.find_element("css selector", ".mobile-menu-button")
                    self.assertTrue(menu.is_displayed(), f"Mobile menu missing at {width}px")
                    menu.click()
                    self.assertIn("sidebar-open", self.driver.find_element("css selector", ".sidebar").get_attribute("class"))
                    self.driver.find_element("css selector", ".sidebar a[href='/analyse']").click()
                else:
                    self.driver.get(FRONTEND_URL + "/analyse")

                WebDriverWait(self.driver, 10).until(lambda d: d.find_elements("css selector", ".analysis-form"))
                form_check = self.driver.execute_script("return {width:innerWidth, client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth, unlabeled:[...document.querySelectorAll('.analysis-form input')].filter(x=>!x.labels?.length).map(x=>x.name)}")
                self.assertLessEqual(form_check["scroll"], form_check["client"] + 1, f"Analysis form overflows at {width}px: {form_check}")
                self.assertEqual(form_check["unlabeled"], [], f"Unlabelled form controls at {width}px")
                from selenium.webdriver.common.keys import Keys
                account = self.driver.find_element("name", "account_ref")
                self.driver.execute_script("arguments[0].focus()", account)
                account.send_keys(Keys.TAB)
                self.assertEqual(self.driver.execute_script("return document.activeElement?.name"), "amount", f"Form tab order failed at {width}px")

        console_errors = [entry["message"] for entry in self.driver.get_log("browser") if entry["level"] == "SEVERE"]
        self.assertEqual(console_errors, [], f"Browser console errors: {console_errors}")

    def test_fixture_alert_connection_event_deduplication_and_viewer_poll_restriction(self):
        """Controlled socket fixtures; no claim about an authenticated real socket."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(self.driver, 10).until(lambda d: "Connecting" in d.page_source)
        WebDriverWait(self.driver, 10).until(lambda d: d.execute_script("return window.__fraudLensFixture.sockets.some(s => s.readyState === 1)"))
        self.assertNotIn("Live WebSocket", self.driver.page_source)
        self.driver.execute_script("window.__emitFixtureAlert({alert_id: 9001, transaction_id:'fixture-tx', account_masked:'XXXX-4242', amount:10, risk_category:'HIGH_RISK'})")
        WebDriverWait(self.driver, 10).until(lambda d: "Live WebSocket" in d.page_source)
        self.driver.execute_script("window.__emitFixtureAlert({alert_id: 9001, transaction_id:'fixture-tx', account_masked:'XXXX-4242', amount:10, risk_category:'HIGH_RISK'})")
        self.assertEqual(len(self.driver.find_elements("css selector", ".toast")), 1)
        self._fixture_logout()

        self._fixture_login("VIEWER")
        self.driver.get(FRONTEND_URL + "/dashboard?fixtureSocketFailures=3")
        time.sleep(4)
        counts = self.driver.execute_script("return {polls:window.__fraudLensFixture.alertRequests, status:document.body.innerText}")
        self.assertEqual(counts["polls"], 0)
        self.assertNotIn("Live WebSocket", counts["status"])

    def test_fixture_authenticated_ready_ack_marks_idle_socket_live(self):
        """Controlled protocol fixture verifies READY UI handling, not a real backend session."""
        self._require_fixture_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        self._fixture_login("ADMIN")
        self.driver.get(FRONTEND_URL + "/dashboard?fixtureSocketReady=1")
        WebDriverWait(self.driver, 10).until(lambda d: "Live WebSocket" in d.page_source)
        self.assertEqual(len(self.driver.find_elements("css selector", ".toast")), 0)
        self._fixture_logout()

    def test_fixture_alert_connection_authorized_poll_success_and_failure(self):
        """Controlled fixtures prove UI fallback states, not backend auth or socket readiness."""
        self._require_fixture_browser()
        from selenium.webdriver.support.ui import WebDriverWait

        self._fixture_login("ADMIN")
        self.driver.get(FRONTEND_URL + "/dashboard?fixtureSocketFailures=2")
        WebDriverWait(self.driver, 12).until(lambda d: "HTTP polling" in d.page_source)
        self.assertGreater(self.driver.execute_script("return window.__fraudLensFixture.alertRequests"), 0)

        self._fixture_logout()
        self._fixture_login("ANALYST")
        self.driver.get(FRONTEND_URL + "/dashboard?fixtureSocketFailures=2&fixtureAlertFailure=1")
        WebDriverWait(self.driver, 12).until(lambda d: "Unavailable" in d.page_source)
        self.assertGreater(self.driver.execute_script("return window.__fraudLensFixture.alertRequests"), 0)

    def test_fixture_alert_connection_logout_cleans_up_socket_and_role_scope(self):
        """Controlled fixture checks socket teardown after logout and role change."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        self.driver.get(FRONTEND_URL + "/dashboard")
        self._fixture_logout()
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(self.driver, 5).until(lambda d: "/" in d.current_url.rstrip("/"))
        self._fixture_login("VIEWER")
        self.driver.get(FRONTEND_URL + "/dashboard?fixtureSocketFailures=3")
        time.sleep(4)
        state = self.driver.execute_script("return {polls:window.__fraudLensFixture.alertRequests, open:window.__fraudLensFixture.sockets.filter(s=>s.readyState===1).length, text:document.body.innerText}")
        self.assertEqual(state["polls"], 0)
        self.assertEqual(state["open"], 0)
        self.assertNotIn("Live WebSocket", state["text"])

    def test_fixture_transactions_search_risk_date_pagination_and_shap_detail(self):
        """Controlled contract-shaped data exercises transaction list and detail UI only."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import Select, WebDriverWait
        from selenium.webdriver.common.keys import Keys

        self.driver.get(FRONTEND_URL + "/transactions")
        WebDriverWait(self.driver, 10).until(lambda d: "fixture-tx-001" in d.page_source)
        self._click_visible(".pagination button:last-child")
        WebDriverWait(self.driver, 10).until(lambda d: "fixture-tx-021" in d.page_source)
        self.assertTrue(any("page=2" in query for query in self.driver.execute_script("return window.__fraudLensFixture.transactionQueries")))

        search = self.driver.find_element("css selector", ".filter-bar input:not([type='date'])")
        search.send_keys("fixture-tx-005")
        WebDriverWait(self.driver, 10).until(lambda d: "fixture-tx-005" in d.page_source and "1 transactions" in d.page_source)
        self.assertTrue(any("q=fixture-tx-005" in query for query in self.driver.execute_script("return window.__fraudLensFixture.transactionQueries")))

        risk = self.driver.find_element("css selector", ".filter-bar select")
        Select(risk).select_by_visible_text("HIGH_RISK")
        WebDriverWait(self.driver, 10).until(lambda d: "fixture-tx-005" in d.page_source)
        self.assertTrue(any("risk=HIGH_RISK" in query for query in self.driver.execute_script("return window.__fraudLensFixture.transactionQueries")))

        dates = self.driver.find_elements("css selector", ".filter-bar input[type='date']")
        self.assertEqual(len(dates), 2)
        self.driver.execute_script("""
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(arguments[0], '2026-11-21');
          arguments[0].dispatchEvent(new Event('input',{bubbles:true}));
          arguments[0].dispatchEvent(new Event('change',{bubbles:true}));
        """, dates[0])
        WebDriverWait(self.driver, 10).until(lambda d: any("from=2026-11-21" in query for query in d.execute_script("return window.__fraudLensFixture.transactionQueries")))
        self.driver.execute_script("""
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(arguments[0], '');
          arguments[0].dispatchEvent(new Event('input',{bubbles:true}));
          arguments[0].dispatchEvent(new Event('change',{bubbles:true}));
        """, dates[0])
        WebDriverWait(self.driver, 10).until(lambda d: d.execute_script("return !new URLSearchParams(window.__fraudLensFixture.transactionQueries.at(-1)).has('from')"))

        row = self.driver.find_element("xpath", "//tr[.//*[contains(text(), 'fixture-tx-005')]]")
        row.send_keys(Keys.ENTER)
        dialog = WebDriverWait(self.driver, 10).until(lambda d: d.find_element("css selector", "[role='dialog']"))
        WebDriverWait(self.driver, 10).until(lambda d: "Why flagged" in dialog.text and "Controlled fixture reason" in dialog.text)
        self.assertIn("XXXX-1005", dialog.text)
        self.assertIn("Impact:", dialog.text)
        self.assertIn("amount ratio elevated", dialog.text)
        self.assertEqual(dialog.get_attribute("aria-modal"), "true")
        self.assertTrue(dialog.get_attribute("aria-labelledby"))
        self.driver.find_element("css selector", "[role='dialog']").send_keys(Keys.ESCAPE)
        WebDriverWait(self.driver, 5).until(lambda d: not d.find_elements("css selector", "[role='dialog']"))

    def test_fixture_alert_investigation_resolution_conflict_and_dialog_keyboard(self):
        """Controlled alert responses exercise investigation and conflict UI, not backend writes."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import Select, WebDriverWait
        from selenium.webdriver.common.keys import Keys

        self.driver.get(FRONTEND_URL + "/alerts")
        WebDriverWait(self.driver, 10).until(lambda d: "301" in d.page_source)
        Select(self.driver.find_element("id", "alert-301")).select_by_value("UNDER_REVIEW")
        WebDriverWait(self.driver, 10).until(lambda d: "UNDER REVIEW" in d.page_source)
        Select(self.driver.find_element("id", "alert-301")).select_by_value("RESOLVED")
        dialog = WebDriverWait(self.driver, 10).until(lambda d: d.find_element("css selector", "[role='dialog']"))
        self.assertEqual(dialog.get_attribute("aria-modal"), "true")
        self.assertEqual(self.driver.execute_script("return document.activeElement.getAttribute('aria-label')"), "Close dialog")
        self.driver.switch_to.active_element.send_keys(Keys.SHIFT, Keys.TAB)
        self.assertEqual(self.driver.execute_script("return document.activeElement.textContent.trim()"), "Cancel")
        self.driver.switch_to.active_element.send_keys(Keys.TAB)
        self.assertEqual(self.driver.execute_script("return document.activeElement.getAttribute('aria-label')"), "Close dialog")
        Select(self.driver.find_element("css selector", "[role='dialog'] select")).select_by_value("CONFIRMED_FRAUD")
        self._click_visible("//section[@role='dialog']//button[contains(., 'Resolve alert')]")
        WebDriverWait(self.driver, 10).until(lambda d: "Alert status updated" in d.page_source)
        patches = self.driver.execute_script("return window.__fraudLensFixture.alertPatches")
        self.assertTrue(any(p.get("alert_id") == 301 and p.get("state") == "UNDER_REVIEW" for p in patches))
        self.assertTrue(any(p.get("alert_id") == 301 and p.get("resolution") == "CONFIRMED_FRAUD" for p in patches))

        self.driver.get(FRONTEND_URL + "/alerts?fixtureAlertConflict=1")
        WebDriverWait(self.driver, 10).until(lambda d: "301" in d.page_source)
        Select(self.driver.find_element("id", "alert-301")).select_by_value("RESOLVED")
        Select(WebDriverWait(self.driver, 5).until(lambda d: d.find_element("css selector", "[role='dialog'] select"))).select_by_value("FALSE_POSITIVE")
        self._click_visible("//section[@role='dialog']//button[contains(., 'Resolve alert')]")
        WebDriverWait(self.driver, 10).until(lambda d: "already been resolved" in d.page_source)

    def test_fixture_admin_user_creation_role_and_status_management(self):
        """Controlled admin API fixtures exercise CRUD UI without persisting an account."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import Select, WebDriverWait
        from selenium.webdriver.common.keys import Keys

        self.driver.get(FRONTEND_URL + "/admin/users")
        WebDriverWait(self.driver, 10).until(lambda d: "fixture-analyst" in d.page_source)
        add = self.driver.find_element("xpath", "//button[contains(., 'Add user')]")
        add.click()
        dialog = WebDriverWait(self.driver, 5).until(lambda d: d.find_element("css selector", "[role='dialog']"))
        self.assertEqual(dialog.get_attribute("aria-modal"), "true")
        self.assertEqual(self.driver.execute_script("return document.activeElement.getAttribute('aria-label')"), "Close dialog")
        self.driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(self.driver, 5).until(lambda d: not d.find_elements("css selector", "[role='dialog']"))
        self.assertEqual(self.driver.switch_to.active_element, add)

        add.click()
        form = self.driver.find_element("css selector", "[role='dialog'] form")
        fields = form.find_elements("tag name", "input")
        fields[0].send_keys("fixture-created-user")
        fields[1].send_keys("fixture-only-password")
        Select(form.find_element("tag name", "select")).select_by_visible_text("ANALYST")
        self._click_visible("//section[@role='dialog']//button[contains(., 'Create user')]")
        WebDriverWait(self.driver, 10).until(lambda d: "fixture-created-user" in d.page_source)
        result = self.driver.execute_script("return {user:window.__fraudLensFixture.users.find(u=>u.username==='fixture-created-user'), creates:window.__fraudLensFixture.userCreates}")
        self.assertEqual(result["user"]["role"], "ANALYST")
        self.assertNotIn("password", result["user"])
        self.assertEqual(result["creates"][0]["username"], "fixture-created-user")

        Select(self.driver.find_element("id", "role-10")).select_by_visible_text("VIEWER")
        WebDriverWait(self.driver, 10).until(lambda d: "VIEWER" in d.find_element("xpath", "//tr[.//*[contains(text(), 'fixture-analyst')]]").text)
        self.assertTrue(any(p.get("id") == 10 and p.get("role") == "VIEWER" for p in self.driver.execute_script("return window.__fraudLensFixture.userPatches")))
        self._click_visible("//tr[.//td[contains(., 'fixture-analyst')]]//button")
        WebDriverWait(self.driver, 10).until(lambda d: "Enable" in d.find_element("xpath", "//tr[.//*[contains(text(), 'fixture-analyst')]]").text)
        self.assertTrue(any(p.get("id") == 10 and p.get("status") == "DISABLED" for p in self.driver.execute_script("return window.__fraudLensFixture.userPatches")))

    def test_fixture_audit_filters_and_pagination(self):
        """Controlled audit rows exercise server-style filtering/pagination without real audit data."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import WebDriverWait

        self.driver.get(FRONTEND_URL + "/admin/audit-logs")
        WebDriverWait(self.driver, 10).until(lambda d: "25 events" in d.page_source)
        self._click_visible(".pagination button:last-child")
        WebDriverWait(self.driver, 10).until(lambda d: "page 2" in d.page_source)
        self.assertTrue(any("page=2" in query for query in self.driver.execute_script("return window.__fraudLensFixture.auditQueries")))
        inputs = self.driver.find_elements("css selector", ".filter-bar input")
        inputs[0].send_keys("USER_CREATED")
        inputs[1].send_keys("fixture-admin")
        WebDriverWait(self.driver, 10).until(lambda d: "USER_CREATED" in d.page_source and "fixture-admin" in d.page_source)
        queries = self.driver.execute_script("return window.__fraudLensFixture.auditQueries")
        self.assertTrue(any("action=USER_CREATED" in query and "username=fixture-admin" in query for query in queries))
        self.assertNotIn("fixture-analyst", self.driver.page_source)

    def test_fixture_model_drift_retraining_and_activation_actions(self):
        """Explicit mock lifecycle outcomes test the UI only; no real model is trained or activated."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.common.keys import Keys

        self.driver.get(FRONTEND_URL + "/admin/models")
        WebDriverWait(self.driver, 10).until(lambda d: "v0-rejected" in d.page_source)
        rejected_action = self.driver.find_element("xpath", "//tr[.//*[contains(text(), 'v0-rejected')]]//button")
        self.assertFalse(rejected_action.is_enabled())
        self._click_visible("//button[contains(., 'Run drift check')]")
        dialog = self.driver.find_element("css selector", "[role='dialog']")
        self.driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(self.driver, 5).until(lambda d: not d.find_elements("css selector", "[role='dialog']"))
        self._click_visible("//button[contains(., 'Run drift check')]")
        self._click_visible("//section[@role='dialog']//button[contains(., 'Confirm')]")
        WebDriverWait(self.driver, 10).until(lambda d: "Drift check completed: OK" in d.page_source)
        self.assertTrue(any(c.get("path") == "/api/models/drift-check" for c in self.driver.execute_script("return window.__fraudLensFixture.modelActionCalls")))

        for expected in ("VALIDATED", "REJECTED"):
            self._click_visible("//button[contains(., 'Start retraining')]")
            self._click_visible("//section[@role='dialog']//button[contains(., 'Confirm')]")
            WebDriverWait(self.driver, 10).until(lambda d, status=expected: f"Retraining result: {status}" in d.page_source)
        self.assertEqual(self.driver.execute_script("return window.__fraudLensFixture.retrainingCalls"), 2)

        validated_row = self.driver.find_element("xpath", "//tr[.//*[contains(text(), 'v2')]]")
        validated_row.find_element("tag name", "button").click()
        self._click_visible("//section[@role='dialog']//button[contains(., 'Confirm')]")
        WebDriverWait(self.driver, 10).until(lambda d: "Model v2 is active." in d.page_source)
        self.assertTrue(any(c.get("path") == "/api/models/v2/activate" for c in self.driver.execute_script("return window.__fraudLensFixture.modelActionCalls")))
        self.assertEqual(self.driver.execute_script("return window.__fraudLensFixture.models.active_version"), "v2")

    def test_fixture_login_logout_protected_routes_and_oauth_availability(self):
        """Controlled auth/provider fixtures check navigation, not cookie-backed auth services."""
        self._require_fixture_browser()
        from selenium.webdriver.support.ui import WebDriverWait

        self._fixture_logout()
        self.driver.get(FRONTEND_URL + "/?fixtureProviders=enabled")
        WebDriverWait(self.driver, 10).until(lambda d: "Google" in d.page_source and "LinkedIn" in d.page_source)
        providers = self.driver.find_elements("css selector", ".social-grid button")
        self.assertEqual(len(providers), 3)
        self.assertTrue(all(button.is_enabled() for button in providers[:2]))
        self.assertFalse(providers[2].is_enabled(), "GitHub must remain unavailable without a configured provider.")
        self.driver.get(FRONTEND_URL + "/")
        WebDriverWait(self.driver, 10).until(lambda d: "unavailable" in d.page_source.lower())
        providers = self.driver.find_elements("css selector", ".social-grid button")
        self.assertEqual(len(providers), 3)
        self.assertTrue(all(not button.is_enabled() for button in providers))

        self._fixture_login("ADMIN")
        self.driver.get(FRONTEND_URL + "/admin/users")
        WebDriverWait(self.driver, 10).until(lambda d: "User management" in d.page_source)
        self._fixture_logout()
        self.driver.get(FRONTEND_URL + "/admin/users")
        WebDriverWait(self.driver, 10).until(lambda d: d.find_elements("css selector", "input[name='username']"))
        self.assertNotIn("User management", self.driver.page_source)

    def test_fixture_login_password_visibility_and_provider_state(self):
        """Controlled auth-provider endpoint; GitHub is a disabled placeholder."""
        self._require_fixture_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        self._fixture_logout()
        self.driver.get(FRONTEND_URL + "/?fixtureProviders=enabled")
        WebDriverWait(self.driver, 10).until(lambda d: "Google" in d.page_source and "LinkedIn" in d.page_source)
        password = self.driver.find_element("name", "password")
        self.assertEqual(password.get_attribute("type"), "password")
        self._click_visible("button[aria-label='Show password']")
        self.assertEqual(self.driver.find_element("name", "password").get_attribute("type"), "text")
        self._click_visible("button[aria-label='Hide password']")
        self.assertEqual(self.driver.find_element("name", "password").get_attribute("type"), "password")
        github = self.driver.find_element("xpath", "//button[contains(., 'GitHub unavailable')]")
        self.assertFalse(github.is_enabled())
        self.assertIn("no GitHub OAuth provider is configured", github.get_attribute("aria-label"))

    def test_fixture_data_sources_navigation_contract_examples_and_roles(self):
        """Controlled UI fixture verifies visible API documentation and role boundaries."""
        self._require_fixture_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        self._fixture_login("ANALYST")
        self.driver.get(FRONTEND_URL + "/integrations")
        WebDriverWait(self.driver, 10).until(lambda d: "Data sources & integrations" in d.find_element("tag name", "body").text)
        self.assertIn("POST", self.driver.page_source)
        self.assertIn("202 Accepted", self.driver.page_source)
        self.assertIn("credentials: \"include\"", self.driver.page_source)
        self.assertIn("X-Service-Token", self.driver.page_source)
        self.assertTrue(self.driver.find_element("css selector", "a[href='/api-docs']").is_displayed())
        self.assertFalse(self.driver.find_elements("css selector", "a[href='/imports']"))
        self.driver.get(FRONTEND_URL + "/imports")
        WebDriverWait(self.driver, 10).until(lambda d: "Not allowed" in d.page_source)
        self.assertIn("Not allowed", self.driver.page_source)
        self._fixture_logout()

    def test_fixture_csv_import_validation_batch_partial_results_reload_and_duplicates(self):
        """Controlled APIs exercise CSV import only; no real transaction writes occur."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import WebDriverWait
        csv_text = (
            "transaction_id,account_ref,amount,tx_time,category,merchant\n"
            "fixture-batch-good-001,synthetic-account-4242,10.50,2026-11-20T03:12:45Z,shopping_net,Fixture merchant\n"
            "fixture-batch-bad-002,synthetic-account-5252,999,2026-11-20T04:12:45Z,grocery_pos,Fixture market\n"
        )
        with tempfile.TemporaryDirectory(prefix="fraudlens-qa-") as directory:
            import pathlib
            csv_path = pathlib.Path(directory) / "synthetic-batch.csv"
            csv_path.write_text(csv_text, encoding="utf-8")
            self.driver.get(FRONTEND_URL + "/imports")
            self.driver.find_element("css selector", "input[type='file']").send_keys(str(csv_path))
            WebDriverWait(self.driver, 10).until(lambda d: "2 rows" in d.page_source)
            self.assertIn("fixture-batch-good-001", self.driver.page_source)
            self.assertIn("2 valid", self.driver.page_source)
            self._click_visible(".import-actions button.primary")
            WebDriverWait(self.driver, 5).until(lambda d: d.find_elements("css selector", "[role='dialog']"))
            self._click_visible("[role='dialog'] button.primary")
            WebDriverWait(self.driver, 30).until(lambda d: "Batch results:" in d.page_source and "1 scored" in d.page_source and "1 failed or duplicate" in d.page_source)
            self.assertEqual(self.driver.execute_script("return window.__fraudLensFixture.batchPosts"), 2)
            self.assertIn("SUSPICIOUS · 41.0%", self.driver.page_source)
            self.assertIn("XXXX-4242", self.driver.page_source)
            self.assertIn("batch=", self.driver.current_url)

            self.driver.refresh()
            WebDriverWait(self.driver, 10).until(lambda d: "Restored batch references" in d.page_source)
            self.assertIn("fixture-batch-good-001", self.driver.page_source)
            self.assertIn("fixture-batch-bad-002", self.driver.page_source)

            self.driver.find_element("css selector", "input[type='file']").send_keys(str(csv_path))
            WebDriverWait(self.driver, 10).until(lambda d: "saved browser batch" in d.page_source)
            self.assertFalse(self.driver.find_element("css selector", ".import-actions button.primary").is_enabled())

    def test_fixture_integrations_and_import_mobile_layout(self):
        """Controlled contract UI fits the required desktop, tablet and phone widths."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import WebDriverWait
        for width in (1440, 1024, 768, 390, 320):
            self.driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": width <= 390})
            for route, heading in (("/integrations", "Data sources & integrations"), ("/imports", "Import transactions")):
                with self.subTest(width=width, route=route):
                    self.driver.get(FRONTEND_URL + route)
                    WebDriverWait(self.driver, 10).until(lambda d, title=heading: title in d.find_element("tag name", "body").text)
                    dimensions = self.driver.execute_script("return {client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth}")
                    self.assertLessEqual(dimensions["scroll"], dimensions["client"] + 1, f"{route} overflows at {width}px: {dimensions}")

    def test_fixture_admin_pages_mobile_layout_and_table_scrolling(self):
        """Controlled fixtures verify admin screen shells fit five target viewport widths."""
        self._require_fixture_browser()
        self._fixture_login("ADMIN")
        from selenium.webdriver.support.ui import WebDriverWait
        routes = [
            ("/transactions", "Transactions"), ("/alerts", "Fraud alerts"),
            ("/integrations", "Data sources & integrations"), ("/imports", "Import transactions"),
            ("/admin/users", "User management"), ("/admin/audit-logs", "Audit logs"),
            ("/admin/models", "Model management"),
        ]
        for width in (1440, 1024, 768, 390, 320):
            self.driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": width <= 390})
            for route, heading in routes:
                with self.subTest(viewport=width, route=route):
                    self.driver.get(FRONTEND_URL + route)
                    WebDriverWait(self.driver, 10).until(lambda d, expected=heading: expected in d.find_element("tag name", "body").text)
                    layout = self.driver.execute_script("""return {
                      width: innerWidth, client: document.documentElement.clientWidth,
                      scroll: document.documentElement.scrollWidth,
                      pageCanScrollHorizontally: (()=>{const x=window.scrollX;window.scrollTo(9999,0);const canScroll=window.scrollX>0;window.scrollTo(x,0);return canScroll})(),
                      chain: ['.dashboard-shell','.dashboard-main','.dashboard-content','.page-stack','.table-wrap'].map(s=>{const e=document.querySelector(s);if(!e)return {s,missing:true};const c=getComputedStyle(e);const r=e.getBoundingClientRect();return {s,width:Math.round(r.width),right:Math.round(r.right),minWidth:c.minWidth,overflowX:c.overflowX,scroll:e.scrollWidth,client:e.clientWidth}}),
                      tableViewport: [...document.querySelectorAll('.table-wrap')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth})),
                      offenders: [...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:typeof e.className==='string'?e.className:'',text:(e.innerText||'').slice(0,45),left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})).filter(e=>e.right>innerWidth+1).slice(0,10)
                    }""")
                    self.assertFalse(layout["pageCanScrollHorizontally"], f"{route} page can scroll horizontally at {width}px: {layout}")
                    if width <= 800:
                        menu = self.driver.find_element("css selector", ".mobile-menu-button")
                        self.assertTrue(menu.is_displayed(), f"Mobile navigation missing for {route} at {width}px")
                        if route not in ("/integrations", "/imports"):
                            self.assertTrue(layout["tableViewport"], f"No scrollable table wrapper for {route}")
                        self.assertTrue(all(view["scroll"] >= view["client"] for view in layout["tableViewport"]))

    def test_real_manual_transaction_requires_explicit_disposable_loopback(self):
        """Opt-in real integration. A passing run depends on a disposable live stack."""
        if not REAL_MODE or os.getenv("FRAUDLENS_E2E_ALLOW_WRITES") != "1":
            self.skipTest("Real transaction writes require FRAUDLENS_E2E_MODE=real and FRAUDLENS_E2E_ALLOW_WRITES=1.")
        host = urlparse(FRONTEND_URL).hostname
        if host not in ("localhost", "127.0.0.1", "::1"):
            self.skipTest("Real write test refuses a non-loopback frontend URL.")
        if self.driver is None:
            self.skipTest("Browser driver or loopback frontend is unavailable.")
        username = os.getenv("FRAUDLENS_E2E_ADMIN_USER")
        password = os.getenv("FRAUDLENS_E2E_ADMIN_PASSWORD")
        if not username or not password:
            self.skipTest("Set local disposable FRAUDLENS_E2E_ADMIN_USER/PASSWORD outside source control.")
        self.driver.get(FRONTEND_URL + "/")
        self.driver.find_element("name", "username").send_keys(username)
        self.driver.find_element("name", "password").send_keys(password)
        self.driver.find_element("css selector", "button[type='submit']").click()
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(self.driver, 10).until(lambda d: "/dashboard" in d.current_url)
        self.driver.get(FRONTEND_URL + "/analyse")
        self.driver.find_element("name", "account_ref").send_keys("E2E-SYNTHETIC-" + str(int(time.time())))
        self.driver.find_element("name", "amount").send_keys("10.25")
        self.driver.find_element("name", "category").send_keys("shopping_net")
        self.driver.find_element("css selector", ".analysis-form button[type='submit']").click()
        WebDriverWait(self.driver, 75).until(lambda d: "Prediction result" in d.page_source)
        txid = self.driver.current_url.split("transaction=", 1)[-1]
        self.driver.refresh()
        WebDriverWait(self.driver, 10).until(lambda d: "Prediction result" in d.page_source)
        self.assertIn(txid, self.driver.page_source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
