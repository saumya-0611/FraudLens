# FraudLens Task 05 scoring stabilization

25 November 2026 IST. The isolated branch starts at `3ebe0b4` from `shivansh/github-oauth`. Fresh refs were `origin/dev` at `8aae93c` and `origin/main` at `ed73a51`. The fetched Amrita frontend branch is an ancestor. Its Transactions page already displays pending and scored records and has no manual submission form.

## Reliability changes

| Owner | Change |
| --- | --- |
| Saumya | Inline persists the raw transaction before acknowledging HTTP 202. Inference validates HTTP status, exact transaction ID, version, probability, anomaly fields and reason structures. It scores the original stored transaction on a replay. Streaming validates each response and rejects incomplete, duplicate, mismatched or mixed-version results. Its alert insert only considers score rows actually inserted by the batch. [Inline scorer](../backend/src/pipeline/inlineScorer.js) · [Producer](../backend/src/kafka/producer.js) · [Streaming pipeline](../streaming/jobs/pipeline.py) |
| Shivansh, with Riya review | The existing audit-chain append can run in the caller's transaction. Inline commits the score, any alert and its audit row together, then broadcasts. The existing POST and GET response shapes are preserved. [Audit logger](../backend/src/audit/auditLogger.js) · [Transactions API](../backend/src/routes/transactions.routes.js) |
| Shivansh | The scoring harness records controlled failures and retries separately from actual inference. The existing PostgreSQL security fixture now supplies complete FastAPI-shaped predictions while retaining nested masking checks. [Scoring harness](verify-scoring.cjs) · [Security harness](verify-postgres.cjs) |
| Amrita | The existing frontend rendered authenticated readback and required no edit. [Transactions page](../frontend/src/pages/Transactions.jsx) |

Before the fix, controlled reproduction showed an unavailable ML call attempting a `0.01 LEGITIMATE` score and a conflicting reply attempting an alert after a score insert lost its conflict. A missing streaming version defaulted to `v1` and routed through the same score/alert consistency risk. The database already enforces unique transaction, score and alert keys. Task 05 adds no schema migration.

Inline `202` now means PostgreSQL accepted the transaction row or it already exists. An unscored row surfaces as `PENDING` with null probability and version, and no score-derived alert. Replay can recover pending records. An already committed result skips another inline inference request. The Kafka producer still acknowledges broker intake and hands persistence and scoring to the worker. Riya should review this mode-specific interpretation before any contract edit.

## Runtime evidence

The checked-in trainer generated new `v1` artifacts using its built-in synthetic dataset because the available model stores contained no previously trained artifacts. The real FastAPI predictor loaded its XGBoost and Isolation Forest model through the artifact registry. The reported digest was `e951224434b0dd323c98a937d9336887b2888c54832ab630bc89cd77fac98fac`. This validates the service with a trained fixture and does not qualify the previously trained release model.

| Case | Evidence |
| --- | --- |
| `task05-inline-high` | Real FastAPI `v1` returned `0.8068 HIGH_RISK`. The backend used all 13 features. The database contained one transaction, score, alert and alert audit row. An authenticated socket received one alert event and Chrome displayed the masked result and version after reload. |
| `task05-inline-recovery` | The controlled upstream 503 left an immediately readable `PENDING` row, null probability and zero scores, alerts or alert audit rows. Replaying with a different submitted amount reused the original stored amount. Actual inference recovered as `v1 / 0.081 LEGITIMATE`, with one score and no alert. |
| `task05-inline-conflict` | Controlled concurrent predictions were ordered so a `LEGITIMATE` score committed first. The later `HIGH_RISK` reply produced no alert, audit entry or broadcast. Replaying the committed ID made no additional inference call. |
| `task05-kafka-high` | Kafka 3.8.0 delivered the event to the actual `streaming.jobs.consumer_fallback` worker. Real FastAPI `v1` returned `0.8068 HIGH_RISK`. PostgreSQL kept one transaction, score, alert and audit row, with one socket event total across the original submission and replay. A separate controlled high-risk replay of a committed legitimate ID produced no alert or audit. |
| Existing PostgreSQL security harness | Exit 0 on its own disposable database. Rechecked roles, nested masking, revocation and audit integrity with strict prediction validation. |

The inline and Kafka runs use real PostgreSQL and WebSockets. FastAPI handles all model probes and reported decision cases other than the explicitly controlled 503 and conflicting responses. Kafka evidence is for the Python fallback when indicated. Spark execution is unverified. In-memory fixtures cover parsing, timeout and rollback paths separately.

