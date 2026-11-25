# FraudLens on Minikube

Use a dedicated local profile and a NetworkPolicy-capable CNI such as Calico. PostgreSQL, Kafka and ML use ClusterIP. Streaming has no listener. Frontend and backend use NodePorts 30173 and 30500. The two ingress policies restrict connections to ML and PostgreSQL by pod label and port. DNS and other egress remain available. The Kafka service is internal, with no broker authentication or Kafka ingress policy in this demo profile.

## Build and validate

Run from the repository root in a Bash-compatible shell. The local images use the `phase2` tag and `IfNotPresent` pull policy. The PostgreSQL image includes `database/init.sql` for a fresh database. Rebuild and reload images after source changes before restarting pods. The profile uses ephemeral data and one backend replica because live socket broadcasts originate in the process receiving the Kafka event.

```bash
minikube start -p fraudlens-demo --driver=docker --cni=calico --keep-context
docker build -t fraudlens-postgres:phase2 database
docker build -f backend/Dockerfile -t fraudlens-backend:phase2 .
docker build -t fraudlens-frontend:phase2 frontend
docker build -f ml-service/Dockerfile -t fraudlens-ml-service:phase2 .
docker build -f streaming/Dockerfile -t fraudlens-streaming:phase2 .
for image in postgres backend frontend ml-service streaming; do
  minikube -p fraudlens-demo image load "fraudlens-${image}:phase2"
done
kubectl --context=fraudlens-demo apply --dry-run=client -f deploy/k8s/
```

The checked-in Secret is for validation. Use a restricted env file outside the repository with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `JWT_SECRET`, `SERVICE_TOKEN` and `INTERNAL_ML_TOKEN`. Use a database URL pointing to `postgres:5432` with matching credentials. Keep seed credentials separate from pod secrets. This profile uses HTTP locally. Set `COOKIE_SECURE=true` and terminate HTTPS for a real deployment.

```bash
kubectl --context=fraudlens-demo create namespace fraudlens
kubectl --context=fraudlens-demo -n fraudlens create secret generic fraudlens-secrets --from-env-file=/path/to/private-deployment.env
kubectl --context=fraudlens-demo apply -f deploy/k8s/network-policy.yaml
kubectl --context=fraudlens-demo apply -f deploy/k8s/deployments-services.yaml -l fraudlens-phase=bootstrap
kubectl --context=fraudlens-demo -n fraudlens rollout status deployment/kafka
kubectl --context=fraudlens-demo -n fraudlens exec deployment/kafka -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic transactions-raw --partitions 3 --replication-factor 1
kubectl --context=fraudlens-demo -n fraudlens exec deployment/kafka -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic transactions-dlq --partitions 1 --replication-factor 1
kubectl --context=fraudlens-demo -n fraudlens exec deployment/kafka -- /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic fraud-alerts --partitions 1 --replication-factor 1
kubectl --context=fraudlens-demo apply -f deploy/k8s/deployments-services.yaml
minikube -p fraudlens-demo service frontend -n fraudlens
```

After the backend and PostgreSQL are ready, pass the three seed passwords as separate lines in ADMIN, ANALYST, VIEWER order from a restricted local file. The seed command skips existing usernames.

```bash
kubectl --context=fraudlens-demo -n fraudlens exec -i deployment/backend -- sh -ec '
  for name in SEED_ADMIN_PASSWORD SEED_ANALYST_PASSWORD SEED_VIEWER_PASSWORD; do
    IFS= read -r value
    export "$name=$value"
  done
  npm run seed
' < /path/to/private-seed-password-lines
```

Check the policies separately from workload readiness. Deployment and policy YAML validation alone establishes configuration, while runtime evidence requires a working CNI and verification that intended workloads can reach the allowed ports and unrelated workloads cannot. Preserve separate evidence for each claim.
