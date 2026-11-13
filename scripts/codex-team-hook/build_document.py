#!/usr/bin/env python3
"""Build the public operations document from the release resource manifest."""
import hashlib
import ast
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOC = HERE.parents[1] / "docs/agent-guides/codex-team-hook.md"


def main():
    release = json.loads((HERE / "release.json").read_text(encoding="utf-8"))
    for name in ["launcher", "collector"]:
        resource = release["resources"][name]
        if hashlib.sha256((HERE / (name + ".py")).read_bytes()).hexdigest() != resource["sha256"]:
            raise ValueError("Source/manifest hash mismatch: " + name)
        constant = "LAUNCHER_VERSION" if name == "launcher" else "COLLECTOR_VERSION"
        tree = ast.parse((HERE / (name + ".py")).read_text(encoding="utf-8"))
        source_version = next((ast.literal_eval(node.value) for node in tree.body
                               if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == constant for t in node.targets)), None)
        if source_version != release.get(name + "_version", release["version"]):
            raise ValueError("Source/manifest version mismatch: " + name)
    values = {"VERSION": release["version"],
              "LAUNCHER_VERSION": release.get("launcher_version", release["version"]),
              "COLLECTOR_VERSION": release.get("collector_version", release["version"]),
              "STATUS": "正式可用" if release["status"] == "stable" else "验收中",
              "LAUNCHER_URL": release["resources"]["launcher"]["url"],
              "LAUNCHER_SHA256": release["resources"]["launcher"]["sha256"],
              "COLLECTOR_URL": release["resources"]["collector"]["url"]}
    text = (HERE / "operations.template.md").read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text or "PENDING_" in text:
        raise ValueError("Unresolved release parameters")
    # Compatibility with current Sy's strict decoding of its 4096-byte probe.
    for padding in range(4):
        output = "<!-- UTF-8 public asset boundary" + " " * padding + " -->\n" + text
        try:
            output.encode("utf-8")[:4096].decode("utf-8")
        except UnicodeDecodeError:
            continue
        DOC.write_text(output, encoding="utf-8")
        print(str(DOC))
        return
    raise ValueError("No valid public asset boundary")


if __name__ == "__main__":
    main()
