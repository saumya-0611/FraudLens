# Role-based access control

A valid JWT establishes who is making a request. FraudLens must separately decide whether that account may read transactions, investigate alerts, or change users and models.

## Authorization boundary

The authentication middleware verifies the cookie, queries PostgreSQL for the user by local ID, and accepts only an active account with a recognized role. The authorization middleware then checks the route's allowed roles. Unauthenticated requests receive `401`. A valid session with insufficient privileges receives `403`, and the middleware attempts a redacted `ACCESS_DENIED` audit event. [Authentication](../../../backend/src/middleware/authenticate.js) · [Authorization](../../../backend/src/middleware/authorize.js)

| Operation | Current authorization |
| --- | --- |
| View transaction list and details | Active ADMIN, ANALYST, or VIEWER session |
| Investigate alerts through the REST API | ADMIN or ANALYST |
| Create or update local users, read the audit API, manage models | ADMIN |
| Submit a transaction | ADMIN session or the designated service credential |
| Receive masked socket alerts | Active authenticated session, subject to socket Origin validation |

The backend routes enforce this matrix independently of navigation and button visibility in the frontend. Current roles are read from PostgreSQL so older signed claims do not preserve revoked privileges. A new social account is provisioned as an active VIEWER. [Contract](../../../docs/CONTRACTS.md) · [Transaction routes](../../../backend/src/routes/transactions.routes.js) · [Alert routes](../../../backend/src/routes/alerts.routes.js) · [User routes](../../../backend/src/routes/users.routes.js) · [Model routes](../../../backend/src/routes/models.routes.js)

Shivansh contributed active-session validation and route-level guards in `f5d6f81` and `687e8f4`. Riya’s ingestion and alert routes and Amrita’s frontend navigation are shared integration surfaces. The middleware and protected-route tests cover role denial and database changes to current privileges. These global roles do not create organization-level tenant boundaries. [Auth middleware tests](../../../backend/src/tests/authMiddleware.test.js) · [Protected routes tests](../../../backend/src/tests/protectedRoutes.test.js)
