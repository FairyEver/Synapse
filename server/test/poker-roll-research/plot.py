"""Optional static diagnostics; reads results without changing model or data."""
import json
import pathlib
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


out = pathlib.Path(sys.argv[1])
read = lambda name: json.loads((out / name).read_text())
selection = read("selection.json")
model = read("recommended-model.json")
fig, axes = plt.subplots(1, 2, figsize=(11, 4), constrained_layout=True)
for candidate in selection["refined"]:
    axes[0].errorbar(
        candidate["meanCompensation"], candidate["allOpportunitiesNet"]["mean"],
        yerr=candidate["allOpportunitiesNet"]["halfWidth"], fmt="o", capsize=3,
        label=f'{candidate["model"]["curve"]}, g={candidate["model"]["growth"]}, s={candidate["model"]["scale"]}',
    )
axes[0].set(xlabel="Current-action compensation (BB)", ylabel="Retained incremental value (BB)", title="Independent candidate refinement (95% intervals)")
axes[0].legend(fontsize=7)
for curve in ["linear", "quadratic", "geometric"]:
    counts = list(range(8))
    growth = model["growth"]
    values = [1 + growth*k if curve == "linear" else 1 + growth*k*k if curve == "quadratic" else (1+growth)**k for k in counts]
    axes[1].plot(counts, values, marker="o", label=curve + (" (selected)" if curve == model["curve"] else ""))
axes[1].set(xlabel="Previous personal Rolls in this hand", ylabel="Fee multiplier (same base)", title=f'Curve comparison at g={model["growth"]}')
axes[1].legend()
for ax in axes:
    ax.grid(alpha=.2)
fig.savefig(out / "pricing-diagnostics.png", dpi=160)
plt.close(fig)

audit = read("break-even-summary.json")
fig, axes = plt.subplots(2, 3, figsize=(12, 6), constrained_layout=True)
for row, variant in enumerate(["standard52", "short32"]):
    for col, street in enumerate(["preflop", "flop", "turn"]):
        ax = axes[row, col]
        group = audit["groups"][f"{variant}:6:{street}"]
        for kind in ["normal", "super"]:
            curve = group[kind]["curve"]
            ax.errorbar([p["fraction"]*100 for p in curve], [p["net"]["mean"] for p in curve], yerr=[p["net"]["halfWidth"] for p in curve], marker="o", capsize=2, label=kind)
        ax.axhline(0, color="black", linewidth=.7)
        ax.set(title=f"{variant}, 6 players, {street}", xlabel="Current balance paid (%)", ylabel="Forced incremental net (BB)")
        ax.grid(alpha=.2)
axes[0, 0].legend()
fig.suptitle("Independent current-fee audit: future pricing rules held fixed; multiplicity-adjusted intervals", fontsize=11)
fig.savefig(out / "fee-audit.png", dpi=160)
plt.close(fig)
(out / "plot-metadata.json").write_text(json.dumps({"python": sys.version, "matplotlib": matplotlib.__version__, "scope": "Presentation only; no fitting or model changes"}, indent=2)+"\n")
