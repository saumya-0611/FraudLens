const loopbackHosts = new Set(['127.0.0.1', '[::1]']);

function parseUrl(value, variable) {
  try {
    return new URL(value);
  } catch {
    throw new Error(variable + ' must be set to a valid URL.');
  }
}

function approvedOrigin(env) {
  const origin = parseUrl(env.FRAUDLENS_PROOF_ORIGIN, 'FRAUDLENS_PROOF_ORIGIN');
  if (origin.protocol !== 'http:' || !loopbackHosts.has(origin.hostname) ||
      !origin.port || origin.origin !== env.FRAUDLENS_PROOF_ORIGIN) {
    throw new Error('FRAUDLENS_PROOF_ORIGIN must be an exact HTTP loopback origin with an explicit port.');
  }
  return origin;
}

function approvedDatabase(env) {
  const database = env.FRAUDLENS_PROOF_DATABASE;
  if (!/^fraudlens_proof_[a-z0-9_]{1,40}$/.test(database ?? '')) {
    throw new Error('FRAUDLENS_PROOF_DATABASE must name an approved disposable fraudlens_proof_ database.');
  }

  const url = parseUrl(env.FRAUDLENS_PROOF_DATABASE_URL, 'FRAUDLENS_PROOF_DATABASE_URL');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !loopbackHosts.has(url.hostname) || !url.port ||
      !url.username || !url.password || url.pathname !== '/' + database ||
      url.href !== env.FRAUDLENS_PROOF_DATABASE_URL || /[?#]/.test(url.href)) {
    throw new Error('FRAUDLENS_PROOF_DATABASE_URL must specify the matching loopback database, port and credentials without options.');
  }
  return {
    database,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port),
    user: decodeCredential(url.username),
    password: decodeCredential(url.password),
  };
}

function decodeCredential(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.trim() || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error();
    return decoded;
  } catch {
    throw new Error('FRAUDLENS_PROOF_DATABASE_URL contains invalid credentials.');
  }
}

module.exports = { approvedDatabase, approvedOrigin };
