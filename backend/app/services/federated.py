"""Federated-learning extension scaffold for privacy-preserving multi-operator PHM.

This module implements a transparent FedAvg-style parameter aggregation
simulation. It accepts model updates only; raw records are intentionally not
part of the protocol. This is an architectural demonstrator, not a secure
federated-learning deployment (no secure aggregation, DP, authentication or
robust Byzantine defence).
"""
from __future__ import annotations

import math
from typing import Any


def aggregate_updates(updates: list[dict[str, Any]], min_clients: int = 2) -> dict[str, Any]:
    if min_clients < 2:
        raise ValueError("Federated aggregation requires at least two participating clients")
    eligible = []
    rejected = []
    for item in updates:
        client = str(item.get("client_id") or "unknown")
        params = item.get("parameters") or {}
        samples = item.get("sample_count")
        if not isinstance(samples, int) or samples <= 0 or not params:
            rejected.append({"client_id": client, "reason": "missing parameters or positive sample_count"})
            continue
        if any(not isinstance(v, (int, float)) or not math.isfinite(float(v)) for v in params.values()):
            rejected.append({"client_id": client, "reason": "non-finite or non-numeric parameter"})
            continue
        eligible.append({"client_id": client, "parameters": {k: float(v) for k, v in params.items()}, "sample_count": samples})
    if len(eligible) < min_clients:
        return {
            "status": "not_aggregated",
            "reason": f"Need at least {min_clients} eligible clients; found {len(eligible)}.",
            "eligible_clients": len(eligible),
            "rejected_clients": rejected,
            "shared_parameters": None,
            "raw_records_shared": False,
        }
    keys = set(eligible[0]["parameters"])
    if any(set(x["parameters"]) != keys for x in eligible):
        raise ValueError("All clients must submit the same parameter schema")
    total = sum(x["sample_count"] for x in eligible)
    averaged = {
        key: sum(x["parameters"][key] * x["sample_count"] for x in eligible) / total
        for key in sorted(keys)
    }
    return {
        "status": "aggregated",
        "algorithm": "sample-count-weighted FedAvg",
        "eligible_clients": len(eligible),
        "sample_count_total": total,
        "shared_parameters": averaged,
        "local_personalization": "Client-local adaptation layers and component states remain local.",
        "raw_records_shared": False,
        "rejected_clients": rejected,
        "security_note": "Prototype only: transport security, client authentication, secure aggregation, differential privacy, poisoning defence and governance are not implemented.",
    }
