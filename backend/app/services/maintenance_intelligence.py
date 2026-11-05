"""Explainable context-aware maintenance and operational risk recommendations.

Advisory research-prototype logic. It does not make airworthiness or dispatch decisions.
"""
from __future__ import annotations
from datetime import date
from typing import Any

CRITICALITY = {
    "Propulsion": 1.00, "Engine mounting and support": 1.00,
    "Airframe and structures": .98, "Flight controls": .98,
    "Fuel systems": .94, "Hydraulic systems": .90, "Landing gear": .88,
    "Electrical systems": .86, "Environmental control": .55,
}

POTENTIAL_CONSEQUENCES = {
    "Propulsion": ["loss or reduction of thrust capability", "engine performance degradation", "potential in-flight operational disruption"],
    "Engine mounting and support": ["loss of structural load-transfer capability", "engine/pylon attachment integrity concern", "potential aircraft dispatch and continued-operation impact"],
    "Airframe and structures": ["reduced structural load capacity", "damage propagation under repeated loading", "potential structural integrity concern"],
    "Flight controls": ["reduced control-surface actuation capability", "control response degradation", "potential controllability impact"],
    "Hydraulic systems": ["loss or reduction of hydraulic pressure/actuation", "degraded operation of dependent systems", "potential system redundancy impact"],
    "Landing gear": ["degraded landing or ground-load capability", "braking or retraction function impairment", "potential landing/ground-operation impact"],
    "Fuel systems": ["fuel delivery or containment degradation", "engine feed interruption or leakage concern", "potential propulsion and fire-safety impact"],
    "Electrical systems": ["power distribution or generation degradation", "loss of dependent electrical functions", "potential avionics/system availability impact"],
    "Environmental control": ["reduced cabin/environmental control performance", "crew/passenger environmental comfort impact"],
}
"Explainable context-aware maintenance and operational risk recommendations.

