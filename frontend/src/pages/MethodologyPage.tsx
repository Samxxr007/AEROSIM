import { api } from '../api/client'
import { Callout, Card, ErrorBox, PageHeader, Spinner, Tag } from '../components/ui'
import { fmt } from '../utils/format'
import { useApi } from '../utils/useApi'

const DISCLAIMER = 'AeroSim is a research and engineering demonstration prototype. Its outputs are model-based estimates and must not be used as substitutes for approved aircraft maintenance procedures, certified engineering analysis or airworthiness decisions.'

const REFERENCES = [
  'Basquin, O. H. (1910). The exponential law of endurance tests. Proceedings of the American Society for Testing Materials, 10, 625–630.',
  'Miner, M. A. (1945). Cumulative damage in fatigue. Journal of Applied Mechanics, 12(3), A159–A164.',
  'Paris, P. C., & Erdogan, F. (1963). A critical analysis of crack propagation laws. Journal of Basic Engineering, 85(4), 528–533.',
  'ASTM E1049-85 (Reapproved 2017). Standard Practices for Cycle Counting in Fatigue Analysis. ASTM International.',
  'Tada, H., Paris, P. C., & Irwin, G. R. (2000). The Stress Analysis of Cracks Handbook (3rd ed.). ASME Press.',
  'Anderson, T. L. (2017). Fracture Mechanics: Fundamentals and Applications (4th ed.). CRC Press.',
  'Dowling, N. E. (2013). Mechanical Behavior of Materials (4th ed.). Pearson.',
  'Norton, F. H. (1929). The Creep of Steel at High Temperatures. McGraw-Hill.',
  'Manson, S. S. (1953). Behavior of materials under conditions of thermal stress. NACA Technical Note 2933.',
  'Coffin, L. F. (1954). A study of the effects of cyclic thermal stresses on a ductile metal. Transactions of the ASME, 76, 931–950.',
  'Ljung, L. (1999). System Identification: Theory for the User (2nd ed.). Prentice Hall. (Recursive least squares with forgetting factor.)',
  'Glaessgen, E., & Stargel, D. (2012). The digital twin paradigm for future NASA and U.S. Air Force vehicles. 53rd AIAA/ASME/ASCE/AHS/ASC Structures, Structural Dynamics and Materials Conference, AIAA 2012-1818.',
]

