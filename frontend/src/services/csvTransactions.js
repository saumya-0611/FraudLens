export const TRANSACTION_FIELDS = [
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
];

export const REQUIRED_TRANSACTION_FIELDS = [
  "transaction_id",
  "account_ref",
  "amount",
  "tx_time",
  "category",
];

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

export function parseCsv(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("The CSV file is empty.");
  const input = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length !== 0 || closedQuote) throw new Error("The CSV contains a quote in an invalid position.");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      closedQuote = false;
    } else if (closedQuote) {
      if (!/\s/.test(character)) throw new Error("Unexpected text after a quoted CSV value.");
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("The CSV has an unclosed quoted value.");
  row.push(cell);
  if (row.some(value => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one transaction.");

  const headers = rows[0].map(value => value.trim());
  if (headers.length > 30) throw new Error("The CSV can contain at most 30 columns.");
  if (headers.some(value => !value)) throw new Error("Every CSV column needs a header.");
  const normalized = headers.map(value => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error("The CSV contains duplicate column headers.");
  if (rows.slice(1).some(values => values.length !== headers.length)) {
    throw new Error("Every transaction row must have the same number of columns as the header.");
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`A file may contain at most ${MAX_IMPORT_ROWS} transactions.`);

  return {
    headers,
    rows: rows.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      values: headers.map((_, column) => values[column] ?? ""),
    })),
  };
}

export function initialColumnMapping(headers) {
  const byName = new Map(headers.map((header, index) => [header.trim().toLowerCase().replace(/[\s-]+/g, "_"), String(index)]));
  return Object.fromEntries(TRANSACTION_FIELDS.map(field => [field, byName.get(field) ?? ""]));
}

function parseNumber(value, field, errors, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (String(value ?? "").trim() === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    errors.push(`${field} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`);
    return undefined;
  }
  return number;
}

export function validateTransactionRows(rows, mapping, edits = {}) {
  const mappedColumns = TRANSACTION_FIELDS.map(field => mapping[field]).filter(value => value !== "");
  const duplicateMappings = new Set(mappedColumns.filter((value, index) => mappedColumns.indexOf(value) !== index));
  const seenIds = new Set();
  const duplicateIds = new Set();
  const prepared = rows.map(row => {
    const raw = {};
    TRANSACTION_FIELDS.forEach(field => {
      const column = mapping[field];
      const value = column === "" || column === undefined ? "" : row.values[Number(column)] ?? "";
      raw[field] = edits[row.rowNumber]?.[field] ?? value;
    });
    const id = String(raw.transaction_id).trim();
    if (id && seenIds.has(id)) duplicateIds.add(id);
    if (id) seenIds.add(id);
    return { rowNumber: row.rowNumber, raw, id };
  });

  const validated = prepared.map(({ rowNumber, raw, id }) => {
    const errors = [];
    REQUIRED_TRANSACTION_FIELDS.forEach(field => {
      if (!mapping[field]) errors.push(`Map a CSV column to ${field}.`);
      if (String(raw[field] ?? "").trim() === "") errors.push(`${field} is required.`);
    });
    if (duplicateMappings.size) errors.push("Map each transaction field to a different CSV column.");
    if (id.length > 64) errors.push("transaction_id must be 64 characters or fewer.");
    if (String(raw.account_ref).trim().length > 64) errors.push("account_ref must be 64 characters or fewer.");
    if (String(raw.category).trim().length > 50) errors.push("category must be 50 characters or fewer.");
    if (String(raw.merchant).trim().length > 120) errors.push("merchant must be 120 characters or fewer.");
    if (id && duplicateIds.has(id)) errors.push("transaction_id appears more than once in this file.");

    const amount = parseNumber(raw.amount, "amount", errors, { min: 0, max: 10_000_000 });
    const optional = {
      lat: parseNumber(raw.lat, "lat", errors, { min: -90, max: 90 }),
      lon: parseNumber(raw.lon, "lon", errors, { min: -180, max: 180 }),
      merch_lat: parseNumber(raw.merch_lat, "merch_lat", errors, { min: -90, max: 90 }),
      merch_lon: parseNumber(raw.merch_lon, "merch_lon", errors, { min: -180, max: 180 }),
      customer_age: parseNumber(raw.customer_age, "customer_age", errors, { min: 0, max: 32767, integer: true }),
    };

    const timestamp = String(raw.tx_time).trim();
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp);
    const parsedTime = Date.parse(timestamp);
    if (timestamp && (!hasTimezone || !Number.isFinite(parsedTime))) {
      errors.push("tx_time must be a valid ISO-8601 timestamp with a timezone, such as 2026-11-20T03:12:45Z.");
    }

    const payload = {
      transaction_id: id,
      account_ref: String(raw.account_ref).trim(),
      amount,
      tx_time: Number.isFinite(parsedTime) && hasTimezone ? new Date(parsedTime).toISOString() : undefined,
      category: String(raw.category).trim(),
    };
    if (String(raw.merchant).trim()) payload.merchant = String(raw.merchant).trim();
    Object.entries(optional).forEach(([field, value]) => {
      if (value !== undefined) payload[field] = value;
    });

    return {
      rowNumber,
      raw,
      payload,
      errors: [...new Set(errors)],
      status: "READY",
    };
  });

  return validated.map(row => ({ ...row, hasDuplicateId: duplicateIds.has(row.payload.transaction_id) }));
}

export function createTemplateCsv() {
  return [
    TRANSACTION_FIELDS.join(","),
    "demo-tx-001,demo-account-1001,125.50,2026-11-20T03:12:45Z,shopping_net,Example Merchant,36.0788,-81.1781,36.011293,-82.048315,34",
    "demo-tx-002,demo-account-1002,42.00,2026-11-20T04:12:45Z,grocery_pos,Example Grocery,,,,,",
  ].join("\r\n") + "\r\n";
}
