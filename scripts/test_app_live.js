// Read-only HTTP checks against a separately started disposable backend.
const { approvedOrigin } = require('./proofConfig');

async function main() {
  let origin;
  try {
    origin = approvedOrigin(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const checks = [
    ['/health', 200, 'Backend health'],
    ['/api/auth/me', 401, 'Anonymous session denial'],
    ['/api/transactions', 401, 'Anonymous transaction read denial'],
    ['/api/alerts', 401, 'Anonymous alert read denial'],
  ];

  for (const [pathname, expected, label] of checks) {
    try {
      const response = await fetch(new URL(pathname, origin), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (response.status !== expected) {
        console.error(label + ' failed with HTTP ' + response.status + '.');
        process.exitCode = 1;
        return;
      }
      console.log(label + ' passed with HTTP ' + expected + '.');
    } catch {
      console.error(label + ' failed. Check that the approved loopback backend is running.');
      process.exitCode = 1;
      return;
    }
  }
}

void main();
