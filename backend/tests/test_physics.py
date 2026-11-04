"""Physics tests for every implemented degradation equation."""
import math

import pytest

from app.engine import crack_growth as cg
from app.engine import creep as cr
from app.engine import fatigue as fa
from app.engine import surrogates as su
from app.engine import thermal_fatigue as tf
from app.engine.base import EngineError, StressBin
from app.engine.registry import DEFAULT_RESPONSE_PARAMS, get_model
from app.engine.response import Mission, build_flight_loading, mission_from_preset


# ------------------------------------------------------------------ S-N / Miner
def test_basquin_cycles_decrease_with_stress():
    assert fa.cycles_to_failure(100, 1e14, 4) > fa.cycles_to_failure(200, 1e14, 4)


def test_basquin_closed_form():
    assert fa.cycles_to_failure(200, 1e14, 4) == pytest.approx(1e14 / 200 ** 4)


def test_endurance_limit_gives_no_damage():
    assert math.isinf(fa.cycles_to_failure(30, 1e14, 4, endurance_limit_mpa=35))
    d, _ = fa.miner_damage([StressBin(30, 1e6)], 1e14, 4, 35)
    assert d == 0.0


def test_miner_damage_increases_with_cycles():
    d1, _ = fa.miner_damage([StressBin(200, 100)], 1e14, 4)
    d2, _ = fa.miner_damage([StressBin(200, 200)], 1e14, 4)
    assert d2 == pytest.approx(2 * d1)
    assert d2 > d1


def test_miner_damage_increases_with_stress():
    d1, _ = fa.miner_damage([StressBin(200, 100)], 1e14, 4)
    d2, _ = fa.miner_damage([StressBin(250, 100)], 1e14, 4)
    assert d2 > d1


def test_miner_rejects_negative_cycles():
    with pytest.raises(EngineError):
        fa.miner_damage([StressBin(200, -1)], 1e14, 4)


def test_sn_rejects_invalid_parameters():
    with pytest.raises(EngineError):
        fa.cycles_to_failure(100, -1, 4)
    with pytest.raises(EngineError):
        fa.cycles_to_failure(-5, 1e14, 4)


def test_rainflow_simple_history():
    # ASTM E1049 example-like: a few reversals; total counted cycles must be > 0 and ranges positive
    series = [0, 100, 0, 150, 50, 150, 0, 100, 0]
    bins = fa.rainflow_bins(series)
    assert all(b.stress_range > 0 for b in bins)
    assert sum(b.cycles for b in bins) >= 2.0
    # largest range in the series is 150 (0→150)
    assert max(b.stress_range for b in bins) == pytest.approx(150)


def test_rainflow_rejects_short_or_nan():
    with pytest.raises(EngineError):
        fa.rainflow_bins([0, 1])
    with pytest.raises(EngineError):
        fa.rainflow_bins([0, float("nan"), 1, 2])


def test_equivalent_stress_range():
    eq, n = fa.equivalent_constant_amplitude([StressBin(100, 10), StressBin(100, 10)], 3)
    assert eq == pytest.approx(100)
    assert n == 20


# ------------------------------------------------------------------ Paris law
PARIS = dict(C=1e-11, m=3.0, Y=1.12, delta_K_th=3.0, K_IC=60.0, sigma_max_mpa=250.0)


def test_delta_K_formula():
    assert cg.stress_intensity_range(200, 0.005, 1.12) == pytest.approx(1.12 * 200 * math.sqrt(math.pi * 0.005))


def test_crack_does_not_decrease():
    r = cg.integrate_paris(0.005, [StressBin(200, 1000)], **PARIS)
    assert r["a_final_m"] >= 0.005
    assert r["growth_m"] >= 0


def test_crack_growth_increases_with_stress_intensity():
    r1 = cg.integrate_paris(0.005, [StressBin(150, 1000)], **PARIS)
    r2 = cg.integrate_paris(0.005, [StressBin(250, 1000)], **PARIS)
    assert r2["growth_m"] > r1["growth_m"]


def test_no_growth_below_threshold():
    r = cg.integrate_paris(0.001, [StressBin(10, 1e6)], **PARIS)  # ΔK ≈ 0.63 < 3
    assert r["growth_m"] == 0.0


