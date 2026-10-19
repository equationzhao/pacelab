"""Independent NumPy/SciPy numerical check, not physiological ground truth."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.optimize import minimize, minimize_scalar

HERE = Path(__file__).resolve().parent
inputs = json.loads((HERE / "../public-data-2026-10-19/inputs.json").read_text())
data = json.loads((HERE / "results.json").read_text())
results = {r["id"]: r for r in data["results"]}
references = []
for curve in inputs:
    current = results[curve["id"]]
    if not current["rawJoint"]:
        continue
    powers = np.array([p["power"] for p in curve["points"]])
    y = np.array([p["lactate"] for p in curve["points"]])
    offset, span = powers[0], powers[-1] - powers[0]
    x = (powers - offset) / span

    def cost(knots):
        design = np.column_stack([np.ones(len(x)), x, np.maximum(0, x-knots[0]), np.maximum(0, x-knots[1])])
        coefficients = np.linalg.lstsq(design, y, rcond=None)[0]
        return float(np.sum((y-design @ coefficients)**2))

    # Exhaust the same legal grid with a different language and SVD-based solver.
    grid = [x[i] + (x[i+1]-x[i])*q/4 for i in range(len(x)-1) for q in range(4)]
    best, positions = float("inf"), None
    for a in grid:
        for b in grid:
            if b <= a or sum(x <= a+1e-9) < 2 or sum((x > a+1e-9) & (x <= b+1e-9)) < 2 or sum(x > b+1e-9) < 2:
                continue
            sse = cost([a, b])
            if sse < best - 1e-12:
                best, positions = sse, [a, b]
    assert abs(best-current["rawJoint"]["sse"]) < 1e-8, curve["id"]
    grid_powers = [float(offset+k*span) for k in positions]
    row = dict(id=curve["id"], pythonGridPowers=grid_powers, pythonGridSse=best,
               javascriptGridPowers=current["rawJoint"]["powers"], javascriptGridSse=current["rawJoint"]["sse"],
               emittedLt2=bool(current["current"]["lt2"]))
    # Independently optimize every legal partition, starting at its four corners
    # and centre. No application knot is supplied as an optimizer seed.
    if row["emittedLt2"]:
        emitted = current["current"]
        continuous, continuous_positions = float("inf"), None
        if emitted["lt2Model"] == "upper-region-linear":
            lower = emitted["lt2Region"][0]
            mask = powers >= lower-1e-7
            rx, ry = x[mask], y[mask]
            def upper_cost(k):
                design = np.column_stack([np.ones(len(rx)), rx, np.maximum(0, rx-k)])
                coefficients = np.linalg.lstsq(design, ry, rcond=None)[0]
                return float(np.sum((ry-design @ coefficients)**2))
            grid_best, grid_knot = float("inf"), None
            for i in range(len(rx)-1):
                for q in range(4):
                    k = rx[i]+(rx[i+1]-rx[i])*q/4
                    if sum(rx <= k+1e-9) < 2 or sum(rx > k+1e-9) < 2:
                        continue
                    value = upper_cost(k)
                    if value < grid_best-1e-12:
                        grid_best, grid_knot = value, k
            row["lt2Model"] = "upper-region-linear"
            row["pythonLt2GridPower"] = float(offset+grid_knot*span)
            assert abs(row["pythonLt2GridPower"]-emitted["lt2"]["power"]) <= .051
            for left in range(2, len(rx)-1):
                bounds = (rx[left-1], rx[left]-1e-10)
                fit = minimize_scalar(upper_cost, bounds=bounds, method="bounded", options={"xatol":1e-12})
                for k in [bounds[0], bounds[1], fit.x]:
                    value = upper_cost(k)
                    if value < continuous:
                        continuous, continuous_positions = value, [k]
            assert continuous <= grid_best+1e-7
        else:
            n = len(x)
            for left in range(2, n-3):
                for right in range(left+2, n-1):
                    bounds = [(x[left-1], x[left]-1e-10), (x[right-1], x[right]-1e-10)]
                    starts = [((bounds[0][0]+bounds[0][1])/2, (bounds[1][0]+bounds[1][1])/2)]
                    starts += [(a,b) for a in bounds[0] for b in bounds[1]]
                    for initial in starts:
                        fit = minimize(cost, initial, method="L-BFGS-B", bounds=bounds,
                                       options={"ftol":1e-13,"gtol":1e-9,"maxiter":150})
                        if fit.fun < continuous:
                            continuous, continuous_positions = float(fit.fun), fit.x
            assert continuous <= best+1e-7
            row["lt2Model"] = "three-phase-linear"
            row["pythonLt2GridPower"] = grid_powers[1]
            assert abs(row["pythonLt2GridPower"]-emitted["lt2"]["power"]) <= .051
        continuous_powers = [float(offset+k*span) for k in continuous_positions]
        row.update(continuousPowers=continuous_powers, continuousSse=float(continuous),
                   lt2GridDifferenceW=abs(emitted["lt2"]["power"]-continuous_powers[-1]))
    references.append(row)
differences = [r["lt2GridDifferenceW"] for r in references if r["emittedLt2"]]
summary = dict(gridChecks=len(references), maximumGridSseDifference=max(abs(r["pythonGridSse"]-r["javascriptGridSse"]) for r in references),
               emittedLt2Checks=len(differences), medianLt2GridDifferenceW=float(np.median(differences)), maximumLt2GridDifferenceW=max(differences),
               caution="Agreement with an independent numerical implementation of the same model is not physiological accuracy.")
(HERE / "independent-reference.json").write_text(json.dumps(dict(engineSha256=data["engineSha256"],summary=summary,results=references), indent=2)+"\n")

fig, axes = plt.subplots(2, 3, figsize=(12, 7), constrained_layout=True)
plt.rcParams.update({"font.size": 10})
for subject, ax in zip(["P01", "P05", "P07", "P08", "P13", "P17"], axes.flat):
    curve = next(c for c in inputs if c["id"] == "N2022-"+subject)
    r = results[curve["id"]]["current"]
    ax.plot([p["power"] for p in curve["points"]], [p["lactate"] for p in curve["points"]], "o", color="#142e48", ms=4, label="Measured stages")
    if r["fit"]:
        ax.plot([p["x"] for p in r["fit"]], [p["y"] for p in r["fit"]], color="#bb7a39", lw=1.3, label="Concentration fit")
    if r.get("lt2Fit"):
        ax.plot([p["x"] for p in r["lt2Fit"]], [p["y"] for p in r["lt2Fit"]], color="#4479ac", lw=1.4, label="LT2 regional fit")
    labels = []
    for key, color in [("lt1", "#178a72"), ("lt2", "#4479ac")]:
        result = r[key]
        if result:
            ax.axvspan(*result["between"], color=color, alpha=.08)
            ax.axvline(result["power"], color=color, ls="--", lw=1)
            labels.append(f"{key.upper()}: {result['power']:.1f} W")
        else:
            labels.append(f"{key.upper()}: unconfirmed")
    ax.set_title(subject+"\n"+"; ".join(labels), fontsize=10)
    ax.set(xlabel="Power (W)", ylabel="Lactate (mmol/L)", ylim=(0, 15))
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(alpha=.15)
fig.suptitle("Independent LT1 / LT2 support on the six published examples\nLT2 is an operational three-phase estimate; shading shows sampled location ranges, not confidence intervals.", fontsize=12)
fig.savefig(HERE / "six-curves.png", dpi=180)
print(json.dumps(summary, indent=2))
