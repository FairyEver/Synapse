#!/usr/bin/env python3
"""Explicit synthetic writes to the pilot table; requires --run."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    if not args.run:
        parser.error("Explicit --run is required: writes synthetic cloud records")
    spec = importlib.util.spec_from_file_location("launcher", HERE / "launcher.py")
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    root = Path.cwd()
    work = root / "work/codex-team-hook-pilot"
    work.mkdir(parents=True, exist_ok=True)
    config = dict(version=1, enabled=True, member_name="Hook链路试验成员", project_roots=[str(root)])
    results = []
    for label, text in [("v2", "SY_HOOK_PILOT_V2_20261113"),
                        ("filter", "SY_HOOK_FILTER_ME_20261113_should_not_be_stored"),
                        ("long", ('中文🧪\\"\n' * 14000))]:
        payload = dict(cwd=str(root), hook_event_name="UserPromptSubmit", prompt=text,
                       session_id="pilot-" + label + "-session", turn_id="pilot-" + label + "-turn")
        status = launcher.process(payload, config, launcher.SCRIPT_URL)
        results.append(dict(case=label, status=status))
        if label == "long":
            import hashlib
            results[-1].update(content_bytes=len(text.encode()), content_sha256=hashlib.sha256(text.encode()).hexdigest())
            (work / "long-expected.txt").write_text(text, encoding="utf-8")
    outside = dict(cwd=str(root.parent), hook_event_name="UserPromptSubmit", prompt="SY_OUTSIDE_MUST_NOT_UPLOAD",
                   session_id="pilot-outside-session", turn_id="pilot-outside-turn")
    results.append(dict(case="outside", status=launcher.process(outside, config, launcher.SCRIPT_URL)))
    missing = dict(outside, cwd=str(root), prompt="SY_MISSING_DOWNLOAD")
    results.append(dict(case="missing_download", status=launcher.process(missing, config,
                   "https://synapse.d2.pub/files/asset_nonexistent_codex_hook_pilot")))
    api = "https://synapse.d2.pub/api/open/v1/tables/cmweb87wj0s3yn32y9jn6mw46"
    row = "ctr_44e78534569c4b0fbaaf78b252bcd949"
    for name, method, path, body in [
        ("anonymous_read", "GET", "/records/" + row, None),
        ("anonymous_query", "POST", "/records/query", {"limit": 1}),
        ("anonymous_update", "PATCH", "/records/" + row, {"version": 1, "values": {"content": "SY_FORBIDDEN_PROBE"}}),
        ("anonymous_delete", "DELETE", "/records/" + row, {"version": 1}),
        ("anonymous_count", "GET", "/public-count", None),
    ]:
        request = Request(api + path, method=method,
                          data=None if body is None else json.dumps(body).encode(),
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=5) as response:
                status = response.status
        except HTTPError as error:
            status = error.code
        results.append(dict(case=name, http_status=status))
    (work / "cloud-checks.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
