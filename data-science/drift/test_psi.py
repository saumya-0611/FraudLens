"""Unit tests for data-science/drift/psi.py (D6)."""
import numpy as np

from psi import bin_and_psi, psi


def test_identical_distributions_give_near_zero_psi():
    props = [0.10] * 10
    score = psi(props, props)
    assert score < 1e-5, f"Identical proportions should give ~0 PSI, got {score}"

    rng = np.random.default_rng(42)
    ref_sample = rng.normal(loc=50.0, scale=10.0, size=5000)
    edges = np.quantile(ref_sample, np.linspace(0, 1, 11))
    counts, _ = np.histogram(ref_sample, bins=edges)
    ref_props = counts / counts.sum()

    same_dist_sample = rng.normal(loc=50.0, scale=10.0, size=2000)
    same_psi = bin_and_psi(edges, ref_props, same_dist_sample)
    assert same_psi < 0.05, f"Same distribution sample should have PSI < 0.05 (OK), got {same_psi}"


def test_shifted_distribution_gives_large_drift_psi():
    rng = np.random.default_rng(42)
    ref_sample = rng.lognormal(mean=3.5, sigma=0.7, size=5000)
    edges = np.quantile(ref_sample, np.linspace(0, 1, 11))
    counts, _ = np.histogram(ref_sample, bins=edges)
    ref_props = counts / counts.sum()

    # Simulate --drift-mode (3x transaction amounts)
    drifted_sample = ref_sample[:1000] * 3.0
    drift_psi = bin_and_psi(edges, ref_props, drifted_sample)
    assert drift_psi > 0.25, f"3x shifted sample should trigger DRIFT (PSI > 0.25), got {drift_psi}"


if __name__ == "__main__":
    test_identical_distributions_give_near_zero_psi()
    test_shifted_distribution_gives_large_drift_psi()
    print("All D6 PSI drift tests PASSED!")
