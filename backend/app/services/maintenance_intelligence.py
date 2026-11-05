"""Explainable context-aware maintenance and operational risk recommendations.

Advisory research-prototype logic. It does not make airworthiness or dispatch decisions.
"""
from __future__ import annotations

from datetime import date
from typing import Any


CRITICALITY = {
    "Propulsion": 1.00,
    "Engine mounting and support": 1.00,
    "Airframe and structures": 0.98,
    "Flight controls": 0.98,
    "Fuel systems": 0.94,
    "Hydraulic systems": 0.90,
    "Landing gear": 0.88,
    "Electrical systems": 0.86,
    "Environmental control": 0.55,
}

POTENTIAL_CONSEQUENCES = {
    "Propulsion": [
        "loss or reduction of thrust capability",
        "engine performance degradation",
        "potential in-flight operational disruption",
    ],
    "Engine mounting and support": [
        "loss of structural load-transfer capability",
        "engine/pylon attachment integrity concern",
        "potential aircraft dispatch and continued-operation impact",
    ],
    "Airframe and structures": [
        "reduced structural load capacity",
        "damage propagation under repeated loading",
        "potential structural integrity concern",
    ],
    "Flight controls": [
        "reduced control-surface actuation capability",
        "control response degradation",
        "potential controllability impact",
    ],
    "Hydraulic systems": [
        "loss or reduction of hydraulic pressure/actuation",
        "degraded operation of dependent systems",
        "potential system redundancy impact",
    ],
    "Landing gear": [
        "degraded landing or ground-load capability",
        "braking or retraction function impairment",
        "potential landing/ground-operation impact",
    ],
    "Fuel systems": [
        "fuel delivery or containment degradation",
        "engine feed interruption or leakage concern",
        "potential propulsion and fire-safety impact",
    ],
    "Electrical systems": [
        "power distribution or generation degradation",
        "loss of dependent electrical functions",
        "potential avionics/system availability impact",
    ],
    "Environmental control": [
        "reduced cabin/environmental control performance",
        "crew/passenger environmental comfort impact",
    ],
}


def _days_from_today(value: Any) -> int | None:
    """Return signed calendar-day distance from today; positive means future."""
    try:
        return (date.fromisoformat(str(value)[:10]) - date.today()).days
    except (ValueError, TypeError):
        return None