def test_paris_rate_matches_closed_form_for_small_growth():
    # for very few cycles growth ≈ C ΔK^m N
    a0 = 0.005
    dK = cg.stress_intensity_range(200, a0, 1.12)
    r = cg.integrate_paris(a0, [StressBin(200, 1)], **PARIS)
    assert r["growth_m"] == pytest.approx(1e-11 * dK ** 3, rel=1e-6)


def test_critical_crack_stops_integration():
    r = cg.integrate_paris(0.010, [StressBin(250, 1e9)], **PARIS)
    assert r["reached_critical"] is True
    assert r["a_final_m"] == pytest.approx(r["a_critical_m"])
    assert r["cycles_applied"] < 1e9


def test_critical_crack_length_formula():
    a_c = cg.critical_crack_length(60, 250, 1.12)
    assert a_c == pytest.approx((60 / (1.12 * 250)) ** 2 / math.pi)


def test_paris_rejects_missing_parameters():
    with pytest.raises(EngineError):
        cg.integrate_paris(0.005, [StressBin(200, 10)], C=0, m=3, Y=1.12, delta_K_th=3, K_IC=60, sigma_max_mpa=250)
    with pytest.raises(EngineError):
        cg.integrate_paris(0.0, [StressBin(200, 10)], **PARIS)


def test_cycles_to_critical_positive_and_finite():
    r = cg.cycles_to_critical(0.005, 200, 1e-11, 3.0, 1.12, 3.0, 60.0, 250.0)
    assert r["status"] == "ok"
    assert 0 < r["cycles"] < 1e9


# ------------------------------------------------------------------ creep
def test_creep_rate_formula():
    rate = cr.creep_strain_rate(250, 1150, 4.3e-8, 5, 300000)
    assert rate == pytest.approx(4.3e-8 * 250 ** 5 * math.exp(-300000 / (8.314 * 1150)))


def test_creep_strain_increases_with_time():
    e1 = cr.creep_strain_increment(250, 1150, 3600, 4.3e-8, 5, 300000)
    e2 = cr.creep_strain_increment(250, 1150, 7200, 4.3e-8, 5, 300000)
    assert e2 > e1 > 0


def test_creep_increases_with_temperature_and_stress():
    base = cr.creep_strain_rate(250, 1150, 4.3e-8, 5, 300000)
    assert cr.creep_strain_rate(250, 1200, 4.3e-8, 5, 300000) > base
    assert cr.creep_strain_rate(300, 1150, 4.3e-8, 5, 300000) > base


def test_creep_rejects_celsius_like_temperature():
    with pytest.raises(EngineError):
        cr.creep_strain_rate(250, -20, 4.3e-8, 5, 300000)


def test_creep_history_integration_matches_constant():
    e_hist = cr.integrate_creep_history([250, 250, 250], [1150, 1150, 1150], [0, 1800, 3600], 4.3e-8, 5, 300000)
    e_const = cr.creep_strain_increment(250, 1150, 3600, 4.3e-8, 5, 300000)
    assert e_hist == pytest.approx(e_const)


# ------------------------------------------------------------------ thermal fatigue
def test_thermal_fatigue_damage_increases_with_delta_T():
    d1 = tf.thermal_cycle_damage(1, 500, 1.4e-5, 0.35, 0.25, -0.6)["damage"]
    d2 = tf.thermal_cycle_damage(1, 700, 1.4e-5, 0.35, 0.25, -0.6)["damage"]
    assert d2 > d1 > 0


def test_thermal_fatigue_rejects_positive_exponent():
    with pytest.raises(EngineError):
        tf.coffin_manson_cycles(0.01, 0.25, 0.6)


# ------------------------------------------------------------------ surrogates
def test_actuator_wear_increases_with_pressure_cycles():
    w1 = su.seal_wear_increment(0.0, 100, 20.7, 323, 2.2e-6, 20.7, 1.8, 0.012, 323.15, 0.8)
    w2 = su.seal_wear_increment(0.0, 200, 20.7, 323, 2.2e-6, 20.7, 1.8, 0.012, 323.15, 0.8)
    assert w2 == pytest.approx(2 * w1)


def test_actuator_wear_increases_with_pressure_and_temperature():
    base = su.seal_wear_increment(0.0, 100, 20.7, 323.15, 2.2e-6, 20.7, 1.8, 0.012, 323.15, 0.8)
    assert su.seal_wear_increment(0.0, 100, 25.0, 323.15, 2.2e-6, 20.7, 1.8, 0.012, 323.15, 0.8) > base
    assert su.seal_wear_increment(0.0, 100, 20.7, 343.15, 2.2e-6, 20.7, 1.8, 0.012, 323.15, 0.8) > base


