def test_linked_component_operating_records_and_critical_stress_trace_feed_as_flown_physics(client, db):
    operational = (
        "component_id,flight_id,flight_date,duration_min,landing_cycles,load_factor,load_variation,manoeuvre_intensity,max_temperature_c,pressure_factor,vibration_level,operating_intensity,environment,source,notes\n"
        "ENG-MOUNT-001,AC001-F0012,2026-10-28,99,1,1.7,0.15,1.4,72,1.0,1.1,1.05,benign,operator log,linked as-flown summary\n"
    )
    response = client.post(
        "/api/data/import?dataset=operational_records&commit=true",
        files={"file": ("linked-operations.csv", operational.encode(), "text/csv")},
    )
    assert response.status_code == 200 and response.json()["ok"], response.json()

    stress = (
        "component_id,flight_id,stress_basis,t_s,stress_mpa\n"
        "ENG-MOUNT-001,AC001-F0012,critical_net_section,0,0\n"
        "ENG-MOUNT-001,AC001-F0012,critical_net_section,1,180\n"
        "ENG-MOUNT-001,AC001-F0012,critical_net_section,2,20\n"
        "ENG-MOUNT-001,AC001-F0012,critical_net_section,3,220\n"
        "ENG-MOUNT-001,AC001-F0012,critical_net_section,4,30\n"
        "ENG-MOUNT-001,AC001-F0012,critical_net_section,5,160\n"
    )
    response = client.post(
        "/api/data/import?dataset=load_history&commit=true",
        files={"file": ("mapped-stress.csv", stress.encode(), "text/csv")},
    )
    assert response.status_code == 200 and response.json()["ok"], response.json()

    from app.services.twin import as_flown_step, component_actual_conditions

    component = db.get("components", "ENG-MOUNT-001")
    flight = db.get("flights", "AC001-F0012")
    actual = component_actual_conditions(db, component["id"], flight)
    assert actual["duration_min"] == 99.0
    assert actual["load_factor"] == 1.7
    assert actual["_operational_record_id"]

    step, loading = as_flown_step(db, component, flight)
    assert loading.max_stress_mpa == 220.0
    assert sum(b.cycles for b in loading.stress_bins) > 0
    assert loading.source_metadata["operational_record_id"] == actual["_operational_record_id"]
    assert loading.source_metadata["stress_basis"] == "critical_net_section"
    assert loading.source_metadata["mapping_provenance"] == "user_declared"
    assert "crack_length_m" in step.new_state

    history = client.get("/api/components/ENG-MOUNT-001/history").json()
    assert history["operational_records"][0]["flight_id"] == "AC001-F0012"
    assert history["operational_records"][0]["automatic_twin_replay"] is True
    assert history["load_histories"][0]["stress_basis"] == "critical_net_section"
    assert history["load_histories"][0]["automatic_twin_replay"] is True


def test_unmapped_stress_history_is_archived_but_not_applied_to_physics(client):
    stress = (
        "component_id,flight_id,stress_basis,t_s,stress_mpa\n"
        "ENG-MOUNT-001,,not_mapped,0,0\n"
        "ENG-MOUNT-001,,not_mapped,1,180\n"
        "ENG-MOUNT-001,,not_mapped,2,20\n"
        "ENG-MOUNT-001,,not_mapped,3,220\n"
    )
    response = client.post(
        "/api/data/import?dataset=load_history&commit=true",
        files={"file": ("unmapped-stress.csv", stress.encode(), "text/csv")},
    )
    assert response.status_code == 200 and response.json()["ok"]
    record = client.get("/api/components/ENG-MOUNT-001/history").json()["load_histories"][0]
    assert record["stress_basis"] == "not_mapped"
    assert record["automatic_twin_replay"] is False
    assert record["mapping_provenance"] == "not_mapped"


def test_operational_only_completed_flight_replays_without_stage_a_sensor_calibration(db):
    from app.services.twin import replay_history

    flight_id = "AC001-F9001"
    db.insert("flights", {
        "id": flight_id,
        "aircraft_id": "AIRCRAFT-001",
        "sequence": 9001,
        "flight_date": "2026-10-30",
        "event_time": "2026-10-30T10:00:00+00:00",
        "route_or_mission": "DEMO-A → DEMO-B",
        "scheduled": {"duration_min": 120, "landing_cycles": 1, "route": "DEMO-A → DEMO-B"},
        "actual": {"duration_min": 120, "landing_cycles": 1, "load_factor": 1.0, "load_variation": 0.1, "manoeuvre_intensity": 1.0, "temperature_c": 18, "pressure_factor": 1.0, "vibration_level": 1.0, "operating_intensity": 1.0, "environment": "benign"},
        "status": "completed",
        "completion_source": "uploaded operating log",
        "provenance": "uploaded",
    })
    db.insert("operational_records", {
        "id": "opr-linked-no-sensors",
        "component_id": "ENG-MOUNT-001",
        "aircraft_id": "AIRCRAFT-001",
        "flight_id": flight_id,
        "operational_date": "2026-10-30",
        "event_time": "2026-10-30T10:00:00+00:00",
        "conditions": {
            "duration_min": 95.0, "landing_cycles": 1, "load_factor": 1.6, "load_variation": 0.15,
            "manoeuvre_intensity": 1.2, "temperature_c": 28.0, "pressure_factor": 1.0,
            "vibration_level": 1.1, "operating_intensity": 1.05,
        },
        "environment": "marine",
        "source": "flight summary",
        "provenance": "uploaded",
        "automatic_twin_replay": True,
    })

    result = replay_history(db, "ENG-MOUNT-001")
    metric = next(item for item in result["metrics"] if item["flight_id"] == flight_id)
    assert metric["gate"] == "no_sensor_observation"
    assert metric["data_sources"]["operational_record_id"] == "opr-linked-no-sensors"
    assert result["component"]["evidence_summary"]["completed_flights_without_sensor_observations"] == 1
    assert result["component"]["evidence_summary"]["completed_flights_replayed"] == 13


