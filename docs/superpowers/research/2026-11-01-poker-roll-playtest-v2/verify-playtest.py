"""Read-only provenance, independent integer-price and summary checks; save a new audit."""
import gzip
import hashlib
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
SOURCE = ROOT / "server/test/poker-roll-research"
OLD = OUT.parent / "2026-11-01-poker-roll"
FIRST = OUT.parent / "2026-11-01-poker-roll-playtest"
read = lambda p: json.loads(p.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
manifest = read(OUT / "manifest.json")
rows = []
index = read(OUT / "index.json")
for record in index.values():
    raw = (OUT / record["file"]).read_bytes()
    assert sha(raw) == record["sha256"]
    part = [json.loads(line) for line in gzip.decompress(raw).splitlines()]
    assert len(part) == record["rows"] == manifest["samplesPerCell"]
    rows.extend(part)
for name, digest in manifest["sourceSha256"].items():
    assert sha((SOURCE / name).read_bytes()) == digest, name
assert sha((OUT / "runner-source.cjs.txt").read_bytes()) == manifest["sourceSha256"]["playtest.cjs"]
assert sha((OUT / "model.json").read_bytes()) == manifest["modelSha256"]
assert sha((OLD / "fitted.json").read_bytes()) == manifest["policyFitSha256"]
assert sha((FIRST / "runner-source.cjs.txt").read_bytes()) == read(FIRST / "manifest.json")["sourceSha256"]["playtest.cjs"]
keys = {(r["variant"], r["players"] + r["folded"], r["seed"]) for r in rows}
assert len(keys) == len(rows)
fee_mismatches = []
for r in rows:
    i = int(r["id"].rsplit(":", 1)[1])
    bb = [2, 4, 10, 20][i // 24 % 4]
    t = round(bb * (10 * r["x"][1] + r["x"][2]))
    normal, super_roll = {"preflop": (1, 3), "flop": (2, 5), "turn": (4, 8)}[r["street"]]
    a = max(2000, normal * t)
    b = max(a + 2000, super_roll * t)
    k = r["count"] + 1
    expected = [(a * k + 1999) // 2000, (b * k + 1999) // 2000]
    actual = [round(r["normalFee"] * bb), round(r["superFee"] * bb)]
    if expected != actual:
        fee_mismatches.append({"id": r["id"], "expected": expected, "actual": actual})
assert not fee_mismatches, fee_mismatches[:3]
matches = []
scanned = 0
for base in [OLD, FIRST]:
    for file in base.glob("**/*.jsonl.gz"):
        for line in gzip.decompress(file.read_bytes()).splitlines():
            r = json.loads(line)
            scanned += 1
            if "seed" not in r:
                continue
            g = r.get("group", "").split(":")
            variant = r.get("variant", g[0] if len(g) > 1 else None)
            players = r.get("players", int(g[1]) if len(g) > 1 and g[1].isdigit() else None)
            if players is None:
                continue
            key = (variant, players + r.get("folded", 0), r["seed"])
            if key in keys:
                matches.append({"file": str(file.relative_to(ROOT)), "id": r.get("id"), "handKey": key})
summary = read(OUT / "summary.json")
chosen = [r for r in rows if r["chosen"]]
assert len(rows) == summary["rows"] == 54 * manifest["samplesPerCell"]
assert abs(statistics.mean(r["voluntary"] for r in chosen) - summary["chosenNet"]["mean"]) < 1e-9
result = {"rawFiles": len(index), "rows": len(rows), "rawAndSourceHashes": "pass", "modelAndPolicyHashes": "pass", "independentIntegerQuoteMismatches": len(fee_mismatches), "independentChosenMean": "pass", "duplicateUnderlyingHandsInNewBatch": 0, "priorRowsScanned": scanned, "priorUnderlyingHandMatches": matches, "warning": "Prior 32-bit seed reuse is preserved and disclosed. This is a descriptive playtest check, not a fully isolated certification holdout.", "verifierSha256": sha(Path(__file__).read_bytes())}
with (OUT / "verification.json").open("x") as f:
    json.dump(result, f, indent=2)
    f.write("\n")
print(json.dumps(result))
