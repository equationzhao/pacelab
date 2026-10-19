"""Reproduce the authors' onset model for comparison, not physiological truth."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import openpyxl
from scipy.optimize import curve_fit

HERE = Path(__file__).resolve().parent
curves = json.loads((HERE / "inputs.json").read_text())
results = {r["id"]: r for r in json.loads((HERE / "results.json").read_text())["results"]}
sheet = openpyxl.load_workbook(HERE / "sources/nolte-reference-fits.xlsx", data_only=True).active
published = {row[0]: float(row[4]) for row in list(sheet.values)[1:] if row[0]}

def onset_model(x, a, b, c):
    # Equation and bounds reproduced from the public author script, which is
    # retained as a source file but never imported or executed.
    return np.where(x < b, a, a * np.exp((x - b) / c))

references = []
for curve in curves:
    if curve["source"] != "Nolte2022":
        continue
    data = curve["rest"] + curve["points"]
    x = np.array([p["power"] for p in data])
    y = np.array([p["lactate"] for p in data])
    parameters, covariance = curve_fit(onset_model, x, y, bounds=(0, [2., 250., 100.]))
    sse = float(np.sum((y - onset_model(x, *parameters)) ** 2))
    references.append(dict(id=curve["id"],baseline=float(parameters[0]),
                           onsetP1W=float(parameters[1]),growthScaleP2W=float(parameters[2]),
                           sse=sse,publishedSse=published[curve["subject"]],
                           sseDifference=sse-published[curve["subject"]],
                           publishedSseMatched=abs(sse-published[curve["subject"]]) < 1e-6,
                           caution="P1 is model onset, not independent LT1 truth; P2 is NOT LT2."))
(HERE / "author-model-reference.json").write_text(json.dumps(references, indent=2) + "\n")
reference = {r["id"]: r for r in references}

plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, axes = plt.subplots(2, 3, figsize=(12, 7.5), constrained_layout=True)
selected = ["P01", "P05", "P07", "P08", "P13", "P17"]
for subject, ax in zip(selected, axes.flat):
    curve = next(c for c in curves if c["id"] == "N2022-" + subject)
    points = curve["points"]
    ax.plot([p["power"] for p in points], [p["lactate"] for p in points], "o-",
            color="#142e48", lw=1.2, ms=4, label="Measured exercise stages")
    rest = curve["rest"][0]
    ax.scatter([rest["power"]], [rest["lactate"]], marker="s", facecolors="none",
               edgecolors="#758293", label="Rest (reference fit only)")
    ref = reference[curve["id"]]
    dense = np.linspace(0, points[-1]["power"], 300)
    ax.plot(dense, onset_model(dense, ref["baseline"], ref["onsetP1W"], ref["growthScaleP2W"]),
            color="#14877d", alpha=.8, label="Author onset model")
    ax.axvline(ref["onsetP1W"], ls="--", color="#14877d", lw=1)
    ax.set_title(f"{subject}: {len(points)} exercise readings\nPaceLab LT1 / LT2: no output")
    ax.text(.04, .91, f"Model onset P1: {ref['onsetP1W']:.1f} W", transform=ax.transAxes, color="#087467")
    ax.set(xlabel="Power (W)", ylabel="Lactate (mmol/L)", ylim=(0, 15))
    ax.grid(alpha=.15)
handles, labels = axes.flat[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="outside lower center", ncols=3, frameon=False)
fig.suptitle("Real cycling tests: PaceLab rejects all six curves\nOnset-model P1 is an alternative estimate, not independently labelled LT1; P2 is not LT2.", fontsize=13)
fig.savefig(HERE / "nolte-six-curves.png", dpi=180)
plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(10, 4.5), constrained_layout=True)
for curve_id, ax in zip(["P2016-IP-IMA-1", "P2016-IL-IMA-1"], axes):
    curve = next(c for c in curves if c["id"] == curve_id)
    p = curve["points"]
    r = results[curve_id]["exerciseOnly"]
    ax.plot([x["power"] for x in p], [x["lactate"] for x in p], "o", color="#142e48", label="Measured exercise stages")
    ax.plot([x["x"] for x in r["fit"]], [x["y"] for x in r["fit"]], color="#b15d1b", label="PaceLab fit")
    ax.axvline(r["lt1"]["power"], color="#b15d1b", ls="--")
    ax.set_title(f"{curve_id}\nPaceLab LT1: {r['lt1']['power']} W; LT2: no output")
    ax.set(xlabel="Power (W)", ylabel="Lactate (mmol/L)", ylim=(0, 11))
    ax.grid(alpha=.15)
fig.legend(*axes[0].get_legend_handles_labels(), loc="outside lower center", ncols=2, frameon=False)
fig.suptitle("The only two exercise-only outputs among 52 real curves\nNo paired independent LT1/LT2 labels are provided for these tests.", fontsize=12)
fig.savefig(HERE / "pallares-two-outputs.png", dpi=180)
plt.close(fig)

print("Maximum absolute difference from authors' published SSE:", max(abs(r["sseDifference"]) for r in references))
print("Published SSE matches within 1e-6:", sum(r["publishedSseMatched"] for r in references), "/", len(references))
for r in references:
    if r["id"].split("-")[-1] in selected:
        print(r["id"], "model P1", round(r["onsetP1W"], 2), "W", "SSE diff", f"{r['sseDifference']:.2g}")