export default function MethodologyPage() {
  const { data, error, loading } = useApi(() => api.models(), [])
  return (
    <div className="space-y-4">
      <PageHeader title="Methodology" lede="Data flow, governing equations, model origins, required inputs, unit conventions, assumptions, numerical methods, validation procedure, data provenance and limitations. The full document is in METHODOLOGY.md and MODEL_ASSUMPTIONS.md in the repository." />
      <Callout kind="warning" title="Disclaimer">{DISCLAIMER}</Callout>

      <Card title="1 · Positioning and proposed contribution">
        <p className="text-[12.5px] text-ink-2 leading-relaxed">AeroSim is a physics-based aerospace engineering platform that maintains individual digital twins for aircraft components using their own historical sensor observations, physical inspection records, maintenance history and engineering specifications. It uses the component's calibrated condition and available upcoming-flight information to predict expected operational response and future degradation. After each completed flight it compares the original prediction with actual observations, corrects its operational model using reliable evidence, and updates component damage estimates when validated inspection measurements become available. The updated twin predicts the next flight, creating a continuous flight-by-flight learning and prognostics workflow. Digital twins, physics-based degradation modelling and prediction-versus-actual learning each have established precedents (e.g. Glaessgen & Stargel, 2012); the proposed technical contribution is the controlled two-stage update method — operational correction separated from inspection-confirmed damage correction, gated by evidence quality — which requires and receives comparative experimental validation (Validation page).</p>
      </Card>

      <Card title="2 · Primary data flow (chronological, leakage-free)">
        <ol className="list-decimal pl-5 text-[12.5px] text-ink-2 space-y-1 leading-relaxed">
          <li><b>Historical ingestion</b> per component instance: flight observations (keyed by flight ID; measured channels may be missing per installation), inspection records, maintenance records, engineering specification and a documented baseline condition with per-variable provenance.</li>
          <li><b>Twin initialisation</b>: the twin is reset to its baseline and its own history is replayed chronologically — for each completed flight a pre-flight prediction is made with only the information available before that flight, the actual observation is reconciled, the gated Stage-A update is applied and the as-flown state is committed; inspections apply Stage-B fusion; repairs and replacements reset the state. The result is the current estimated condition with a full audit trail.</li>
          <li><b>Upcoming-flight conditions</b>: Priority 1 scheduled information (duration, landings, planned payload → load factor through a documented relation, forecast temperature, expected environment); Priority 2 comparable completed flights of the same aircraft, same route (≥ 2) or all routes (≥ 3), using the median and standard deviation of the recorded actual conditions, restricted to flights earlier than the predicted flight; Priority 3 documented engineering defaults. Every field is tagged and estimated fields are listed as assumptions.</li>
          <li><b>Pre-flight prediction</b>: stored immutably with component, aircraft and flight IDs, timestamp, model version, input-data version (hash of the records available before the flight), parameters, conditions and provenance, predicted channels, predicted damage increments and state, remaining life, Monte Carlo uncertainty and threshold-crossing fraction. A prediction cannot be made for a flight that has already been completed, and never a second time for the same flight.</li>
          <li><b>Post-flight ingestion</b>: actual as-flown conditions and component observations are attached to the flight ID (synthetic reference aircraft in the demonstration; CSV upload in operation) with quality checks (units, plausible ranges, monotonic time, duplicates, flight status).</li>
          <li><b>Reconciliation</b>: the stored prediction is compared with the observation of the same component and flight; the forecast error (including schedule deviation) is reported separately from the response-model error obtained by re-running the same model version with the actual conditions; the latter alone feeds the Stage-A estimate. An explanation attributes the discrepancy.</li>
          <li><b>Updates</b>: Stage A (response parameters only), Stage B (damage state, inspection or maintenance evidence only), Stage C (evidence gate). Unattributable discrepancies inflate uncertainty and are flagged rather than corrected.</li>
          <li><b>History incorporation and next flight</b>: the as-flown model estimate advances the state; the next scheduled flight is predicted with the updated twin.</li>
        </ol>
      </Card>

      <Card title="3 · Operational response model" subtitle="Flight conditions → component loading and predicted sensor channels">
        <div className="text-[12.5px] text-ink-2 space-y-2 leading-relaxed">
          <p>Each flight is divided into phases (taxi, take-off, climb, cruise, manoeuvring, descent, landing) by configurable time fractions. For each component type a table gives the fraction of reference load, thermal severity, vibration and pressure in each phase. Component stress in a phase is <code className="num">σ = k_L · f_load · I · f_phase · σ_ref</code>, <code className="num">σ_ref = F_ref / A_eff</code> for structural components; <code className="num">σ_c = k_L · f_load · I · (N/N_ref)² · σ_c,ref</code> for the turbine blade; system pressure <code className="num">p = k_P · f_p · p_nom</code> for the actuator; temperature rise above ambient scaled by <code className="num">k_T</code>, vibratory stress by <code className="num">k_V</code>. The structural transfer from aircraft/engine parameters to lug stress is a documented surrogate, since engine-mount loads are not directly measured on board.</p>
          <p>Per flight the structural models receive stress-range bins: one ground–air–ground cycle, manoeuvre cycles, vibration HCF cycles and, for the gear, touchdown, taxi-bump, take-off unloading and retraction cycles. Load variation is represented by a 3-point distribution. Uploaded stress histories are rainflow-counted (ASTM E1049-85). Predicted channels (load kN, strain µε, temperature °C, pressure bar, vibration g) are generated at 30 s resolution; each also stores its baseline (channel with the calibratable factor removed), which is the Stage-A regressor. The calibratable factors k_L, k_T, k_V, k_P are the only quantities Stage A may change.</p>
        </div>
      </Card>

      {loading && !data && <Spinner />}
      <ErrorBox error={error} />
      {data?.models.map((m, idx) => (
        <Card key={m.model_type} title={`${4 + idx} · ${m.display_name}`} subtitle={`model_type = ${m.model_type} · mechanisms: ${m.mechanisms.join(', ')}`}>
          <div className="grid xl:grid-cols-2 gap-4 text-[12.5px]">
            <div>
              <div className="label mb-1">Governing equations</div>
              <ul className="space-y-1">{m.equations.map((e) => <li key={e.name} className="flex gap-3"><span className="text-ink-3 w-[140px] shrink-0">{e.name}</span><code className="num bg-paper px-1.5 rounded">{e.text}</code></li>)}</ul>
              <div className="label mt-3 mb-1">State variables</div><div className="num text-ink-2">{m.state_variables.join(' · ')}</div>
              <div className="label mt-3 mb-1">Flight conditions used</div><div className="num text-ink-2">{m.relevant_mission_inputs.join(' · ')}</div>
              <div className="label mt-3 mb-1">Required measurements and legitimate outputs</div><div className="text-ink-2">{MODEL_IO[m.model_type]}</div>
              <div className="label mt-3 mb-1">Uncertainty treatment (Monte Carlo)</div><div className="text-ink-2">{Object.entries(m.uncertain_parameters).map(([k, v]) => `${k}: ${v.dist}${v.cov ? ` CoV ${v.cov}` : ''}${v.sd_abs ? ` σ ${v.sd_abs}` : ''} [${v.class}]`).join('; ')}</div>
              <div className="mt-3 text-ink-2 leading-relaxed">{MODEL_NOTES[m.model_type]}</div>
            </div>
            <div>
              <div className="label mb-1">Default parameters (illustrative demonstration values)</div>
              <table className="table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Provenance</th></tr></thead><tbody>{m.parameters.map((p) => <tr key={p.name}><td className="num">{p.name}</td><td className="num">{fmt.num(p.value, 4)}</td><td className="text-ink-2">{p.unit}</td><td><Tag kind={p.provenance} /></td></tr>)}</tbody></table>
            </div>
          </div>
        </Card>
      ))}

      <Card title="8 · Two-stage controlled learning">
        <div className="text-[12.5px] text-ink-2 space-y-2 leading-relaxed">
          <p><b>Stage A — operational model update.</b> For each usable channel the observation is regressed on the as-flown baseline channel: y(t) = θ·x(t) + e(t). Scalar recursive least squares with forgetting factor λ (default 0.98) gives θ̂ and a standard-error proxy; channel estimates mapping to the same parameter are combined by reliability-weighted mean. Only k_L, k_T, k_V, k_P can change. The simplest validated estimator was chosen deliberately; a Kalman filter is unnecessary for a constant parameter with a linear measurement model.</p>
          <p><b>Stage B — damage-state update.</b> Only an inspection measurement of a damage variable (or a maintenance repair/replacement) may change the state, by inverse-variance fusion x_post = (x_m/σ_m² + x_i/σ_i²)/(1/σ_m² + 1/σ_i²); σ_m grows with flights since the last accepted damage update. A crack found where the model carried none initialises the state at the measurement. When growth since the last update is identifiable (&gt; 3σ of the combined uncertainties), the mechanism rate coefficient (Paris C, k_w, r₀, creep A) is rescaled by √(observed/predicted growth), bounded ×0.5…×2 per update.</p>
          <p><b>Stage C — evidence gate.</b> Missing fraction, MAD-robust outlier fraction, noise/SNR, implausible change magnitude (&gt; 40 % per update), qualitative methods, over-large measurement uncertainty and physically contradictory measurements map to accept / accept with reduced confidence / request more evidence / reject. Every decision is recorded with reasons; an unattributable discrepancy inflates uncertainty and is flagged for engineering investigation.</p>
          <p><b>Hidden reference model.</b> A separate parameter set per component instance (response factors, degradation coefficients, true state, sensor noise and bias, seed) generates the synthetic history and observations with deterministic seeds. The twin never reads it. All generated records are labelled <i>SYNTHETIC ACTUAL-FLIGHT OBSERVATION — SIMULATED GROUND TRUTH</i>.</p>
        </div>
      </Card>

      <Card title="9 · Uncertainty, remaining life, validation, provenance and limitations">
        <div className="text-[12.5px] text-ink-2 space-y-2 leading-relaxed">
          <p>Monte Carlo sampling (seeded) draws material coefficients (log-normal), initial damage state (normal), response factors (normal) and model-form parameters, runs the flight per sample and reports P5/P50/P95 sample percentiles, the threshold-crossing fraction and Spearman sensitivities. <b>Intervals are not calibrated</b>; the UI says so. Remaining life is obtained by repeating a reference mission from the current state to the model threshold and reported in flights of that mission, never calendar time.</p>
          <p>Validation: 105 automated tests (physics, what-if simulation, twin lifecycle, reconciliation, uncertainty, API) run from the Validation page; the chronological A/B/C/C-sparse experiment replays the component's own flights under each variant in an isolated copy of its records, with predictions for flight N using only information available before flight N, and measures load forecast error, response error, damage-state error and remaining-life error against the hidden reference. Improvement is reported only where measured.</p>
          <p>Provenance: records are synthetic_demo, uploaded or manual; parameters are input, assumption, measured, catalogue, simulation or calibrated; flight conditions are scheduled, derived, historical comparable or engineering estimate. No real telemetry, fleet statistics or certified allowables are used.</p>
          <p>Limitations: constant geometry factor; no mean-stress correction; linear Miner summation without load interaction; secondary creep only; constraint-based thermal strain; empirical seal-wear surrogate; phase-table response model instead of a validated loads model; uncalibrated uncertainty; synthetic data only. Operational use would require qualified material data, flight-test-derived response models, calibrated sensor models and independent verification of the updating logic.</p>
        </div>
      </Card>

      <Card title="10 · References"><ol className="list-decimal pl-5 text-[12.5px] text-ink-2 space-y-1">{REFERENCES.map((r) => <li key={r}>{r}</li>)}</ol></Card>
    </div>
  )
}

