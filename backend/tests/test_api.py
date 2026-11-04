"""API integration tests (FastAPI TestClient) for the primary workflow and the what-if tool."""


def test_health_and_overview(client):
    assert client.get("/api/health").json()["status"] == "ok"
    ov = client.get("/api/overview").json()
    assert ov["counts"]["components"] == 13 and ov["counts"]["modelled_components"] == 6
    assert ov["counts"]["flights_completed"] == 12 and ov["counts"]["flights_scheduled"] == 3
    assert ov["aircraft"][0]["id"] == "AIRCRAFT-001"


def test_component_crud_and_history(client):
    r = client.post("/api/components", json={"name": "Test lug", "system": "Airframe and structures", "aircraft_id": "AIRCRAFT-001", "model_type": "engine_mount", "state": {"crack_length_m": 0.003}, "serial_number": "SN-X"})
    assert r.status_code == 201
    cid = r.json()["id"]
    assert r.json()["baseline_state"]["crack_length_m"] == 0.003
    r = client.put(f"/api/components/{cid}", json={"name": "Test lug (edited)", "system": "Airframe and structures", "parameters": {"K_IC": {"value": 65.0}}})
    assert r.status_code == 200 and r.json()["parameters"]["K_IC"]["value"] == 65.0
    assert client.put(f"/api/components/{cid}", json={"name": "x", "system": "Airframe and structures", "parameters": {"K_IC": {"value": -1.0}}}).status_code == 422
    assert client.get("/api/components/NOPE").status_code == 404
    h = client.get("/api/components/ENG-MOUNT-001/history").json()
    assert len(h["observations"]) == 12 and "load_kN" in h["measured_quantities"] and "pressure_bar" in h["unavailable_quantities"]


def test_primary_workflow_via_api(client):
    r = client.post("/api/twin/ENG-MOUNT-001/initialise")
    assert r.status_code == 200 and r.json()["component"]["history_initialised"]
    nf = client.get("/api/twin/ENG-MOUNT-001/next-flight").json()
    assert nf["flight"]["id"] == "AC001-F0013" and nf["resolution"]["estimated_fields"]
    pred = client.post("/api/predictions", json={"component_id": "ENG-MOUNT-001", "flight_id": "AC001-F0013", "mc_samples": 20}).json()
    assert pred["status"] == "pending" and pred["uncertainty"]["n_samples"] == 20
    assert client.post("/api/predictions", json={"component_id": "ENG-MOUNT-001", "flight_id": "AC001-F0013", "mc_samples": 0}).status_code == 422
    assert client.post("/api/reconciliations", json={"prediction_id": pred["id"]}).status_code == 422  # flight not flown yet
    done = client.post("/api/flights/complete", json={"flight_id": "AC001-F0013"}).json()
    assert done["flight"]["status"] == "completed" and len(done["observation_ids"]) == 6
    rec = client.post("/api/reconciliations", json={"prediction_id": pred["id"]}).json()
    assert rec["flight_id"] == "AC001-F0013" and rec["gate"]["decision"] in ("accept", "accept_reduced_confidence")
    res = client.post(f"/api/reconciliations/{rec['id']}/apply", json={}).json()
    assert res["update"]["flight_id"] == "AC001-F0013"
    assert client.post(f"/api/predictions/{pred['id']}/commit").status_code == 200
    insp = client.post("/api/inspections", json={"component_id": "ENG-MOUNT-001", "inspection_date": "2026-11-05", "method": "ultrasonic", "quantity": "crack_length_m", "measured_value": 6.2, "unit": "mm", "measurement_uncertainty": 0.1}).json()
    assert insp["update"]["applied"]
    hist = client.get("/api/model-history?component_id=ENG-MOUNT-001").json()
    assert any(e["type"] == "prediction" for e in hist["timeline"])
    obs = client.get(f"/api/observations/{done['observation_ids'][0]}").json()
    assert "truth_state_after" not in obs
    st = client.get("/api/twin/ENG-MOUNT-001").json()
    assert st["next_scheduled_flight"]["id"] == "AC001-F0014"


