// STUB. Shivansh replaces with real cookie-JWT verification. Keep the export.
module.exports = function authenticate(req, res, next) {
  req.user = { id: 0, username: 'stub-admin', role: 'ADMIN' };
  next();
};
