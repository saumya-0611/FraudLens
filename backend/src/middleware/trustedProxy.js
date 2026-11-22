const { isIP } = require('node:net');

function configureTrustedProxy(app, configured = process.env.TRUSTED_PROXY_CIDRS) {
  if (!configured?.trim()) return;

  const peers = configured.split(',').map((value) => value.trim());
  for (const peer of peers) {
    const [address, prefix, extra] = peer.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!family || extra !== undefined ||
        (prefix !== undefined && (!/^[1-9]\d*$/.test(prefix) || Number(prefix) > maxPrefix))) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP addresses or nonzero CIDR prefixes.');
    }
  }
  app.set('trust proxy', peers);
}

function discardMalformedForwarding(req, _res, next) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && forwarded.split(',').some((address) => !isIP(address.trim()))) {
    delete req.headers['x-forwarded-for'];
  }
  next();
}

module.exports = { configureTrustedProxy, discardMalformedForwarding };
