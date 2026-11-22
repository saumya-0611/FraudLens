const { signToken } = require('../../utils/jwt');

const users = [
  { id: 101, username: 'test-admin', role: 'ADMIN', status: 'ACTIVE' },
  { id: 102, username: 'test-analyst', role: 'ANALYST', status: 'ACTIVE' },
  { id: 103, username: 'test-viewer', role: 'VIEWER', status: 'ACTIVE' },
];

function sessionCookie(role) {
  const user = users.find((candidate) => candidate.role === role);
  return `fl_token=${signToken(user)}`;
}

function mockDatabase(routeQuery) {
  return {
    routeQuery,
    query(sql, params) {
      if (sql.includes('SELECT id, username, role, status') && sql.includes('WHERE id = $1')) {
        return Promise.resolve({ rows: users.filter(({ id }) => id === params[0]) });
      }
      return routeQuery(sql, params);
    },
  };
}

beforeAll(() => {
  process.env.JWT_SECRET = 'fraudlens-jest-session-fixture-secret';
  process.env.JWT_EXPIRES_IN = '2h';
});

module.exports = { sessionCookie, mockDatabase, users };