def test_oxide_parabolic_growth():
    x1 = su.parabolic_oxide_growth(0, 1150, 3600, 2e-6, 250000)
    x4 = su.parabolic_oxide_growth(0, 1150, 4 * 3600, 2e-6, 250000)
    assert x4 == pytest.approx(2 * x1)


def test_corrosion_increment_linear_and_env_scaled():
    assert su.pit_depth_increment(3600, 1e-12, 2.5) == pytest.approx(2.5 * su.pit_depth_increment(3600, 1e-12, 1.0))
    with pytest.raises(EngineError):
        su.pit_depth_increment(-1, 1e-12, 1.0)


# ------------------------------------------------------------------ composite models
@pytest.mark.parametrize("model_type", ["engine_mount", "landing_gear", "turbine_blade", "hydraulic_actuator"])
def test_every_model_steps_and_accumulates(model_type):
    m = get_model(model_type)
    params = {k: p.value for k, p in m.default_parameters().items()}
    assert m.validate_parameters(params) == []
    state = m.default_state()
    if model_type == "landing_gear":
        state["crack_length_m"] = 0.002
    L = build_flight_loading(model_type, params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("normal"))
    r1 = m.step(state, params, L)
    r2 = m.step(r1.new_state, params, L)
    key = {"engine_mount": "miner_damage", "landing_gear": "miner_damage", "turbine_blade": "creep_strain", "hydraulic_actuator": "wear_indicator"}[model_type]
    assert r1.new_state[key] > state[key]
    assert r2.new_state[key] > r1.new_state[key]
    assert r1.threshold_status in ("within_threshold", "threshold_crossed")


def test_increased_load_mission_causes_more_fatigue_damage():
    m = get_model("engine_mount")
    params = {k: p.value for k, p in m.default_parameters().items()}
    st = m.default_state()
    d_norm = m.step(st, params, build_flight_loading("engine_mount", params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("normal"))).increments["miner_damage"]
    d_high = m.step(st, params, build_flight_loading("engine_mount", params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("increased_load"))).increments["miner_damage"]
    assert d_high > d_norm


def test_high_temperature_mission_causes_more_creep():
    m = get_model("turbine_blade")
    params = {k: p.value for k, p in m.default_parameters().items()}
    st = m.default_state()
    e_norm = m.step(st, params, build_flight_loading("turbine_blade", params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("normal"))).increments["creep_strain"]
    e_hot = m.step(st, params, build_flight_loading("turbine_blade", params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("high_temperature"))).increments["creep_strain"]
    assert e_hot > e_norm


def test_load_transfer_factor_scales_stress():
    m = get_model("engine_mount")
    params = {k: p.value for k, p in m.default_parameters().items()}
    L1 = build_flight_loading("engine_mount", params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("normal"))
    L2 = build_flight_loading("engine_mount", params, {**DEFAULT_RESPONSE_PARAMS, "load_transfer_factor": 1.2}, mission_from_preset("normal"))
    assert L2.max_stress_mpa == pytest.approx(1.2 * L1.max_stress_mpa)
    assert max(L2.channels["load_kN"]) == pytest.approx(1.2 * max(L1.channels["load_kN"]), rel=1e-6)


def test_mission_validation_rejects_out_of_range():
    bad = Mission(duration_min=2)
    assert bad.validate()
    with pytest.raises(EngineError):
        m = get_model("engine_mount")
        params = {k: p.value for k, p in m.default_parameters().items()}
        build_flight_loading("engine_mount", params, DEFAULT_RESPONSE_PARAMS, bad)


def test_model_rejects_missing_essential_parameters():
    m = get_model("engine_mount")
    params = {k: p.value for k, p in m.default_parameters().items()}
    del params["K_IC"]
    assert any("K_IC" in e for e in m.validate_parameters(params))


def test_remaining_life_uses_component_units():
    m = get_model("engine_mount")
    params = {k: p.value for k, p in m.default_parameters().items()}
    rl = m.remaining_life(m.default_state(), params, build_flight_loading("engine_mount", params, DEFAULT_RESPONSE_PARAMS, mission_from_preset("normal")))
    assert rl["unit"] == "flights of the reference mission"
    assert rl["governing_remaining_flights"] is None or rl["governing_remaining_flights"] > 0
