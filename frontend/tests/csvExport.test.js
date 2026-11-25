import test from "node:test";
import assert from "node:assert/strict";
import { safeCsvValue, transactionsToCsv } from "../src/services/csvExport.js";

test("quotes CSV fields and neutralizes spreadsheet formulas", () => {
  assert.equal(safeCsvValue('Merchant, "North"'), '"Merchant, ""North"""');
  assert.equal(safeCsvValue("  =HYPERLINK(\"bad\")"), '"\'  =HYPERLINK(""bad"")"');
  assert.equal(safeCsvValue(null), "");
});

test("exports masked, authorized fields and marks unscored rows as pending", () => {
  const csv = transactionsToCsv([
    { transaction_id: "tx-1", account_masked: "XXXX-4242", amount: 10, category: "retail", tx_time: "2026-11-20T00:00:00Z", fraud_probability: null, risk_category: "PENDING", model_version: null },
  ]);
  assert.match(csv, /Transaction ID/);
  assert.match(csv, /XXXX-4242/);
  assert.match(csv, /PENDING/);
  assert.doesNotMatch(csv, /account_ref|password|token/i);
});