const MODEL_IO: Record<string, string> = {
  engine_mount: 'Requires: flight conditions (duration, load factor, manoeuvre, vibration, temperature), lug geometry and material coefficients, a measured initial crack for Paris growth. Reconciles: load, strain, temperature, vibration channels. Outputs: stress spectrum and channels (operational), Miner damage and crack length (physical damage), remaining flights and threshold-crossing fraction (risk). An engine-zone temperature reading cannot establish crack length.',
  landing_gear: 'Requires: landings, duration, load factor, environment; fillet geometry; corrosion survey for pit depth; a measured crack for Paris growth. Reconciles: load, strain, temperature, vibration. Outputs: Miner damage, pit depth, crack length (if detected), remaining flights.',
  turbine_blade: 'Requires: duration, inlet temperature, operating intensity, manoeuvre transients; root stress and metal-temperature references. Reconciles: temperature, load (centrifugal), gas-path pressure, vibration. Outputs: creep strain, thermal-fatigue damage, oxide thickness, remaining flights / hot hours.',
  hydraulic_actuator: 'Requires: duration, pressure factor, temperature, manoeuvre intensity (actuation count); seal-wear coefficients; bench leakage tests. Reconciles: pressure, temperature, load, vibration. Outputs: wear indicator, leakage, pressure-performance deviation, remaining cycles.',
}

const MODEL_NOTES: Record<string, string> = {
  engine_mount: 'S-N parameters describe the notched net section (K_t included). The endurance limit suppresses S-N damage from vibratory cycles, but once a crack exists those cycles can exceed ΔK_th and dominate crack growth. Paris’ law is applied only between ΔK_th and K_IC; the sequence stops at the critical crack size. Corrosion is a disabled optional extension.',
  landing_gear: 'Touchdown load cycles dominate fatigue; corrosion pit growth is a linear-in-exposure surrogate with environment factor and 6 h assumed ground exposure per landing. Crack growth is applied only if a crack has been detected. Mechanical wear is catalogued, not modelled.',
  turbine_blade: 'Norton secondary creep integrated per phase; thermal fatigue via a constraint-factor thermal strain range and a Coffin–Manson relation; oxidation by parabolic kinetics. The reduced-order model does not replace a thermomechanical blade assessment.',
  hydraulic_actuator: 'An empirical seal-wear surrogate accumulates a dimensionless wear indicator from pressure cycles with pressure and temperature sensitivities and wear acceleration; leakage is linear in wear. Seal replacement resets the state through a maintenance record. This surrogate is not a universal physical law.',
}
