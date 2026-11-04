# AeroSim — Historical-Data-Driven, Self-Evolving Aircraft Component Digital Twin

*Learn from every actual flight. Update with reliable inspection evidence. Improve the next component-life prediction.*

Category: **Aerospace & Defence — Predict Aircraft Component Failures Before They Happen.**

> AeroSim is a research and engineering demonstration prototype. Its outputs are model-based estimates and must not be used as substitutes for approved aircraft maintenance procedures, certified engineering analysis or airworthiness decisions.

---

## 1. Project overview

AeroSim is a physics-based aerospace engineering platform that maintains **individual digital twins for aircraft components** using their own historical sensor observations, physical inspection records, maintenance history and engineering specifications.

It uses the component's calibrated condition and the available information about its **next actual scheduled flight** to predict expected operational response and future degradation. After each completed flight, AeroSim compares the stored pre-flight prediction with the actual post-flight observations of the same flight ID, corrects its operational model using reliable evidence, and updates the component damage estimate only when validated inspection measurements (or maintenance records) become available. The updated twin predicts the next flight, creating a continuous flight-by-flight learning and prognostics workflow:

```
historical component information → individual twin initialisation (chronological replay)
→ upcoming-flight information (schedule → comparable history → documented estimate)
→ immutable pre-flight prediction → actual flight → post-flight observations (by flight ID)
→ prediction-vs-actual reconciliation → operational-model correction (Stage A)
→ inspection-confirmed damage-state correction (Stage B) → next-flight prediction → …
```

Digital twins, physics-based degradation modelling and prediction-versus-actual learning each have established precedents. The **proposed technical contribution** is the controlled two-stage update method — operational correction separated from inspection-confirmed damage correction, gated by evidence quality — which is evaluated chronologically against a hidden reference model (static vs calibrated vs two-stage). Improvement is reported only where it is measured.

A secondary **engineering what-if** simulator (mission studio, sequence simulation) lets engineers explore hypothetical conditions from the current calibrated twin; it is visually separated and labelled *"Engineering What-If Scenario — Not an Actual Scheduled Flight"*, and never changes the twin.

## 2. Problem statement

Aircraft components degrade by different mechanisms — structural fatigue and crack propagation, thermal creep and oxidation, seal wear and leakage. Flight data, physics models and inspection findings each carry a different *kind* of information: flight data says how the component was loaded, the model says what that loading should do, and an inspection says what actually happened to the material. Treating a telemetry residual as damage, or ignoring an inspection because the model disagrees, both produce wrong predictions; so does continuing a component's damage history across a replacement. Engineering teams need a traceable, component-specific way to combine these sources and to see how the next flights change a component's condition.

## 3. Main features

