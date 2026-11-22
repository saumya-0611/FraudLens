from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = ROOT / "deploy" / "k8s"
RESOURCES = [
    doc
    for path in sorted(MANIFESTS.glob("*.yaml"))
    for doc in yaml.safe_load_all(path.read_text(encoding="utf-8"))
]


def resources(kind):
    return {doc["metadata"]["name"]: doc for doc in RESOURCES if doc["kind"] == kind}


class KubernetesManifests(unittest.TestCase):
    def test_namespace_and_bootstrap(self):
        self.assertEqual(set(resources("Namespace")), {"fraudlens"})
        for resource in RESOURCES:
            if resource["kind"] != "Namespace":
                self.assertEqual(resource["metadata"]["namespace"], "fraudlens")
        for kind in ("Deployment", "Service"):
            self.assertEqual(
                {name for name, doc in resources(kind).items()
                 if doc["metadata"].get("labels", {}).get("fraudlens-phase") == "bootstrap"},
                {"postgres", "kafka"},
            )
        image = resources("Deployment")["postgres"]["spec"]["template"]["spec"]["containers"][0]["image"]
        self.assertEqual(image, "fraudlens-postgres:phase2")
        self.assertIn("init.sql", (ROOT / "database" / "Dockerfile").read_text())

    def test_services_match_deployments(self):
        deployments = resources("Deployment")
        services = resources("Service")
        ports = {"postgres": 5432, "kafka": 9092, "ml-service": 8000, "backend": 5000, "frontend": 5173}
        self.assertEqual(set(deployments), set(ports) | {"streaming"})
        self.assertEqual(set(services), set(ports))
        for name, deployment in deployments.items():
            spec = deployment["spec"]
            labels = spec["template"]["metadata"]["labels"]
            self.assertEqual(spec["selector"]["matchLabels"], labels)
            if name in services:
                service = services[name]["spec"]
                self.assertEqual(service["selector"], labels)
                self.assertEqual(service["ports"][0]["port"], ports[name])
                self.assertEqual(service["ports"][0]["targetPort"], ports[name])
                self.assertIn(ports[name], {
                    port["containerPort"] for port in spec["template"]["spec"]["containers"][0]["ports"]
                })
                self.assertEqual(service["type"], "NodePort" if name in {"frontend", "backend"} else "ClusterIP")

    def test_each_workload_has_only_its_expected_secrets(self):
        expected = {
            "postgres": {"POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"},
            "backend": {"DATABASE_URL", "JWT_SECRET", "SERVICE_TOKEN", "INTERNAL_ML_TOKEN"},
            "ml-service": {"DATABASE_URL", "INTERNAL_ML_TOKEN"},
            "streaming": {"DATABASE_URL", "INTERNAL_ML_TOKEN"},
            "frontend": set(),
            "kafka": set(),
        }
        template_keys = set(resources("Secret")["fraudlens-secrets"]["stringData"])
        env_keys = {
            line.partition("=")[0] for line in (ROOT / ".env.example").read_text().splitlines()
            if "=" in line and not line.startswith("#")
        }
        self.assertEqual(template_keys, env_keys)
        for name, deployment in resources("Deployment").items():
            [container] = deployment["spec"]["template"]["spec"]["containers"]
            self.assertNotIn("envFrom", container)
            refs = [
                var["valueFrom"]["secretKeyRef"] for var in container.get("env", [])
                if "valueFrom" in var
            ]
            self.assertTrue(all(ref["name"] == "fraudlens-secrets" for ref in refs))
            self.assertEqual({ref["key"] for ref in refs}, expected[name])

    def test_ingress_policies_only_allow_intended_peer_labels_and_ports(self):
        actual = {}
        for policy in resources("NetworkPolicy").values():
            spec = policy["spec"]
            self.assertEqual(spec["policyTypes"], ["Ingress"])
            self.assertNotIn("egress", spec)
            rule, = spec["ingress"]
            self.assertTrue(all(set(peer) == {"podSelector"} for peer in rule["from"]))
            actual[spec["podSelector"]["matchLabels"]["app"]] = (
                {peer["podSelector"]["matchLabels"]["app"] for peer in rule["from"]},
                {(port["protocol"], port["port"]) for port in rule["ports"]},
            )
        self.assertEqual(actual, {
            "ml-service": ({"backend", "streaming"}, {("TCP", 8000)}),
            "postgres": ({"backend", "streaming", "ml-service"}, {("TCP", 5432)}),
        })


if __name__ == "__main__":
    unittest.main()
