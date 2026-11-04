"""Model registry: model_type → DegradationModel instance.

Adding a new degradation model means implementing DegradationModel in
component_models.py (or a new module) and registering it here. The API,
simulation, uncertainty and UI layers discover models through this registry.
"""
from __future__ import annotations

from .base import DegradationModel
from .component_models import EngineMountModel, HydraulicActuatorModel, LandingGearModel, TurbineBladeModel

MODEL_REGISTRY: dict[str, DegradationModel] = {
    m.model_type: m for m in (EngineMountModel(), LandingGearModel(), TurbineBladeModel(), HydraulicActuatorModel())
}

DEFAULT_RESPONSE_PARAMS: dict[str, float] = {
    "load_transfer_factor": 1.0,
    "thermal_response_factor": 1.0,
    "vibration_response_factor": 1.0,
    "pressure_response_factor": 1.0,
}


def get_model(model_type: str) -> DegradationModel:
    if model_type not in MODEL_REGISTRY:
        raise KeyError(f"No implemented degradation model for '{model_type}'")
    return MODEL_REGISTRY[model_type]


def list_models() -> list[dict]:
    return [
        {
            "model_type": m.model_type,
            "display_name": m.display_name,
            "mechanisms": m.mechanisms,
            "equations": m.equations(),
            "relevant_mission_inputs": m.relevant_mission_inputs(),
            "state_variables": list(m.default_state().keys()),
            "parameters": [p.to_dict() for p in m.default_parameters().values()],
            "uncertain_parameters": m.uncertain_parameters(),
        }
        for m in MODEL_REGISTRY.values()
    ]