| Area | What works |
|---|---|
| Live 3D twin & flight playback | Procedural Three.js model per component type (engine mount, landing gear, turbine blade, hydraulic actuator) reacting in real time to load, temperature, vibration and pressure; crack/pit/creep/wear damage rendered from the actual stored state; forecast-vs-sensor gauges and chart revealed as a flight plays; evidence-gate decision animated at the end; scrub, auto-play and ×30–×900 speed |
| Fleet & component registry | One demonstration aircraft shown as an interactive 3D model with health-coloured component hotspots; 13 individual component instances (aircraft, position, P/N, S/N, installation date); 6 with implemented models (two engine mounts, two landing gears, HP turbine blade, hydraulic actuator — same part numbers never share a damage state); create/edit instances; extended failure catalogue |
| Component historical profile | Per-instance sensor observation history (measured vs unavailable channels), inspection records, maintenance records, baseline with per-variable provenance, degradation progression |
| Component digital twin | Current estimated condition with the origin of every state variable, calibrated response parameters, equations, required measurements and legitimate outputs, remaining life, margins, update history, schematic |
| Twin initialisation | Chronological replay of the component's own history: pre-flight prediction → observation → reconciliation → gated Stage A → as-flown commit per flight; inspections (Stage B); repairs/replacements reset the state |
| Flights & schedule | Upcoming schedule (scheduled info only) with missing-data indicators and manual entry; flight history with as-flown conditions and the observations attached to each flight ID; demo "complete flight" |
| Upcoming flight predictions | Condition resolution (scheduled → comparable earlier flights → engineering estimate, each field tagged with provenance and ±1σ); immutable prediction records (model version, input-data version, parameters, assumptions, channels, damage, RUL, Monte Carlo) |
| Prediction reconciliation | Prediction ↔ observation linked by flight ID; forecast error split into schedule deviation and response-model error; residual/overlay charts; measurement reliability; evidence gate; controlled Stage A; history incorporation; anomaly injection; CSV upload; manual entry |
| Inspection evidence & maintenance | 10 evidence types; inverse-variance fusion; new-defect initialisation; contradictory-evidence rejection; identifiable rate-coefficient re-estimation; maintenance repair/replacement handling; audit trail |
| Model evolution | Timeline of predictions, observations, reconciliations, inspections, maintenance and update decisions; error across successive flights; parameters by version |
| Validation | 111 backend tests run on request; a before/after scoreboard (static model vs self-evolving twin) plus the full chronological A / B / C / C-sparse experiment on the component's own flights against the hidden reference |
| Methodology, settings & data | Equations and limitations; 9 CSV templates with strict validation; example synthetic dataset; twin re-initialisation; deterministic demo and reset |

## 4. System architecture

```
React + TypeScript (Vite, Tailwind, Recharts, Zustand)        FastAPI (Python 3.11+)
┌─────────────────────────────────┐   JSON/HTTP   ┌────────────────────────────────────────────┐
│ pages/  Overview · Registry     │ ◄───────────► │ api/routes.py  (thin, typed by schemas.py)  │
│   Twin + Historical profile     │               │ services/  twin · history · reconciliation  │
│   Flights · Predictions         │               │            calibration · inspection         │
│   Reconciliation · Inspections  │               │            uncertainty · model_history      │
│   Model evolution · Validation  │               │            validation · csv_import · demo   │
│   What-if (secondary)           │               │            simulation (what-if) · seed      │
│ components/charts, schematics   │               │ engine/    PURE physics (no I/O)            │
│ api/client.ts + types.ts        │               │            fatigue · crack_growth · creep   │
└─────────────────────────────────┘               │            thermal_fatigue · surrogates     │
                                                  │            response · component_models      │
                                                  │ db.py      SQLite JSON-document store       │
                                                  └────────────────────────────────────────────┘
```

Entities: aircraft · component instance · flight (scheduled vs actual) · component observation record · inspection record · maintenance record · prediction record (immutable) · reconciliation · model-update record · hidden reference model (validation only). See `PROJECT_PLAN.md`.

## 5. Technology stack

Frontend: React 19, TypeScript, Vite, Tailwind CSS 4, three.js + @react-three/fiber + drei, Recharts, Lucide, React Router, Zustand, Vitest + Testing Library. Backend: Python 3.11+, FastAPI, Pydantic v2, NumPy, SciPy, Pandas, `rainflow` (ASTM E1049), SQLite, pytest.

## 6. Mathematical models (summary)

