# FraudLens Kubernetes & Zero-Trust Network Manifests (`deploy/k8s/`)

Contains Kubernetes manifests for running FraudLens on Minikube or a managed Kubernetes cluster:
- [secrets.example.yaml](file:///e:/FraudLens/deploy/k8s/secrets.example.yaml) — `Namespace` (`fraudlens`) + `Secret` template mirroring `.env.example`.
- [deployments-services.yaml](file:///e:/FraudLens/deploy/k8s/deployments-services.yaml) — `Deployment` and `Service` manifests for `postgres`, `kafka`, `ml-service` (`ClusterIP`), `streaming`, `backend` (`NodePort 30500`), and `frontend` (`NodePort 30173`).
- [network-policy.yaml](file:///e:/FraudLens/deploy/k8s/network-policy.yaml) — Zero-Trust `NetworkPolicy` isolating `ml-service:8000` and `postgres:5432`.

## How to Validate & Apply
```bash
# Client-side schema check
kubectl apply --dry-run=client -f deploy/k8s/

# Deploy to Minikube
kubectl apply -f deploy/k8s/secrets.example.yaml
kubectl apply -f deploy/k8s/deployments-services.yaml
kubectl apply -f deploy/k8s/network-policy.yaml
```