Advisory research-prototype logic. It does not make airworthiness or dispatch decisions.
"""
from __future__ import annotations
from datetime import date
from typing import Any

CRITICALITY = {
    "Propulsion": 1.00, "Engine mounting and support": 1.00,
    "Airframe and structures": .98, "Flight controls": .98,
    "Fuel systems": .94, "Hydraulic systems": .90, "Landing gear": .88,
    "Electrical systems": .86, "Environmental control": .55,
}

def _days(value):
    try: return (date.fromisoformat(str(value)[:10]) - date.today()).days
    except (ValueError, TypeError): return None

def _relationships(component, components, assessments):
    peers = []
    for other in components:
        if other["id"] == component["id"] or other.get("aircraft_id") != component.get("aircraft_id"):
            continue
        same_system = other.get("system") == component.get("system")
        same_part = bool(component.get("part_number")) and other.get("part_number") == component.get("part_number")
        positions = {str(component.get("position", "")).upper(), str(other.get("position", "")).upper()}
        mirrored = positions == {"LH", "RH"}
        if not (same_system or same_part or mirrored): continue
        a = assessments.get(other["id"], {})
        peers.append({
            "component_id": other["id"], "name": other.get("name"),
            "relationship": "same_system" if same_system else "same_part_number" if same_part else "mirrored_position",
            "assessment_status": a.get("status"), "review_required": a.get("review_required", False),
            "remaining_life_flights": (a.get("remaining_life") or {}).get("governing_remaining_flights"),
            "minimum_margin": a.get("min_margin"),
        })
    return peers

def recommend(component, assessment, peers, inspections, maintenance, next_flight):
    rul_data = assessment.get("remaining_life") or {}
    rul, margin = rul_data.get("governing_remaining_flights"), assessment.get("min_margin")
    status = assessment.get("status", "not_modelled")
    criticality = CRITICALITY.get(component.get("system"), .70)
    score = 12 + 23 * criticality
    drivers, actions = [], []

    def driver(name, severity, evidence):
        drivers.append({"factor": name, "severity": severity, "evidence": evidence})
    def action(priority, text, basis, timing):
        actions.append({"priority": priority, "action": text, "basis": basis, "timing": timing})

    if status == "threshold_crossed":
        score += 45
        driver("model_threshold", "critical", assessment.get("detail") or "A modelled threshold is crossed.")
        action("urgent", "Escalate to authorised maintenance engineering for immediate technical disposition before further operation.", "The component model reports a threshold crossing.", "Before next operation")
    elif status in ("review", "invalid_parameters"):
        score += 24
        driver("component_condition", "high", assessment.get("detail") or f"Assessment status: {status}.")
        action("high", "Arrange an engineering review; verify component state, model inputs and applicable inspection requirements.", "The component assessment flags review.", "Before the next planned exposure where practicable")

    if rul is not None:
        severity = "critical" if rul < 25 else "high" if rul < 100 else "moderate" if rul < 250 else "low"
        score += 26 if rul < 25 else 17 if rul < 100 else 8 if rul < 250 else 0
        driver("remaining_useful_life", severity, f"Estimated RUL: {rul} reference-mission flights; mechanism: {rul_data.get('governing_mechanism') or 'not specified'}.")
        if rul < 100:
            action("high" if rul < 25 else "medium", "Plan a targeted inspection and maintenance window; verify the governing damage mechanism and RUL assumptions.", f"Estimated RUL is {rul} flights under the reference mission.", "Before consuming a substantial fraction of estimated RUL")
    elif component.get("model_type"):
        driver("rul_unavailable", "unknown", "No finite governing RUL estimate is available.")

    if margin is not None:
        severity = "critical" if margin < 0 else "high" if margin < .10 else "moderate" if margin < .25 else "low"
        score += 23 if margin < 0 else 15 if margin < .10 else 8 if margin < .25 else 0
        driver("engineering_margin", severity, f"Minimum modelled margin: {margin:.4f}.")
        if margin < .25:
            action("high" if margin < .10 else "medium", "Review load and stress margins and confirm the inspection interval against approved engineering data.", f"Minimum modelled margin is {margin:.4f}.", "Before the next high-load mission")

    if inspections and inspections[0].get("confidence") == "low":
        score += 5
        driver("inspection_confidence", "moderate", "Latest inspection evidence is marked low confidence.")
        action("medium", "Obtain a higher-confidence follow-up inspection or independent review of the finding.", "Latest inspection confidence is low.", "Next suitable maintenance opportunity")
    elif not inspections:
        score += 4
        driver("inspection_gap", "unknown", "No inspection record is available in AeroSim for this component.")
        action("medium", "Check the approved maintenance programme and determine whether baseline or targeted inspection is due.", "No inspection evidence is recorded in this dataset.", "Verify against approved maintenance programme")

    latest_maintenance = maintenance[0] if maintenance else None
    maintenance_context = None
    if latest_maintenance:
        mdate = latest_maintenance.get("maintenance_date") or latest_maintenance.get("event_time")
        days_since = _days(mdate)
        maintenance_context = {
            "maintenance_date": mdate, "activity": latest_maintenance.get("activity"),
            "repair_or_replacement": latest_maintenance.get("repair_or_replacement"),
            "days_since": None if days_since is None else -days_since,
            "reference": latest_maintenance.get("maintenance_reference"),
        }
        if latest_maintenance.get("repair_or_replacement") in ("repair", "replacement") and days_since is not None and -days_since <= 30:
            driver("recent_maintenance_verification", "moderate", "A repair or replacement is recorded within the last 30 days; verify close-out and post-maintenance evidence.")
            action("medium", "Verify maintenance release/close-out documentation and any required post-maintenance inspection or functional test; confirm the twin baseline reflects the completed work.", "Recent repair/replacement record is present.", "Before return to service, as required by approved procedures")

    flight_context = None
    if next_flight:
        env, temp, payload = next_flight.get("expected_environment"), next_flight.get("expected_temperature_c"), next_flight.get("payload_fraction")
        stressors = []
        if env in ("marine", "desert", "humid"): stressors.append(f"{env} environment"); score += 5
        if temp is not None and temp >= 40: stressors.append(f"high temperature ({temp} °C)"); score += 6
        if payload is not None and payload >= .85: stressors.append(f"high payload ({payload:.0%})"); score += 5
        days = _days(next_flight.get("flight_date"))
        flight_context = {k: next_flight.get(k) for k in ("id", "flight_date", "route_or_mission", "expected_environment", "expected_temperature_c", "payload_fraction", "duration_min")}
        flight_context["days_until"] = days
        flight_context["operational_stressors"] = stressors
        if stressors:
            driver("upcoming_operational_exposure", "moderate", "Scheduled mission includes " + ", ".join(stressors) + ".")
            action("medium", "Run a component-specific what-if prediction using the scheduled mission profile and compare degradation/margins with the normal reference mission.", "Upcoming operational conditions include elevated stressors.", "Before this scheduled flight")
        if days is not None and 0 <= days <= 3 and (status in ("review", "threshold_crossed") or (rul is not None and rul < 100)):
            action("high", "Escalate the open component review to maintenance control and obtain an authorised disposition before the scheduled flight.", "A flagged component has a flight scheduled within three days.", "Before scheduled departure")

    affected = [p for p in peers if p.get("review_required") or p.get("assessment_status") == "threshold_crossed" or (p.get("minimum_margin") is not None and p["minimum_margin"] < .25)]
    if affected:
        score += min(15, 5 * len(affected))
        driver("related_component_condition", "high" if len(affected) > 1 else "moderate", f"{len(affected)} related component instance(s) also have review flags.")
        action("medium", "Review related component instances together for common operating exposure, installation, part-batch or maintenance factors. Do not transfer one component's damage state to another.", "Related components show concurrent condition flags.", "During the same engineering review")

    if not component.get("model_type"):
        score += 8
        driver("model_coverage_gap", "unknown", "No implemented quantitative degradation model exists for this component.")
        action("medium", "Use approved maintenance documentation and inspection findings for disposition; AeroSim provides context only for this unmodelled component.", "No quantitative component twin is available.", "For decisions involving this component")

    if not actions:
        action("routine", "Continue scheduled monitoring and retain inspection/maintenance evidence; reassess after new flight or inspection data.", "No configured rule indicates an elevated condition.", "Next routine review")
    rank = {"urgent": 0, "high": 1, "medium": 2, "routine": 3}
    actions = sorted({a["action"]: a for a in actions}.values(), key=lambda x: rank[x["priority"]])
    score = round(min(100, score), 1)
    level = "critical" if score >= 80 else "high" if score >= 60 else "moderate" if score >= 40 else "low"
    return {
        "component_id": component["id"], "component_name": component.get("name"),
        "risk_score": score, "risk_level": level, "criticality_weight": criticality,\n        "potential_consequences": POTENTIAL_CONSEQUENCES.get(component.get("system"), ["Component-specific functional impact requires engineering assessment."]),
        "assessment_status": status, "governing_mechanism": rul_data.get("governing_mechanism"),
        "remaining_life_flights": rul, "minimum_margin": margin,
        "risk_drivers": drivers, "related_components": peers, "maintenance_context": maintenance_context, "upcoming_flight": flight_context,
        "recommended_actions": actions,
        "relationship_note": "Related components are inferred from same-aircraft system, part number or LH/RH position. These are contextual associations, not validated causal propagation paths.",
        "limitations": ["Risk score is a transparent prototype prioritisation index, not a validated probability of failure.", "Recommendations are advisory and do not replace approved maintenance data, OEM limits, licensed engineering review or dispatch authority.", "Only implemented component models contribute quantitative RUL and margin evidence."],
    }

def fleet_recommendations(db):
    from .components import component_assessment
    components = [c for c in db.list("components") if c.get("lifecycle_status") != "retired"]
    assessments = {c["id"]: component_assessment(c) for c in components}
    results = []
    for c in components:
        scheduled = [f for f in db.list("flights", {"aircraft_id": c.get("aircraft_id")}) if f.get("status") == "scheduled"]
        scheduled.sort(key=lambda f: f.get("flight_date") or "9999-99-99")
        inspections = db.list("inspections", {"component_id": c["id"]}, newest_first=True)
        maintenance = db.list("maintenance", {"component_id": c["id"]}, newest_first=True)
        peers = _relationships(c, components, assessments)
        results.append(recommend(c, assessments[c["id"]], peers, inspections, maintenance, scheduled[0] if scheduled else None))
    order = {"critical": 0, "high": 1, "moderate": 2, "low": 3}
    results.sort(key=lambda x: (order[x["risk_level"]], -x["risk_score"]))
    return {"count": len(results), "risk_distribution": {k: sum(x["risk_level"] == k for x in results) for k in order}, "recommendations": results}