| Component | Mechanisms | Equations |
|---|---|---|
| Engine mount / pylon lug | fatigue, crack propagation | N = A/Δσ^m with endurance limit; D = Σ nᵢ/Nᵢ; da/dN = C(ΔK)^m, ΔK = YΔσ√(πa), a_c = (K_IC/(Yσ_max))²/π; rainflow counting for histories; documented structural transfer from engine/aircraft parameters |
| Landing-gear outer cylinder | landing-cycle fatigue, crack propagation (if detected), corrosion | as above + dp/dt = r₀·f_env |
| HP turbine blade | creep, thermal fatigue, oxidation | ε̇ = Aσⁿexp(−Q/RT); Δε = k_c·α·ΔT with Coffin–Manson; x² = k_p·t |
| Hydraulic actuator | seal wear, leakage, pressure-performance change | ΔW = k_w·n_p·(p/p_ref)^α·exp(β(T−T_ref))·(1+γW); Q = Q₀ + k_q·W (empirical surrogate) |
| Learning | Stage A / B / C | scalar recursive least squares with forgetting on the as-flown baseline regressor; inverse-variance fusion; new-defect initialisation; MAD-robust outlier screen; identifiability criterion for coefficient re-estimation |
| Uncertainty | Monte Carlo | seeded sampling of parameter / measurement / operational / model-form inputs; sample percentiles (not calibrated); Spearman sensitivity |

Full detail: `METHODOLOGY.md`, `MODEL_ASSUMPTIONS.md`.

## 7. Installation

Prerequisites: Python ≥ 3.11, Node ≥ 20, npm.

```bash
git clone https://github.com/Samxxr007/AEROSIM.git
cd AEROSIM

cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..

cd frontend
npm install
cd ..

cp .env.example .env    # optional; defaults work without it
```

Database initialisation is automatic: on first start the backend creates `backend/aerosim.db` and seeds the demonstration fleet with its synthetic history (12 completed flights, 72 component observations, 8 inspections, 2 maintenance records, 3 scheduled flights).

## 8. Startup commands

```bash
# Terminal 1 — API (http://127.0.0.1:8000, docs at /docs)
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — UI (http://127.0.0.1:5173)
cd frontend && npm run dev
```

Or both: `./run_dev.sh`. Tests: `cd backend && pytest -q`; `cd frontend && npm test`; `npm run typecheck && npm run build`. GitHub Actions additionally runs Playwright against the real API + Vite app for the browser acceptance workflow.

## 9. Demo instructions

1. Open http://127.0.0.1:5173/overview and press **Run demo sequence** (Engine Mount Fatigue Assessment — ENG-MOUNT-001). In ≈ 5 s the backend: loads the aircraft and the component profile, its 12 historical observation records, inspections and maintenance; initialises every twin by replaying its own history; loads the next scheduled flight; stores the pre-flight prediction; completes the flight with synthetic observations; reconciles; applies Stage A and incorporates the flight; imports a synthetic ultrasonic measurement; applies Stage B; predicts the following flight with the updated twin; and runs the chronological A/B/C experiment.
2. Follow the 15 steps on screen, then open **Upcoming flight predictions**, **Prediction reconciliation**, **Model evolution** and **Validation**.
3. Do it manually: Settings → *Reset demo data*; Predictions → *Initialise twin from history* → *Generate and store pre-flight prediction*; Reconciliation → *Fly* (optionally inject dropout/outliers/sensor fault) → *Compare* → *Apply* → *Incorporate flight*; Inspections → submit a finding (try a contradictory 3 mm crack and watch it be rejected).
4. A second demonstration (Hydraulic Actuator Seal-Wear Assessment — HYD-ACT-001, including a seal replacement in its history) is available from the same control.

A 3–5 minute jury script is in `DEMO_SCRIPT.md`.

## 10. Data limitations

* No real aircraft telemetry, fleet statistics or inspection records are included. The fleet history is generated by a documented hidden reference model per component instance with deterministic seeds; every synthetic record is labelled (**SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH**, provenance `synthetic_demo`).
* Material coefficients are illustrative values of the stated material classes (provenance `assumption`), not certified allowables.
* The PHM 2019 aluminum lap-joint archive is not bundled. Until the user supplies it under `data/external/phm2019/raw/`, the independent PHM report is intentionally `not_ready`; no real experimental MAE/RMSE has been claimed.
* The example dataset under `data/example_dataset/` is exported from the seeded history by `backend/scripts/generate_example_dataset.py` (see `data/README.md`); public engineering datasets can be imported through the same CSV interface when they fit a component and model.