def test_component_identity_correction_and_replacement_preserve_old_instance_and_prediction_identity(client):
    init = client.post("/api/twin/ENG-MOUNT-001/initialise")
    assert init.status_code == 200

    before = client.get("/api/components/ENG-MOUNT-001").json()
    old_state = before["state"].copy()
    old_serial = before["serial_number"]
    old_predictions = before["predictions"]
    assert len(old_predictions) > 0

    correction = client.post("/api/components/ENG-MOUNT-001/identity-change", json={
        "effective_date": "2026-11-01",
        "serial_number": "SN-EM-0187-CORRECTED",
        "reason": "Verified the serial number against the component nameplate and maintenance register.",
        "maintenance_reference": "IDENTITY-CORR-001",
        "provenance": "uploaded",
    })
    assert correction.status_code == 200, correction.text
    assert correction.json()["component"]["serial_number"] == "SN-EM-0187-CORRECTED"
    assert correction.json()["event"]["changes"]["serial_number"]["before"] == old_serial

    stale_edit = client.put("/api/components/ENG-MOUNT-001", json={
        "name": before["name"], "system": before["system"], "serial_number": "SILENT-OVERWRITE",
    })
    assert stale_edit.status_code == 409

    replacement = client.post("/api/components/ENG-MOUNT-001/replace", json={
        "replacement_date": "2026-11-02",
        "new_serial_number": "SN-EM-1187",
        "reason": "Physical engine mount removed and replaced; new serial is tracked as a distinct component instance.",
        "maintenance_reference": "WO-2026-REPLACE-001",
        "manufacturer": before["manufacturer"],
        "part_number": before["part_number"],
        "provenance": "manual",
    })
    assert replacement.status_code == 201, replacement.text
    retired = replacement.json()["retired_component"]
    active = replacement.json()["replacement_component"]
    assert retired["id"] == "ENG-MOUNT-001"
    assert retired["lifecycle_status"] == "retired"
    assert retired["replaced_by_component_id"] == active["id"]
    assert retired["state"] == old_state
    assert active["serial_number"] == "SN-EM-1187"
    assert active["replaces_component_id"] == "ENG-MOUNT-001"
    assert active["history_initialised"] is False
    assert len(client.get("/api/components/ENG-MOUNT-001").json()["predictions"]) == len(old_predictions)
    assert client.get("/api/twin/ENG-MOUNT-001/next-flight").json()["flight"] is None

    old_prediction = client.get(f"/api/predictions/{old_predictions[0]['id']}").json()
    assert old_prediction["component_identity_snapshot"]["serial_number"] == old_serial
    assert old_prediction["component_id"] == "ENG-MOUNT-001"
    assert active["id"] != old_prediction["component_id"]


def test_component_identity_serial_number_must_be_unique(client):
    duplicate = client.post("/api/components/ENG-MOUNT-001/identity-change", json={
        "effective_date": "2026-11-01",
        "serial_number": "SN-EM-0192",
        "reason": "Correcting the serial number to the value on the maintenance register.",
        "maintenance_reference": "IDENTITY-DUP-001",
    })
    assert duplicate.status_code == 409


def test_maintenance_csv_cannot_replace_a_physical_component_in_place(client):
    csv = (
        "component_id,maintenance_date,activity,repair_or_replacement,maintenance_reference,notes\n"
        "ENG-MOUNT-001,2026-11-05,Engine mount replacement,replacement,WO-REPLACE-CSV-001,physical replacement\n"
    )
    response = client.post(
        "/api/data/import?dataset=maintenance_records&commit=true",
        files={"file": ("replacement.csv", csv.encode(), "text/csv")},
    )
    assert response.status_code == 200
    report = response.json()
    assert report["ok"] is False
    assert any("new component ID" in problem for problem in report["problems"])
    assert client.get("/api/components/ENG-MOUNT-001").json().get("lifecycle_status", "active") == "active"
