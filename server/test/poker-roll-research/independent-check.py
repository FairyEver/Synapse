"""Independent NumPy check of the FIXED holdout; does not select models or alter gates."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

out = Path(sys.argv[1])
size = json.loads((out / "inference-design.json").read_text())["fixedPerGroup"]
groups = {}
for record in json.loads((out / "final-index.json").read_text()).values():
    with gzip.open(out / record["file"], "rt") as stream:
        for line in stream:
            row = json.loads(line)
            if int(row["id"].rsplit(":", 1)[1]) < size:
                groups.setdefault(row["group"], []).append(row)
assert len(groups) == 54 and all(len(g) == size for g in groups.values())

seed, repetitions = 2026110191, 1000
rng = np.random.default_rng(seed)
sums = {name: np.zeros(repetitions) for name in ["all", "chosen", "normal", "super"]}
counts = {name: np.zeros(repetitions) for name in sums}
values = {name: [] for name in sums}
for key in sorted(groups):
    rows = groups[key]
    net = np.array([r["voluntary"] for r in rows])
    masks = {"all": np.ones(len(rows), dtype=bool), "chosen": np.array([r["chosen"] for r in rows]), "normal": np.array([r["chosenKind"] == "normal" for r in rows]), "super": np.array([r["chosenKind"] == "super" for r in rows])}
    indices = rng.integers(0, len(rows), size=(repetitions, len(rows)))
    for name, mask in masks.items():
        sums[name] += (net * mask)[indices].sum(axis=1)
        counts[name] += mask[indices].sum(axis=1)
        values[name].extend(net[mask].tolist())

result = {"method": "Independent NumPy whole-hand bootstrap, fixed group sizes; no adaptive additions", "numpy": np.__version__, "generator": "PCG64", "seed": seed, "repetitions": repetitions, "fixedPerGroup": size, "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "statistics": {}}
for name, xs in values.items():
    a = np.array(xs)
    estimates = sums[name] / counts[name]
    lower, upper = np.quantile(estimates, [.025, .975])
    result["statistics"][name] = {"n": len(xs), "mean": float(a.mean()), "normalHalfWidth": float(1.96*a.std(ddof=1)/len(xs)**.5), "bootstrapLower": float(lower), "bootstrapUpper": float(upper)}
(out / "independent-stats.json").write_text(json.dumps(result, indent=2)+"\n")
print(json.dumps(result))
