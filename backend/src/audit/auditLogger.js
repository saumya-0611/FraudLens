// STUB. Shivansh replaces with the hash-chained audit writer (CONTRACTS section 3). Keep the export.
async function audit(entry) {
  console.log('[AUDIT-STUB]', entry && entry.action);
}
module.exports = { audit };
