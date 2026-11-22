const { z } = require('zod');

const username = z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/);
const role = z.enum(['ADMIN', 'ANALYST', 'VIEWER']);
const status = z.enum(['ACTIVE', 'DISABLED']);
const password = z.string().min(1).refine((value) => Buffer.byteLength(value) <= 72);
const newPassword = password.min(10).refine((value) => value.trim().length >= 10);
const id = z.string().regex(/^[1-9]\d{0,9}$/).refine((value) => Number(value) <= 2147483647);
const page = z.string().regex(/^\d+$/).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 1);
const dateTime = z.iso.datetime({ offset: true });
const date = z.union([z.iso.date(), dateTime]);
const paging = {
  page: page.optional(),
  page_size: page.refine((value) => Number(value) <= 100).optional(),
};

const createTransaction = z.object({
  body: z.strictObject({
    transaction_id: z.string().min(1).max(64),
    account_ref: z.string().min(1).max(64),
    amount: z.number().min(0).max(1e7),
    tx_time: dateTime,
    category: z.string().min(1).max(50),
    merchant: z.string().max(120).nullish(),
    lat: z.number().min(-90).max(90).nullish(),
    lon: z.number().min(-180).max(180).nullish(),
    merch_lat: z.number().min(-90).max(90).nullish(),
    merch_lon: z.number().min(-180).max(180).nullish(),
    customer_age: z.number().int().min(0).max(32767).nullish(),
  }),
});

const alertPatch = z.object({
  params: z.object({ id }),
  body: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('UNDER_REVIEW') }),
    z.strictObject({
      state: z.literal('RESOLVED'),
      resolution: z.enum(['CONFIRMED_FRAUD', 'FALSE_POSITIVE']),
    }),
  ]),
});

const listQuery = z.object({
  query: z.strictObject({
    ...paging,
    risk: z.enum(['PENDING', 'LEGITIMATE', 'SUSPICIOUS', 'HIGH_RISK']).optional(),
    from: date.optional(),
    to: date.optional(),
    q: z.string().max(120).optional(),
  }),
});

const auditQuery = z.object({
  query: z.strictObject({
    ...paging,
    action: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/).optional(),
    username: username.optional(),
    include_hash: z.enum(['true', 'false']).optional(),
  }),
});

const login = z.object({ body: z.strictObject({ username, password }) });
const createUser = z.object({ body: z.strictObject({ username, password: newPassword, role }) });
const patchUser = z.object({
  params: z.object({ id }),
  body: z.strictObject({
    role: role.optional(),
    status: status.optional(),
    password: newPassword.optional(),
  }).refine((value) => Object.keys(value).length > 0),
});

module.exports = { createTransaction, alertPatch, listQuery, login, createUser, patchUser, auditQuery };
