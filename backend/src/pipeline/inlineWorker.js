const { randomUUID } = require('node:crypto');
const { query } = require('../config/db');
const { scoreTransactionInline } = require('./inlineScorer');

const POLL_INTERVAL_MS = 1000;
const LEASE_SECONDS = 60;
const PARALLEL_LIMIT = 4;
const MAX_RETRY_SECONDS = 300;
let worker = null;

async function completeJob(job, leaseToken) {
  let scored = false;
  try {
    scored = await scoreTransactionInline(job.transaction_id);
  } catch (error) {
    console.error('[InlineWorker] Scoring attempt failed:', error.code || error.name);
  }

  try {
    if (scored) {
      await query(
        'DELETE FROM inline_scoring_jobs WHERE transaction_id = $1 AND lease_token = $2',
        [job.transaction_id, leaseToken]
      );
    } else {
      const retrySeconds = Math.min(MAX_RETRY_SECONDS, 2 ** job.attempts);
      await query(
        `UPDATE inline_scoring_jobs
         SET available_at = clock_timestamp() + $3 * interval '1 second', lease_token = NULL
         WHERE transaction_id = $1 AND lease_token = $2`,
        [job.transaction_id, leaseToken, retrySeconds]
      );
    }
  } catch (error) {
    // A lost update leaves the current lease eligible for a later worker after expiry.
    console.error('[InlineWorker] Could not finish job:', error.code || error.name);
  }
}

async function claimAvailableJobs(state, capacity) {
  const leaseToken = randomUUID();
  const { rows } = await query(
    `WITH due AS (
       SELECT transaction_id FROM inline_scoring_jobs
       WHERE available_at <= clock_timestamp()
       ORDER BY available_at, transaction_id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE inline_scoring_jobs AS job
     SET available_at = clock_timestamp() + $2 * interval '1 second',
         attempts = LEAST(job.attempts + 1, 10),
         lease_token = $3
     FROM due WHERE job.transaction_id = due.transaction_id
     RETURNING job.transaction_id, job.attempts`,
    [capacity, LEASE_SECONDS, leaseToken]
  );

  for (const job of rows) {
    const task = completeJob(job, leaseToken);
    state.active.add(task);
    void task.finally(() => state.active.delete(task));
  }
}

function wakeInlineWorker() {
  const state = worker;
  if (!state || state.claim || state.active.size >= PARALLEL_LIMIT) return;
  state.claim = claimAvailableJobs(state, PARALLEL_LIMIT - state.active.size)
    .catch((error) => console.error('[InlineWorker] Could not claim jobs:', error.code || error.name))
    .finally(() => { state.claim = null; });
}

function startInlineWorker() {
  if (worker) return;
  worker = { active: new Set(), claim: null, timer: setInterval(wakeInlineWorker, POLL_INTERVAL_MS) };
  worker.timer.unref();
  wakeInlineWorker();
}

async function stopInlineWorker() {
  const state = worker;
  if (!state) return;
  worker = null;
  clearInterval(state.timer);
  await state.claim;
  await Promise.all(state.active);
}

module.exports = { startInlineWorker, stopInlineWorker, wakeInlineWorker };
