const { timingSafeEqual } = require('node:crypto');
const authenticate = require('./authenticate');
const authorizeAdmin = require('./authorize')('ADMIN');

function hasServiceToken(req) {
  const provided = req.get('X-Service-Token');
  const expected = process.env.SERVICE_TOKEN;

  if (provided && expected?.trim() && !/^change_me/i.test(expected.trimStart())) {
    const suppliedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length === expectedBytes.length &&
        timingSafeEqual(suppliedBytes, expectedBytes)) {
      return true;
    }
  }
  return false;
}

module.exports = function serviceAuth(req, res, next) {
  if (hasServiceToken(req)) return next();
  return authenticate(req, res, (error) => {
    if (error) return next(error);
    return authorizeAdmin(req, res, next);
  });
};
module.exports.hasServiceToken = hasServiceToken;
