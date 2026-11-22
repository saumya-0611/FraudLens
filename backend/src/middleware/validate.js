module.exports = (schema) => (req, res, next) => {
  const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
  if (result.success) return next();

  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      request_id: req.id,
      fields: result.error.issues.map(({ path }) => ({
        field: path.join('.'),
        message: 'Invalid or missing value, or unexpected fields.',
      })),
    },
  });
};
