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

The Validation page reports a within-specimen rolling-origin, one-step-ahead baseline comparison, followed by a leave-one-specimen-out Paris-law method check. For each fold, Paris C and m are fitted using only five training specimens; the held-out training specimen is forecast sequentially from its previous optical crack measurement using AeroSim's integrate_paris. The panel reports crack-length MAE/RMSE overall and by held-out specimen.

The Paris check uses explicit assumptions (Y=1.12, stress ratio R=0, delta-K threshold=0 and a high numerical K_IC guard because a transferable specimen toughness is not supplied to this workflow). Zero-crack initiation intervals are excluded because Paris' region-II law models propagation, not crack initiation. The loading profile is repeated to represent each measured cycle interval. This is not a remaining-life-to-failure validation or a validated material-parameter transfer.

The loader also scans the PHM sensor CSV/TXT files for the documented `time,ch1,ch2` format and computes basic actuation/received-signal summaries. Signal-feature correlations are descriptive only; no signal-to-crack machine-learning model is claimed.

This laboratory coupon dataset is not aircraft flight telemetry and is not used as a scheduled flight, sensor observation, or aircraft component record. It supports independent crack-growth-method benchmarking only. Even a good held-out error validates the crack-growth integration method on the aluminium lap-joint coupons; it does not validate AeroSim's titanium-class engine-mount material coefficients, geometry, effective section, load path, local stress concentration, S-N curve, aircraft operational response or RUL.

## References

- NASA dataset: https://data.nasa.gov/dataset/fatigue-crack-growth-in-aluminum-lap-joint
- PHM 2019 challenge and data structure: https://data.phmsociety.org/2019datachallenge/
- PHM Society NASA repository mirror: https://data.phmsociety.org/nasa/
- Peng et al., “Probabilistic fatigue damage prognosis of lap joint using Bayesian updating,” Journal of Intelligent Material Systems and Structures, 2015, 26(8), 965–979.
- He et al., “A multi-feature integration method for fatigue crack detection and crack length estimation in riveted lap joints using Lamb waves,” Smart Materials and Structures, 2013, 22(10), 105007.
