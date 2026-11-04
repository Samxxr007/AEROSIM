"""
Core abstractions for the AeroSim degradation engine.

The engine layer is pure mathematics: no I/O, no database access, no HTTP.
Every degradation model has its own state variables, parameters, units and
validation tests. Randomness is only introduced through explicitly supplied
seeded generators (used by the uncertainty service).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

Provenance = Literal["input", "assumption", "measured", "catalogue", "simulation", "calibrated"]


class EngineError(ValueError):
    """Raised when inputs violate model assumptions or units."""


@dataclass
class Parameter:
    """A named engineering quantity with units and provenance."""

    name: str
    value: float
    unit: str
    provenance: Provenance = "assumption"
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "unit": self.unit,
            "provenance": self.provenance,
            "description": self.description,
        }


@dataclass
class StressBin:
    """A block of constant-amplitude stress cycles.

    stress_range: Δσ in MPa (peak-to-peak range, not amplitude)
    cycles: number of applied cycles (may be fractional for half cycles)
    mean_stress: σ_mean in MPa (recorded; the baseline S-N model is used without mean-stress correction)
    label: origin of the bin (e.g. 'ground-air-ground', 'manoeuvre', 'vibration')
    """

    stress_range: float
    cycles: float
    mean_stress: float = 0.0
    label: str = ""


@dataclass
class FlightLoading:
    """Everything a component model needs to know about one flight."""

    stress_bins: list[StressBin] = field(default_factory=list)
    duration_s: float = 0.0
    landing_cycles: int = 1
    max_stress_mpa: float = 0.0
    peak_temperature_k: float = 293.15
    mean_temperature_k: float = 293.15
    thermal_cycles: int = 1
    delta_temperature_k: float = 0.0
    pressure_cycles: int = 0
    pressure_mpa: float = 0.0
    environment_factor: float = 1.0
    # time at or near peak temperature (creep-relevant), seconds
    hot_time_s: float = 0.0
    channels: dict[str, Any] = field(default_factory=dict)


@dataclass
class StepResult:
    """Outcome of propagating a component state through one flight."""

    new_state: dict[str, float]
    increments: dict[str, float]
    outputs: dict[str, Any]
    threshold_status: str  # 'within_threshold' | 'threshold_crossed' | 'insufficient_evidence'
    threshold_detail: str
    warnings: list[str] = field(default_factory=list)


class DegradationModel(ABC):
    """Abstract interface implemented by each component model."""

    model_type: str = "abstract"
    display_name: str = "Abstract model"
    mechanisms: list[str] = []

    @abstractmethod
    def default_parameters(self) -> dict[str, Parameter]:
        ...

    @abstractmethod
    def default_state(self) -> dict[str, float]:
        ...

    @abstractmethod
    def validate_parameters(self, params: dict[str, float]) -> list[str]:
        """Return a list of validation errors (empty if OK)."""

    @abstractmethod
    def step(self, state: dict[str, float], params: dict[str, float], loading: FlightLoading) -> StepResult:
        ...

    @abstractmethod
    def remaining_life(self, state: dict[str, float], params: dict[str, float], reference_loading: FlightLoading) -> dict[str, Any]:
        ...

    @abstractmethod
    def equations(self) -> list[dict[str, str]]:
        ...

    @abstractmethod
    def relevant_mission_inputs(self) -> list[str]:
        """Which mission parameters matter for this component (for dynamic UI)."""

    @abstractmethod
    def uncertain_parameters(self) -> dict[str, dict[str, Any]]:
        """Distribution definitions for Monte Carlo sampling."""


def require_positive(params: dict[str, float], keys: list[str], errors: list[str]) -> None:
    for k in keys:
        v = params.get(k)
        if v is None:
            errors.append(f"Missing required parameter '{k}'.")
        elif not isinstance(v, (int, float)) or v != v:  # NaN check
            errors.append(f"Parameter '{k}' must be numeric.")
        elif v <= 0:
            errors.append(f"Parameter '{k}' must be positive (got {v}).")
