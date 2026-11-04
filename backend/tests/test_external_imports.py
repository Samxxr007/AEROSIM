def test_phm_endpoint_reports_missing_local_dataset_without_fabricating_data(client):
    report = client.get("/api/validation/external/phm2019").json()
    assert report["status"] == "not_ready"
    assert report["labels_loaded"] == 0
    assert "Download the PHMDC2019_Data.zip archive" in " ".join(report["instructions"])


def test_operational_and_load_history_imports_are_preserved_in_component_history(client):
    operational = (
        "component_id,flight_id,flight_date,duration_min,landing_cycles,load_factor,max_temperature_c,environment,notes\n"
        "ENG-MOUNT-001,,2026-11-01,120,1,1.05,72,benign,uploaded operating summary\n"
    )
    response = client.post(
        "/api/data/import?dataset=operational_records&commit=true",
        files={"file": ("operations.csv", operational.encode(), "text/csv")},
    )
    assert response.status_code == 200 and response.json()["ok"]
    assert len(response.json()["imported"]) == 1

    stress = (
        "component_id,flight_id,t_s,stress_mpa\n"
        "ENG-MOUNT-001,,0,40\n"
        "ENG-MOUNT-001,,1,180\n"
        "ENG-MOUNT-001,,2,60\n"
        "ENG-MOUNT-001,,3,220\n"
        "ENG-MOUNT-001,,4,30\n"
    )
    response = client.post(
        "/api/data/import?dataset=load_history&commit=true",
        files={"file": ("stress.csv", stress.encode(), "text/csv")},
    )
    assert response.status_code == 200 and response.json()["ok"]
    assert len(response.json()["imported"]) == 1

    history = client.get("/api/components/ENG-MOUNT-001/history").json()
    assert len(history["operational_records"]) == 1
    assert history["operational_records"][0]["conditions"]["duration_min"] == 120.0
    assert history["operational_records"][0]["automatic_twin_replay"] is False
    assert len(history["load_histories"]) == 1
    assert history["load_histories"][0]["n_samples"] == 5
    assert len(history["load_histories"][0]["samples"]) == 5
    assert history["load_histories"][0]["automatic_twin_replay"] is False
