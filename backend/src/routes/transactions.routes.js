const router = require('express').Router();

const serviceAuth = require('../middleware/serviceAuth');
const validate = require('../middleware/validate');
const { createTransaction } = require('../validation/schemas');
const { publishTransaction } = require('../kafka/producer');
const { asyncHandler } = require('../utils/errors');

// Accept a transaction and publish it to Kafka.
router.post(
  '/',
  serviceAuth,
  validate(createTransaction),
  asyncHandler(async (req, res) => {
    const transaction = req.body;

    await publishTransaction(transaction);

    res.status(202).json({
      transaction_id: transaction.transaction_id,
      status: 'ACCEPTED',
    });
  })
);

module.exports = router;