## 11. Engineering limitations

Constant geometry factor; no mean-stress correction; linear Miner summation without load interaction; secondary creep only; constraint-based thermal strain without through-wall gradients; empirical seal-wear surrogate; phase-table structural transfer model instead of validated FEA/flight-test loads; user-declared critical-net-section traces are not independently mapped to the engine-mount sensor/load path; comparable-flight statistics from a small synthetic history; Monte Carlo intervals are uncalibrated sample percentiles; remaining life is expressed in flights of a reference mission, never calendar time. The application makes no airworthiness, dispatch or maintenance decisions.

## 12. Future improvements

Qualified component-specific material datasets with scatter bands; measured strain-to-critical-section stress transfer validated against geometry or FEA; flight-test-derived response models (strain surveys); mean-stress and retardation models; probabilistic calibration of intervals against held-out experimental data; multi-parameter Kalman/EKF where the response model becomes nonlinear; FE-derived stress-intensity solutions; population-level priors shared across instances of the same part number; additional catalogue mechanisms; operator roles and signed audit trails.

## 13. Repository documents

`PROJECT_PLAN.md` · `METHODOLOGY.md` · `MODEL_ASSUMPTIONS.md` · `VALIDATION_REPORT.md` · `API_DOCUMENTATION.md` · `DEMO_SCRIPT.md` · `data/README.md` · `.env.example`


## External experimental validation — PHM 2019 crack growth

AeroSim now includes a separate loader and validation panel for the **PHM 2019 Fatigue Crack Growth in Aluminum Lap Joint** experiment. The dataset contains laboratory fatigue tests with Lamb-wave signals and optical crack-length measurements. It is used as an external crack-growth benchmark only; it is not aircraft flight telemetry and is never inserted into the aircraft fleet's flight records.

The challenge documentation identifies T1–T6 as the labelled training specimens. T7–T8 are validation specimens without released crack-length ground truth, so AeroSim excludes them from supervised scoring. The external benchmark runs (1) a within-specimen rolling-origin, one-step-ahead comparison of last-value carry-forward and a monotone-clipped linear trend, and (2) a leave-one-specimen-out Paris-law method check using AeroSim's crack-growth integrator. Paris C,m are fitted on five specimens and forecasts are evaluated on the held-out training specimen. Y=1.12, R=0 and ΔKth=0 are assumptions; KIC is a high numerical guard, not a measured specimen property. No remaining-life-to-failure result is claimed.

Download and extract the archive under data/external/phm2019/raw/. The backend attempts to read the optical crack-length tables from Description_T1.xlsx through Description_T6.xlsx. If your archive uses a different workbook layout, prepare data/external/phm2019/labels.csv with columns specimen,cycle,crack_length_mm; see data/external/phm2019/labels.template.csv. The loader scans the signal files for time,ch1,ch2 samples and reports descriptive signal-feature correlations where cycle labels can be matched.

See data/external/phm2019/README.md for download, placement, provenance and validation details.

## Historical-data ingestion notes

Uploaded operational summaries and stress time histories are retained as individually traceable records in the component history view. A summary linked to a completed flight of the same aircraft/date supplements that component's as-flown operating conditions and can advance its physical twin during chronological replay. It does not create a sensor observation or Stage-A residual. Stress samples are preserved with ordered seconds/MPa data and rainflow bins. Only an explicitly declared, linked engine-mount critical-net-section trace is currently used in the as-flown crack-growth step; the declaration is user-supplied and still requires engineering verification of sensor location, net-section geometry and load path. Unmapped traces remain archived and excluded from physics replay.

Component identity corrections are recorded as audited before/after events. A physical replacement retires the old component ID and creates a new serial-numbered component ID with a fresh baseline and model version; existing predictions stay attached to the old ID.

Backend and frontend checks run in GitHub Actions on pushes to main and pull requests.
