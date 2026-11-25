export const EXPORT_COLUMNS = [
  ["transaction_id", "Transaction ID"],
  ["account_masked", "Masked account"],
  ["amount", "Amount"],
  ["category", "Category"],
  ["tx_time", "Transaction time"],
  ["fraud_probability", "Fraud probability"],
  ["risk_category", "Risk classification"],
  ["model_version", "Model version"],
  ["prediction_status", "Prediction status"],
  ["alert_state", "Alert state"],
  ["resolution", "Alert resolution"],
];

export function safeCsvValue(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function transactionsToCsv(items) {
  const header = EXPORT_COLUMNS.map(([, label]) => safeCsvValue(label)).join(",");
  const rows = items.map(item => {
    const values = {
      ...item,
      prediction_status: item.fraud_probability === null || item.fraud_probability === undefined || item.risk_category === "PENDING" ? "PENDING" : "SCORED",
      alert_state: item.alert?.state ?? item.alert_state,
      resolution: item.alert?.resolution ?? item.resolution,
    };
    return EXPORT_COLUMNS.map(([key]) => safeCsvValue(values[key])).join(",");
  });
  return [header, ...rows].join("\r\n") + "\r\n";
}

export function downloadCsv(filename, content) {
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
