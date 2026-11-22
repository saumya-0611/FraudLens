
const jwt = require('jsonwebtoken');

const {
  signToken,
  verifyRequestCookie,
} = require('../utils/jwt');

const SECRET = 'fraudlens-test-only-secret-32-characters-long';

const user = {
  id: 1,
  username: 'testadmin',
  role: 'ADMIN',
};

function requestWithToken(token) {
  return {
    headers: {
      cookie: `fl_token=${token}`,
    },
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_EXPIRES_IN = '2h';
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
});

describe('C1 JWT security', () => {
  test('valid token returns authenticated user', () => {
    const token = signToken(user);

    expect(
      verifyRequestCookie(requestWithToken(token))
    ).toEqual(user);
  });

  test('missing cookie returns null', () => {
    expect(
      verifyRequestCookie({ headers: {} })
    ).toBeNull();
  });

  test('former stub token is rejected under Jest', () => {
    expect(verifyRequestCookie(requestWithToken('stub-token'))).toBeNull();
  });

  test('a signed token must have an expiration', () => {
    const token = jwt.sign({ username: user.username, role: user.role }, SECRET, {
      algorithm: 'HS256',
      subject: String(user.id),
    });
    expect(verifyRequestCookie(requestWithToken(token))).toBeNull();
  });

  test('a correctly signed HS384 token is rejected', () => {
    const token = jwt.sign({ username: user.username, role: user.role }, SECRET, {
      algorithm: 'HS384',
      subject: String(user.id),
      expiresIn: '2h',
    });
    expect(verifyRequestCookie(requestWithToken(token))).toBeNull();
  });

  test('tampered token is rejected', () => {
    const token = signToken(user);
    const parts = token.split('.');

    parts[1] = Buffer.from(
      JSON.stringify({
        sub: '1',
        username: 'testadmin',
        role: 'VIEWER',
      })
    ).toString('base64url');

    const tampered = parts.join('.');

    expect(
      verifyRequestCookie(requestWithToken(tampered))
    ).toBeNull();
  });

  test('expired token is rejected', () => {
    const token = jwt.sign(
      { username: 'testadmin', role: 'ADMIN' },
      SECRET,
      {
        algorithm: 'HS256',
        subject: '1',
        expiresIn: -10,
      }
    );

    expect(
      verifyRequestCookie(requestWithToken(token))
    ).toBeNull();
  });

  test('alg none token is rejected', () => {
    const token = jwt.sign(
      { sub: '1', username: 'testadmin', role: 'ADMIN' },
      undefined,
      { algorithm: 'none' }
    );

    expect(
      verifyRequestCookie(requestWithToken(token))
    ).toBeNull();
  });

  test('duplicate session cookies are rejected', () => {
    const token = signToken(user);

    expect(
      verifyRequestCookie({
        headers: {
          cookie: `fl_token=${token}; fl_token=${token}`,
        },
      })
    ).toBeNull();
  });
});
