// Masking rule (CONTRACTS section 2): never return the full account_ref.
function maskAccount(ref) {
  return 'XXXX-' + String(ref || '').slice(-4);
}
function maskTransaction(row) {
  const { account_ref, ...rest } = row;
  return { ...rest, account_masked: maskAccount(account_ref) };
}
module.exports = { maskAccount, maskTransaction };