## Tests

| Command | Result |
| --- | --- |
| `npm.cmd --prefix backend test -- --runTestsByPath src/tests/producer.test.js src/tests/inlineScorer.test.js src/tests/transactions.test.js src/tests/auditIntegrity.test.js` | Exit 0. 36 Jest tests and 11 OIDC pretests passed. |
| `npm.cmd --prefix backend test -- --silent` | Exit 0. 268 Jest tests in 24 suites, including the three-provider OAuth regression, and 11 OIDC pretests passed. |
| `node --test backend/src/tests/fixtures/oidc.node.cjs` and `node --test scripts/proofScripts.test.cjs` | Exit 0 each. 11 OIDC and three proof fixtures passed. |
| `python -B -m pytest -p no:cacheprovider -q -rs streaming/tests shared/tests` | Exit 0. 25 passed, one skipped because `fraudTrain.csv` was unavailable. |
| `npm.cmd --prefix frontend run lint` and `npm.cmd --prefix frontend run build` with `VITE_USE_MOCKS=false` | Exit 0 each. |
| `node security/verify-scoring.cjs` with each supplied pipeline mode | Final run exited 0 in both modes. One earlier Kafka rehearsal timed out awaiting runtime evidence. The final run observed completed worker batches and both modes passed. |
| `git diff --check` | Exit 0. |

## Reproduce on loopback

Install frontend/backend lockfile dependencies and use the built frontend above. In an isolated Python environment install `ml-service/requirements.txt` and `kafka-python-ng==2.2.3`. Supply the interpreter as `FRAUDLENS_PYTHON`. For a Chrome run, set `FRAUDLENS_CHROME` to the locally installed executable. Pull `postgres:16` and `apache/kafka:3.8.0` if absent.

To generate the synthetic trained artifacts from the repo root, run this in a fresh PowerShell session. The checked-in trainer uses synthetic fallback data when the Sparkov CSVs are unavailable. Keep the temporary model directory for the following run.

```powershell
$env:MODEL_STORE_DIR = Join-Path ([IO.Path]::GetTempPath()) ("fraudlens-task05-model-" + [guid]::NewGuid().ToString('N'))
$env:DATABASE_URL = ''
$env:PYTHONPATH = "$PWD;$PWD/ml-service"
$env:OMP_NUM_THREADS = '2'
& $env:FRAUDLENS_PYTHON -B -c "from training.train import train_and_register; result=train_and_register(); print(result['version'],result['algorithm'],result['sha256'])"
```

Use the same shell to run the disposable services and tests below. The runner works with a separately approved local trained artifact directory in `MODEL_STORE_DIR` too. Local source starts FastAPI directly and uses the existing model registry.

