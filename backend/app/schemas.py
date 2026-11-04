"""Typed API contract (Pydantic). Mirrored by frontend/src/api/types.ts."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

ENVIRONMENTS = ("benign", "humid", "marine", "desert")
PROFILES = ("normal", "increased_load", "high_temperature", "high_manoeuvre", "adverse_environment", "custom")
Decision = Literal["accept", "accept_reduced_confidence", "reject", "request_more_evidence"]


class MissionIn(BaseModel):
    """Flight conditions (used for what-if scenarios and for manually entered scheduled flights)."""

    name: str | None = None
    profile: str = "normal"
    duration_min: float | None = Field(default=None, ge=5, le=1200)
    landing_cycles: int | None = Field(default=None, ge=0, le=20)
    load_factor: float | None = Field(default=None, ge=0.2, le=3.0)
    load_variation: float | None = Field(default=None, ge=0.0, le=0.6)
    manoeuvre_intensity: float | None = Field(default=None, ge=0.0, le=5.0)
    temperature_c: float | None = Field(default=None, ge=-60, le=300)
    pressure_factor: float | None = Field(default=None, ge=0.3, le=2.0)
    vibration_level: float | None = Field(default=None, ge=0.0, le=5.0)
    environment: str | None = None
    operating_intensity: float | None = Field(default=None, ge=0.2, le=2.0)
    repeat: int | None = Field(default=None, ge=1, le=50)
    phase_fractions: dict[str, float] | None = None

    @field_validator("profile")
    @classmethod
    def _profile(cls, v: str) -> str:
        if v not in PROFILES:
            raise ValueError(f"profile must be one of {PROFILES}")
        return v

    @field_validator("environment")
    @classmethod
    def _env(cls, v: str | None) -> str | None:
        if v is not None and v not in ENVIRONMENTS:
            raise ValueError(f"environment must be one of {ENVIRONMENTS}")
        return v

    def clean(self) -> dict[str, Any]:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class ScenarioIn(BaseModel):
    component_id: str
    name: str = Field(min_length=1, max_length=120)
    missions: list[MissionIn] = Field(min_length=1, max_length=10)
    notes: str = ""


class SimulationRequest(BaseModel):
    component_id: str
    missions: list[MissionIn] = Field(min_length=1, max_length=10)
    label: str = ""
    scenario_id: str | None = None
    mc_samples: int | None = Field(default=None, ge=0, le=5000)
    seed: int | None = Field(default=None, ge=0)


class CompareRequest(BaseModel):
    component_id: str
    schedules: list[ScenarioIn] = Field(min_length=1, max_length=5)
    mc_samples: int = Field(default=0, ge=0, le=2000)


class ScheduledFlightIn(BaseModel):
    aircraft_id: str
    flight_date: str
    route_or_mission: str = Field(min_length=1, max_length=120)
    duration_min: float = Field(ge=5, le=1200)
    landing_cycles: int = Field(default=1, ge=0, le=20)
    payload_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    expected_temperature_c: float | None = Field(default=None, ge=-60, le=300)
    expected_environment: str | None = None
    notes: str = ""

    @field_validator("expected_environment")
    @classmethod
    def _env(cls, v: str | None) -> str | None:
        if v is not None and v not in ENVIRONMENTS:
            raise ValueError(f"expected_environment must be one of {ENVIRONMENTS}")
        return v


class PredictRequest(BaseModel):
    component_id: str
    flight_id: str
    mc_samples: int | None = Field(default=None, ge=0, le=5000)
    seed: int | None = Field(default=None, ge=0)


class CompleteFlightRequest(BaseModel):
    flight_id: str
    anomaly: Literal["none", "dropout", "outliers", "sensor_bias", "wrong_component"] = "none"


class ManualObservationRequest(BaseModel):
    component_id: str
    flight_id: str
    channel_means: dict[str, float]
    note: str = ""


class ReconcileRequest(BaseModel):
    prediction_id: str
    flight_record_id: str | None = None


class ApplyUpdateRequest(BaseModel):
    decision_override: Decision | None = None


class InspectionIn(BaseModel):
    component_id: str
    inspection_date: str
    method: str
    observed_defect: str = ""
    quantity: str | None = None
    measured_value: float | None = Field(default=None, ge=0)
    unit: str | None = None
    measurement_uncertainty: float | None = Field(default=None, gt=0)
    confidence: Literal["low", "medium", "high"] = "medium"
    source: str = "manual"
    notes: str = ""
    apply_update: bool = True


class MaintenanceIn(BaseModel):
    component_id: str
    maintenance_date: str
    activity: str = Field(min_length=1, max_length=240)
    repair_or_replacement: Literal["none", "repair", "replacement"] = "none"
    damage_before: dict[str, float] | None = None
    damage_after: dict[str, float] | None = None
    maintenance_reference: str = ""
    notes: str = ""
    apply: bool = True


class ComponentIn(BaseModel):
    id: str | None = None
    aircraft_id: str | None = None
    name: str = Field(min_length=1, max_length=160)
    system: str
    position: str = ""
    description: str = ""
    material: str = ""
    manufacturer: str = ""
    part_number: str = ""
    serial_number: str = ""
    installation_date: str | None = None
    geometry: dict[str, Any] = Field(default_factory=dict)
    model_type: str | None = None
    parameters: dict[str, dict[str, Any]] | None = None
    state: dict[str, float] | None = None
    baseline_provenance: dict[str, str] | None = None
    response_params: dict[str, float] | None = None
    initial_condition: str = ""
    degradation_mechanisms: list[str] = Field(default_factory=list)
    provenance: Literal["synthetic_demo", "uploaded", "manual"] = "manual"
    tags: list[str] = Field(default_factory=list)


class SettingsIn(BaseModel):
    mc_samples: int | None = Field(default=None, ge=10, le=5000)
    rls_forgetting_factor: float | None = Field(default=None, gt=0.5, le=1.0)
    reduced_confidence_blend: float | None = Field(default=None, gt=0.0, le=1.0)
    max_relative_change_per_update: float | None = Field(default=None, gt=0.0, le=1.0)
    demo_seed: int | None = Field(default=None, ge=0)
