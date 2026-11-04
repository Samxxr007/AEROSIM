# PHM 2019 aluminum lap-joint benchmark

AeroSim can load the PHM 2019 Fatigue Crack Growth in Aluminum Lap Joint experiment as an **external validation benchmark**.

## Obtain and place the dataset

Download the original PHMDC2019_Data.zip archive from the [PHM Society NASA repository mirror](https://data.phmsociety.org/nasa/) (the PHM 2019 entry links to the archive), then extract the folders under:

```
data/external/phm2019/raw/
```

NASA's dataset record is [here](https://data.nasa.gov/dataset/fatigue-crack-growth-in-aluminum-lap-joint). NASA's PCoE repository currently notes that its direct download is being restored; the PHM Society mirror lists the archive download. Keep the original archive and workbook files locally; raw dataset files are intentionally excluded from Git.

## Ground-truth rules

The challenge documentation defines T1-T6 as training specimens with optical crack-length measurements and T7-T8 as validation specimens without released crack-length ground truth. AeroSim therefore scores only T1-T6. Do not create labels for T7/T8 or infer them from the signal data.

The backend first looks for `Description_T1.xlsx` through `Description_T6.xlsx` in the extracted tree and tries to read the cycle/crack-length table. If the workbook layout is not detected, create `data/external/phm2019/labels.csv` using `labels.template.csv` as the column reference:

- `specimen`: T1 through T6
- `cycle`: fatigue test cycle count
- `crack_length_mm`: optical crack length in millimetres

## What AeroSim evaluates

The Validation page reports a within-specimen rolling-origin, one-step-ahead test. Each test prediction uses only earlier labels from the same specimen. It compares last-value carry-forward with a linear trend clipped to non-decreasing crack length and reports MAE/RMSE. This is an empirical baseline comparison, **not** a Paris-law calibration or RUL-to-failure validation.

The loader also scans the PHM sensor CSV/TXT files for the documented `time,ch1,ch2` format and computes basic actuation/received-signal summaries. Signal-feature correlations are descriptive only; no signal-to-crack machine-learning model is claimed.

This laboratory coupon dataset is not aircraft flight telemetry and is not used as a scheduled flight, sensor observation, or aircraft component record. It supports independent crack-growth/inspection-evidence benchmarking only.

## References

- NASA dataset: https://data.nasa.gov/dataset/fatigue-crack-growth-in-aluminum-lap-joint
- PHM 2019 challenge and data structure: https://data.phmsociety.org/2019datachallenge/
- PHM Society NASA repository mirror: https://data.phmsociety.org/nasa/
- Peng et al., “Probabilistic fatigue damage prognosis of lap joint using Bayesian updating,” Journal of Intelligent Material Systems and Structures, 2015, 26(8), 965–979.
- He et al., “A multi-feature integration method for fatigue crack detection and crack length estimation in riveted lap joints using Lamb waves,” Smart Materials and Structures, 2013, 22(10), 105007.