```powershell
$id = [guid]::NewGuid().ToString('N').Substring(0,16)
$pg = "fraudlens-scoring-pg-$id"
$kafka = "fraudlens-scoring-kafka-$id"
$db = "fraudlens_scoring_$id"
$fixture = Join-Path ([IO.Path]::GetTempPath()) "fraudlens-scoring-runtime-$id"
New-Item -ItemType Directory -Path $fixture | Out-Null
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
$env:INTERNAL_ML_TOKEN = [guid]::NewGuid().ToString('N')
$env:PYTHONPATH = "$PWD;$PWD/ml-service"
$env:OMP_NUM_THREADS = '2'
$env:PYTHONUNBUFFERED = '1'
$env:KAFKAJS_NO_PARTITIONER_WARNING = '1'
function Get-LoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
$pgStarted = $false
$kafkaStarted = $false
$ml = $null
$result = 1
try {
  docker run --pull=never --rm -d --name $pg -e POSTGRES_PASSWORD -e "POSTGRES_DB=$db" -p 127.0.0.1::5432 postgres:16 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL launch failed' }
  $pgStarted = $true
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    docker exec $pg pg_isready -h 127.0.0.1 -U postgres -d $db | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 350
  }
  if (-not $ready) { throw 'PostgreSQL readiness failed' }
  $binding = docker port $pg 5432/tcp
  if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'PostgreSQL must be bound to loopback' }
  $port = $Matches[1]
  $env:FRAUDLENS_SCORING_DATABASE_URL = "postgresql://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:$port/$db"
  $env:DATABASE_URL = $env:FRAUDLENS_SCORING_DATABASE_URL
  $env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL
  Get-Content -Raw database/init.sql | docker exec -i $pg psql -qX -v ON_ERROR_STOP=1 -U postgres -d $db
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL schema failed' }
  $mlPort = Get-LoopbackPort
  $env:FRAUDLENS_SCORING_ML_ORIGIN = "http://127.0.0.1:$mlPort"
  $ml = Start-Process -FilePath $env:FRAUDLENS_PYTHON -ArgumentList '-B','-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$mlPort" -WorkingDirectory $PWD.Path -WindowStyle Hidden -RedirectStandardOutput (Join-Path $fixture 'ml.stdout') -RedirectStandardError (Join-Path $fixture 'ml.stderr') -PassThru
  $ready = $false
  for ($i=0; $i -lt 45; $i++) {
    try { $reply = Invoke-RestMethod -TimeoutSec 1 "$env:FRAUDLENS_SCORING_ML_ORIGIN/health"; if ($reply.status -eq 'ok') { $ready = $true; break } } catch {}
    if ($ml.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'FastAPI readiness failed' }
  $model = Invoke-RestMethod -TimeoutSec 10 -Headers @{ 'X-Internal-Token' = $env:INTERNAL_ML_TOKEN } "$env:FRAUDLENS_SCORING_ML_ORIGIN/models"
  $active = $model.models | Where-Object { $_.version -eq $model.active_version } | Select-Object -First 1
  Write-Output ("FastAPI active model " + $active.version + " " + $active.algorithm + " " + $active.sha256)
  $env:PIPELINE_MODE = 'inline'
  node security/verify-scoring.cjs
  $inlineExit = $LASTEXITCODE
  Write-Output "Inline exit $inlineExit"

  $kafkaPort = Get-LoopbackPort
  docker run --pull=never --rm -d --name $kafka -p "127.0.0.1:${kafkaPort}:29092" -e 'KAFKA_NODE_ID=1' -e 'KAFKA_PROCESS_ROLES=broker,controller' -e 'KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093,PLAINTEXT_HOST://:29092' -e "KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092,PLAINTEXT_HOST://127.0.0.1:$kafkaPort" -e 'KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER' -e 'KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT' -e 'KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093' -e 'KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1' -e 'KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1' -e 'KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1' -e 'KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0' apache/kafka:3.8.0 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Kafka launch failed' }
  $kafkaStarted = $true
  foreach ($topic in @('transactions-raw','fraud-alerts','transactions-dlq')) {
    docker exec $kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists --topic $topic --partitions 1 --replication-factor 1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Kafka topic creation failed' }
  }
  $env:KAFKA_BROKERS = "127.0.0.1:$kafkaPort"
  $env:PIPELINE_MODE = 'kafka'
  node security/verify-scoring.cjs
  $kafkaExit = $LASTEXITCODE
  Write-Output "Kafka exit $kafkaExit"
  $securityDb = "fraudlens_phase2_verification_$id"
  docker exec $pg createdb -U postgres $securityDb
  if ($LASTEXITCODE -ne 0) { throw 'Security fixture database failed' }
  Get-Content -Raw database/init.sql | docker exec -i $pg psql -qX -v ON_ERROR_STOP=1 -U postgres -d $securityDb
  if ($LASTEXITCODE -ne 0) { throw 'Security fixture schema failed' }
  $env:DATABASE_URL = "postgresql://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:$port/$securityDb"
  $env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL
  node security/verify-postgres.cjs
  $securityExit = $LASTEXITCODE
  Write-Output "Security PostgreSQL fixture exit $securityExit"
  if ($inlineExit -eq 0 -and $kafkaExit -eq 0 -and $securityExit -eq 0) { $result = 0 }
} finally {
  if ($ml -and -not $ml.HasExited) { Stop-Process -Id $ml.Id }
  if ($kafkaStarted) { docker stop $kafka | Out-Null; if ($LASTEXITCODE -ne 0) { $result = 1 } }
  if ($pgStarted) { docker stop $pg | Out-Null; if ($LASTEXITCODE -ne 0) { $result = 1 } }
  Remove-Item -LiteralPath (Join-Path $fixture 'ml.stdout'),(Join-Path $fixture 'ml.stderr') -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $fixture -ErrorAction SilentlyContinue
}
exit $result
```

## Remaining release checks

Validate against Saumya’s approved release model artifact and repeat inference with Spark if Spark is the deployed worker. The available frontend supports readback. Manual entry through a new form is outside this change. Inline pending work recovers on resubmission using the same ID. Delivery after a process crash between an alert commit and its broadcast is outside this verification.
