// AppError carries an HTTP status and a CONTRACTS error code.
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Express 4 does not catch errors from async handlers. This wrapper forwards them
// to the central error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, asyncHandler };