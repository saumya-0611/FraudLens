import test from "node:test";
import assert from "node:assert/strict";
import {
  createTemplateCsv,
  initialColumnMapping,
  parseCsv,
  validateTransactionRows,
} from "../src/services/csvTransactions.js";

test("parses quoted delimiters, escaped quotes, CRLF and multiline cells", () => {
  const parsed = parseCsv(`\uFEFFtransaction_id,account_ref,amount,tx_time,category,merchant\r\ntx-1,acc-1,20,2026-11-20T03:12:45Z,shopping_net,"Example, ""Store""\r\nNorth"\r\n`);
  assert.deepEqual(parsed.headers, ["transaction_id", "account_ref", "amount", "tx_time", "category", "merchant"]);
  assert.equal(parsed.rows[0].values[5], 'Example, "Store"\r\nNorth');
});

test("validates contract fields and normalizes explicit ISO timezone timestamps", () => {
  const parsed = parseCsv(createTemplateCsv());
  const mapping = initialColumnMapping(parsed.headers);
  const rows = validateTransactionRows(parsed.rows, mapping);

  assert.deepEqual(rows.map(row => row.errors), [[], []]);
  assert.equal(rows[0].payload.amount, 125.5);
  assert.equal(rows[0].payload.tx_time, "2026-11-20T03:12:45.000Z");
  assert.equal(rows[0].payload.customer_age, 34);
  assert.equal(rows[1].payload.lat, undefined);
});

test("rejects duplicate IDs, absent required mappings, invalid amounts and timezone-free times", () => {
  const parsed = parseCsv([
    "transaction_id,account_ref,amount,tx_time,category",
    "same,account-1,-2,2026-11-20T03:12:45,shopping_net",
    "same,account-2,10,not-a-time,retail",
  ].join("\n"));
  const mapping = initialColumnMapping(parsed.headers);
  mapping.category = "";
  const rows = validateTransactionRows(parsed.rows, mapping);

  assert.ok(rows[0].errors.includes("transaction_id appears more than once in this file."));
  assert.ok(rows[0].errors.some(error => error.startsWith("amount must be")));
  assert.ok(rows[0].errors.some(error => error.startsWith("tx_time must be")));
  assert.ok(rows[0].errors.includes("Map a CSV column to category."));
  assert.ok(rows[1].errors.includes("transaction_id appears more than once in this file."));
});

test("rejects malformed quoting, duplicate headers, and mismatched row widths", () => {
  assert.throws(() => parseCsv('id,id\na,b'), /duplicate column headers/i);
  assert.throws(() => parseCsv('id,value\na,"unfinished'), /unclosed quoted/i);
  assert.throws(() => parseCsv('id,value\na,b,c'), /same number of columns/i);
});