def test_scheduled_flight_entry_and_prediction(client):
    r = client.post("/api/flights", json={"aircraft_id": "AIRCRAFT-001", "flight_date": "2026-12-01", "route_or_mission": "DEMO-A → DEMO-B", "duration_min": 125, "payload_fraction": 0.7})
    assert r.status_code == 201 and r.json()["status"] == "scheduled"
    assert client.post("/api/flights", json={"aircraft_id": "NOPE", "flight_date": "2026-12-01", "route_or_mission": "x", "duration_min": 60}).status_code == 404


def test_demo_and_reset(client):
    r = client.post("/api/demo/run?demo_id=engine_mount")
    assert r.status_code == 200
    d = r.json()
    assert len(d["steps"]) == 15
    assert d["experiment"]["conclusions"]["two_stage_reduced_state_error"] is True
    r = client.post("/api/demo/reset")
    assert r.json()["reset"] is True
    assert client.get("/api/overview").json()["counts"]["predictions"] == 0


def test_validation_experiment_endpoint(client):
    e = client.get("/api/validation/experiment/ENG-MOUNT-001").json()
    assert e["n_flights"] == 12 and "A" in e["summary"]


def test_csv_templates_and_import(client):
    t = client.get("/api/data/templates").json()
    assert {"flight_observations", "flight_schedule", "flight_actuals", "maintenance_records", "inspection_findings", "material_properties", "load_history", "operational_records", "predicted_outputs"} <= set(t)
    for ds in ("flight_schedule", "flight_actuals", "maintenance_records", "inspection_findings", "load_history"):
        csv = client.get(f"/api/data/templates/{ds}.csv").text
        r = client.post(f"/api/data/import?dataset={ds}&commit=false", files={"file": (f"{ds}.csv", csv.encode(), "text/csv")})
        assert r.status_code == 200 and r.json()["ok"], (ds, r.json())
    bad = "component_id,flight_id,t_s,load_kN\nENG-MOUNT-001,AC001-F0013,0,10\nENG-MOUNT-001,AC001-F0013,30,12\n"
    r = client.post("/api/data/import?dataset=flight_observations", files={"file": ("bad.csv", bad.encode(), "text/csv")})
    assert r.json()["ok"] is False and "still scheduled" in " ".join(r.json()["problems"])
    bad2 = "component_id,inspection_date,method,quantity,measured_value,unit\nENG-MOUNT-001,2026-11-04,ultrasonic,crack_length_m,6.2,inch\n"
    r = client.post("/api/data/import?dataset=inspection_findings", files={"file": ("bad2.csv", bad2.encode(), "text/csv")})
    assert r.json()["ok"] is False and "unit" in r.json()["problems"][0]


def test_what_if_compare_does_not_change_twin(client):
    before = client.get("/api/components/ENG-MOUNT-001").json()["state"]
    body = {"component_id": "ENG-MOUNT-001", "schedules": [{"component_id": "ENG-MOUNT-001", "name": "A", "missions": [{"profile": "normal"}] * 3}, {"component_id": "ENG-MOUNT-001", "name": "C", "missions": [{"profile": "increased_load"}, {"profile": "high_manoeuvre"}, {"profile": "increased_load"}]}]}
    r = client.post("/api/simulations/compare", json=body)
    assert r.status_code == 200 and "WHAT-IF" in r.json()["label"]
    s = r.json()["schedules"]
    assert s[1]["final_state"]["miner_damage"] > s[0]["final_state"]["miner_damage"]
    assert client.get("/api/components/ENG-MOUNT-001").json()["state"] == before


def test_settings(client):
    assert client.put("/api/settings", json={"mc_samples": 50}).json()["mc_samples"] == 50
    assert client.put("/api/settings", json={"mc_samples": 1}).status_code == 422
