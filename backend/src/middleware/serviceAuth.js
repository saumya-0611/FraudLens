const { timingSafeEqual } = require('node:crypto');
const authenticate = require('./authenticate');
const authorizeAdmin = require('./authorize')('ADMIN');

module.exports = function serviceAuth(req, res, next) {
  const provided = req.get('X-Service-Token');
  const expected = process.env.SERVICE_TOKEN;

  if (provided && expected && !/^change_me/i.test(expected)) {
    const suppliedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length === expectedBytes.length &&
        timingSafeEqual(suppliedBytes, expectedBytes)) {
      return next();
    }
  }

  return authenticate(req, res, (error) => {
    if (error) return next(error);
    return authorizeAdmin(req, res, next);
  });
};
