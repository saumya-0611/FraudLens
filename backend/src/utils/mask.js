// Masking rule (CONTRACTS section 2): never return the full account_ref.
function maskAccount(ref) {
  return 'XXXX-' + String(ref || '').slice(-4);
}
function maskTransaction(row) {
  const { account_ref, ...rest } = row;
  return { ...rest, account_masked: maskAccount(account_ref) };
}

function stripAccountReferences(value) {
  if (!value || typeof value !== 'object' ||
      value instanceof Date || value instanceof RegExp || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) return value.map(stripAccountReferences);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'account_ref')
    .map(([key, nested]) => [key, stripAccountReferences(nested)]));
}

module.exports = { maskAccount, maskTransaction, stripAccountReferences };
