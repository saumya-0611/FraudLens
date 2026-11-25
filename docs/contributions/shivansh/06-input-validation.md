# API input validation and response safety

FraudLens accepts transaction data, login credentials, user updates, alert resolutions, and query filters from callers outside the service. Validation prevents unexpected input from crossing into domain logic or SQL.

## Controls

- Route-specific Zod schemas check request bodies, query parameters and path parameters. Strict objects reject unexpected inputs. The transaction schema bounds amount and coordinates and accepts offset-aware timestamps. The account update schema allowlists password, role and status. Audit and transaction filters constrain values and pagination. [Schemas](../../../backend/src/validation/schemas.js) · [Validation middleware](../../../backend/src/middleware/validate.js)
- Validation failures return a request ID, field path and generic message. The middleware omits submitted values from that message. The application applies Helmet, a 100 KiB JSON limit, and safe parser error responses. Unsafe API methods reject requests marked cross-site or same-site by browser Fetch Metadata. [Express app](../../../backend/src/app.js) · [API hardening](../../../backend/src/middleware/apiHardening.js)
- Transaction and audit queries bind caller-provided values as parameters. Transaction responses mask the account reference, and nested result fields go through the shared account-reference sanitizer. Filter validation and SQL binding serve different purposes. [Transaction queries](../../../backend/src/routes/transactions.routes.js) · [Audit queries](../../../backend/src/routes/audit.routes.js) · [Masking helper](../../../backend/src/utils/mask.js)

## Evidence and ownership

Shivansh contributed request-schema and HTTP hardening in `687e8f4` and nested masking follow-up in `5b65ce4`. Riya’s data contracts and route implementations supply the application-specific fields. Tests cover unexpected fields, malformed JSON, excessive request size, protected account attributes, and safe query bindings. [Schema tests](../../../backend/src/tests/securityValidation.test.js) · [HTTP hardening tests](../../../backend/src/tests/apiHardening.test.js) · [Admin API tests](../../../backend/src/tests/securityAdmin.test.js)

The controls apply at the routes that use them. They complement authentication, authorization, SQL binding, and deployment proxy configuration. The recorded defensive results describe test fixtures and bounded validation cases. They do not certify all hosted ingress paths or establish an application-wide penetration-test result.
