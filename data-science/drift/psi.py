"""
psi.py - Population Stability Index (PSI) computation for feature and score drift (D6, T3.1).

Functions required by tasks/RIYA_BACKEND_DS.md (D6):
  - psi(expected_proportions, actual_proportions, eps=1e-4) -> float
  - bin_and_psi(reference_edges, reference_props, new_values, eps=1e-4) -> float

Thresholds (CONTRACTS.md §3 & §6):
  - PSI < 0.10        -> OK (no significant distribution shift)
  - 0.10 <= PSI <= 0.25 -> WARNING (moderate shift, monitor closely)
  - PSI > 0.25        -> DRIFT (significant distribution shift, retrain recommended)
"""
from typing import Iterable, Sequence

import numpy as np


def psi(
    expected_proportions: Sequence[float],
    actual_proportions: Sequence[float],
    eps: float = 1e-4,
) -> float:
    """
    Compute Population Stability Index between expected (training) and actual (live) bin proportions:
        PSI = sum( (actual_i - expected_i) * ln(actual_i / expected_i) )
    Uses epsilon smoothing and re-normalization to prevent division by zero or log(0).
    """
    exp = np.asarray(expected_proportions, dtype="float64")
    act = np.asarray(actual_proportions, dtype="float64")
    if exp.size == 0 or act.size == 0 or exp.size != act.size:
        raise ValueError("expected_proportions and actual_proportions must be non-empty and same length")

    exp = np.clip(exp, 0.0, None) + eps
    act = np.clip(act, 0.0, None) + eps
    exp = exp / exp.sum()
    act = act / act.sum()

    value = float(np.sum((act - exp) * np.log(act / exp)))
    return round(max(0.0, value), 6)


def bin_and_psi(
    reference_edges: Sequence[float],
    reference_props: Sequence[float],
    new_values: Iterable[float],
    eps: float = 1e-4,
) -> float:
    """
    Bucket `new_values` into `reference_edges` (extending outer boundaries to -inf/+inf so
    extreme shifted values are captured in the tail bins) and compute PSI against `reference_props`.
    """
    edges = np.asarray(reference_edges, dtype="float64").copy()
    exp_props = np.asarray(reference_props, dtype="float64").copy()
    vals = np.asarray(list(new_values), dtype="float64")
    vals = vals[~np.isnan(vals)]

    if vals.size == 0 or edges.size < 2:
        return 0.0

    edges[0] = -np.inf
    edges[-1] = np.inf

    counts, _ = np.histogram(vals, bins=edges)
    act_props = (counts + eps) / (counts.sum() + eps * len(counts))
    return psi(exp_props, act_props, eps=eps)