def _relationships(
    component: dict[str, Any],
    components: list[dict[str, Any]],
    assessments: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    peers: list[dict[str, Any]] = []
    for other in components:
        if other.get("id") == component.get("id"):
            continue
        if other.get("aircraft_id") != component.get("aircraft_id"):
            continue

        same_system = other.get("system") == component.get("system")
        same_part = bool(component.get("part_number")) and (
            other.get("part_number") == component.get("part_number")
        )
        positions = {
            str(component.get("position", "")).upper(),
            str(other.get("position", "")).upper(),
        }
        mirrored = positions == {"LH", "RH"}
        if not (same_system or same_part or mirrored):
            continue

        assessment = assessments.get(other.get("id"), {})
        remaining_life = assessment.get("remaining_life") or {}
        peers.append(
            {
                "component_id": other.get("id"),
                "name": other.get("name"),
                "relationship": (
                    "same_system"
                    if same_system
                    else "same_part_number"
                    if same_part
                    else "mirrored_position"
                ),
                "assessment_status": assessment.get("status"),
                "review_required": assessment.get("review_required", False),
                "remaining_life_flights": remaining_life.get(
                    "governing_remaining_flights"
                ),
                "minimum_margin": assessment.get("min_margin"),
            }
        )
    return peers


def recommend(
    component: dict[str, Any],
    assessment: dict[str, Any],
    peers: list[dict[str, Any]],
    inspections: list[dict[str, Any]],
    maintenance: list[dict[str, Any]],
    next_flight: dict[str, Any] | None,
) -> dict[str, Any]:
    rul_data = assessment.get("remaining_life") or {}
    rul = rul_data.get("governing_remaining_flights")
    margin = assessment.get("min_margin")
    status = assessment.get("status", "not_modelled")
    criticality = CRITICALITY.get(component.get("system"), 0.70)
    score = 12 + 23 * criticality
    drivers: list[dict[str, str]] = []
    actions: list[dict[str, str]] = []

    def driver(name: str, severity: str, evidence: str) -> None:
        drivers.append(
            {"factor": name, "severity": severity, "evidence": evidence}
        )

    def action(priority: str, description: str, basis: str, timing: str) -> None:
        actions.append(
            {
                "priority": priority,
                "action": description,
                "basis": basis,
                "timing": timing,
            }
        )

    if status == "threshold_crossed":
        score += 45
        driver(
            "model_threshold",
            "critical",
            assessment.get("detail") or "A modelled threshold is crossed.",
        )
        action(
            "urgent",
            "Escalate to authorised maintenance engineering for immediate technical disposition before further operation.",
            "The component model reports a threshold crossing.",
            "Before next operation",
        )
    elif status in ("review", "invalid_parameters"):
        score += 24
        driver(
            "component_condition",
            "high",
            assessment.get("detail") or f"Assessment status: {status}.",
        )
        action(
            "high",
            "Arrange an engineering review; verify component state, model inputs and applicable inspection requirements.",
            "The component assessment flags review.",
            "Before the next planned exposure where practicable",
        )

    if rul is not None:
        severity = (
            "critical"
            if rul < 25
            else "high"
            if rul < 100
            else "moderate"
            if rul < 250
            else "low"
        )
        score += 26 if rul < 25 else 17 if rul < 100 else 8 if rul < 250 else 0
        driver(
            "remaining_useful_life",
            severity,
            f"Estimated RUL: {rul} reference-mission flights; mechanism: "
            f"{rul_data.get('governing_mechanism') or 'not specified'}.",
        )
        if rul < 100:
            action(
                "high" if rul < 25 else "medium",
                "Plan a targeted inspection and maintenance window; verify the governing damage mechanism and RUL assumptions.",
                f"Estimated RUL is {rul} flights under the reference mission.",
                "Before consuming a substantial fraction of estimated RUL",
            )
    elif component.get("model_type"):
        driver(
            "rul_unavailable",
            "unknown",
            "No finite governing RUL estimate is available.",
        )

    if margin is not None:
        severity = (
            "critical"
            if margin < 0
            else "high"
            if margin < 0.10
            else "moderate"
            if margin < 0.25
            else "low"
        )
        score += 23 if margin < 0 else 15 if margin < 0.10 else 8 if margin < 0.25 else 0
        driver(
            "engineering_margin",
            severity,
            f"Minimum modelled margin: {margin:.4f}.",
        )
        if margin < 0.25:
            action(
                "high" if margin < 0.10 else "medium",
                "Review load and stress margins and confirm the inspection interval against approved engineering data.",
                f"Minimum modelled margin is {margin:.4f}.",
                "Before the next high-load mission",
            )

    if inspections and inspections[0].get("confidence") == "low":
        score += 5
        driver(
            "inspection_confidence",
            "moderate",
            "Latest inspection evidence is marked low confidence.",
        )
        action(
            "medium",
            "Obtain a higher-confidence follow-up inspection or independent review of the finding.",
            "Latest inspection confidence is low.",
            "Next suitable maintenance opportunity",
        )
    elif not inspections:
        score += 4
        driver(
            "inspection_gap",
            "unknown",
            "No inspection record is available in AeroSim for this component.",
        )
        action(
            "medium",
            "Check the approved maintenance programme and determine whether baseline or targeted inspection is due.",
            "No inspection evidence is recorded in this dataset.",
            "Verify against approved maintenance programme",
        )

    latest_maintenance = maintenance[0] if maintenance else None
    maintenance_context = None
    if latest_maintenance:
        maintenance_date = (
            latest_maintenance.get("maintenance_date")
            or latest_maintenance.get("event_time")
        )
        maintenance_days = _days_from_today(maintenance_date)
        maintenance_context = {
            "maintenance_date": maintenance_date,
            "activity": latest_maintenance.get("activity"),
            "repair_or_replacement": latest_maintenance.get("repair_or_replacement"),
            "days_since": (
                max(0, -maintenance_days)
                if maintenance_days is not None
                else None
            ),
            "reference": latest_maintenance.get("maintenance_reference"),
        }
        if (
            latest_maintenance.get("repair_or_replacement")
            in ("repair", "replacement")
            and maintenance_days is not None
            and 0 <= -maintenance_days <= 30
        ):
            driver(
                "recent_maintenance_verification",
                "moderate",
                "A repair or replacement is recorded within the last 30 days; verify close-out and post-maintenance evidence.",
            )
            action(
                "medium",
                "Verify maintenance release/close-out documentation and any required post-maintenance inspection or functional test; confirm the twin baseline reflects the completed work.",
                "Recent repair/replacement record is present.",
                "Before return to service, as required by approved procedures",
            )

    flight_context = None
    if next_flight:
        environment = next_flight.get("expected_environment")
        temperature = next_flight.get("expected_temperature_c")
        payload = next_flight.get("payload_fraction")
        stressors: list[str] = []

        if environment in ("marine", "desert", "humid"):
            stressors.append(f"{environment} environment")
            score += 5
        if temperature is not None and temperature >= 40:
            stressors.append(f"high temperature ({temperature} °C)")
            score += 6
        if payload is not None and payload >= 0.85:
            stressors.append(f"high payload ({payload:.0%})")
            score += 5

        days_until = _days_from_today(next_flight.get("flight_date"))
        flight_context = {
            key: next_flight.get(key)
            for key in (
                "id",
                "flight_date",
                "route_or_mission",
                "expected_environment",
                "expected_temperature_c",
                "payload_fraction",
                "duration_min",
            )
        }
        flight_context["days_until"] = days_until
        flight_context["operational_stressors"] = stressors

        if stressors:
            driver(
                "upcoming_operational_exposure",
                "moderate",
                "Scheduled mission includes " + ", ".join(stressors) + ".",
            )
            action(
                "medium",
                "Run a component-specific what-if prediction using the scheduled mission profile and compare degradation/margins with the normal reference mission.",
                "Upcoming operational conditions include elevated stressors.",
                "Before this scheduled flight",
            )

        flagged = status in ("review", "threshold_crossed") or (
            rul is not None and rul < 100
        )
        if (
            days_until is not None
            and 0 <= days_until <= 3
            and flagged
        ):
            action(
                "high",
                "Escalate the open component review to maintenance control and obtain an authorised disposition before the scheduled flight.",
                "A flagged component has a flight scheduled within three days.",
                "Before scheduled departure",
            )

    affected = [
        peer
        for peer in peers
        if peer.get("review_required")
        or peer.get("assessment_status") == "threshold_crossed"
        or (
            peer.get("minimum_margin") is not None
            and peer["minimum_margin"] < 0.25
        )
    ]
    if affected:
        score += min(15, 5 * len(affected))
        driver(
            "related_component_condition",
            "high" if len(affected) > 1 else "moderate",
            f"{len(affected)} related component instance(s) also have review flags.",
        )
        action(
            "medium",
            "Review related component instances together for common operating exposure, installation, part-batch or maintenance factors. Do not transfer one component's damage state to another.",
            "Related components show concurrent condition flags.",
            "During the same engineering review",
        )

    if not component.get("model_type"):
        score += 8
        driver(
            "model_coverage_gap",
            "unknown",
            "No implemented quantitative degradation model exists for this component.",
        )
        action(
            "medium",
            "Use approved maintenance documentation and inspection findings for disposition; AeroSim provides context only for this unmodelled component.",
            "No quantitative component twin is available.",
            "For decisions involving this component",
        )

    if not actions:
        action(
            "routine",
            "Continue scheduled monitoring and retain inspection/maintenance evidence; reassess after new flight or inspection data.",
            "No configured rule indicates an elevated condition.",
            "Next routine review",
        )

    priority_rank = {"urgent": 0, "high": 1, "medium": 2, "routine": 3}
    unique_actions = {item["action"]: item for item in actions}
    actions = sorted(
        unique_actions.values(),
        key=lambda item: priority_rank[item["priority"]],
    )

    score = round(min(100, score), 1)
    if score >= 80:
        level = "critical"
    elif score >= 60:
        level = "high"
    elif score >= 40:
        level = "moderate"
    else:
        level = "low"

    return {
        "component_id": component["id"],
        "component_name": component.get("name"),
        "risk_score": score,
        "risk_level": level,
        "criticality_weight": criticality,
        "potential_consequences": POTENTIAL_CONSEQUENCES.get(
            component.get("system"),
            ["Component-specific functional impact requires engineering assessment."],
        ),
        "assessment_status": status,
        "governing_mechanism": rul_data.get("governing_mechanism"),
        "remaining_life_flights": rul,
        "minimum_margin": margin,
        "risk_drivers": drivers,
        "related_components": peers,
        "maintenance_context": maintenance_context,
        "upcoming_flight": flight_context,
        "recommended_actions": actions,
        "relationship_note": (
            "Related components are inferred from same-aircraft system, part "
            "number or LH/RH position. These are contextual associations, not "
            "validated causal propagation paths."
        ),
        "limitations": [
            "Risk score is a transparent prototype prioritisation index, not a validated probability of failure.",
            "Recommendations are advisory and do not replace approved maintenance data, OEM limits, licensed engineering review or dispatch authority.",
            "Only implemented component models contribute quantitative RUL and margin evidence.",
        ],
    }


def fleet_recommendations(db: Any) -> dict[str, Any]:
    """Generate a fleet-wide recommendation for each active component instance."""
    from .components import component_assessment

    components = [
        component
        for component in db.list("components")
        if component.get("lifecycle_status") != "retired"
    ]
    assessments = {
        component["id"]: component_assessment(component)
        for component in components
    }

    results = []
    for component in components:
        scheduled_flights = [
            flight
            for flight in db.list(
                "flights", {"aircraft_id": component.get("aircraft_id")}
            )
            if flight.get("status") == "scheduled"
        ]
        scheduled_flights.sort(
            key=lambda flight: flight.get("flight_date") or "9999-99-99"
        )
        inspections = db.list(
            "inspections",
            {"component_id": component["id"]},
            newest_first=True,
        )
        maintenance = db.list(
            "maintenance",
            {"component_id": component["id"]},
            newest_first=True,
        )
        peers = _relationships(component, components, assessments)
        results.append(
            recommend(
                component,
                assessments[component["id"]],
                peers,
                inspections,
                maintenance,
                scheduled_flights[0] if scheduled_flights else None,
            )
        )

    order = {"critical": 0, "high": 1, "moderate": 2, "low": 3}
    results.sort(
        key=lambda item: (order[item["risk_level"]], -item["risk_score"])
    )
    return {
        "count": len(results),
        "risk_distribution": {
            level: sum(item["risk_level"] == level for item in results)
            for level in order
        },
        "recommendations": results,
    }
