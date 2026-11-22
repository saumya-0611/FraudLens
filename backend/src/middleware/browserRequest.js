function isForeignBrowserRequest(req) {
  const site = req.headers['sec-fetch-site'];
  return site === 'cross-site' || site === 'same-site';
}

module.exports = { isForeignBrowserRequest };
