#!/usr/bin/env python3
"""Real Codex process-scoped hook probe, using only synthetic messages."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--mode", choices=("sync", "async", "download-failure"), default="sync")
    args = parser.parse_args()
    if not args.run:
        parser.error("Explicit --run is required: real model call and synthetic cloud writes")
    root = Path.cwd()
    work = root / "work/codex-team-hook-pilot"
    work.mkdir(parents=True, exist_ok=True)
    config = work / "config.json"
    config.write_text(json.dumps(dict(version=1, enabled=True, member_name="Hook链路试验成员",
                                     project_roots=[str(root)]), ensure_ascii=False), encoding="utf-8")
    launcher = Path(__file__).with_name("launcher.py").resolve()
    command_parts = [sys.executable, str(launcher), "--config", str(config),
                     "--diagnostic", str(work / (args.mode + "-receipt.json"))]
    if args.mode == "download-failure":
        command_parts += ["--script-url", "https://synapse.d2.pub/files/asset_nonexistent_codex_hook_pilot"]
    command = subprocess.list2cmdline(command_parts) if sys.platform == "win32" else shlex.join(command_parts)
    async_value = "true" if args.mode == "async" else "false"
    handler = '{ type = "command", command = ' + json.dumps(command) + ', async = ' + async_value + ', timeout = 15 }'
    hooks = "hooks = { UserPromptSubmit = [{ hooks = [" + handler + "] }], Stop = [{ hooks = [" + handler + "] }] }"
    marker = "SY_CODEX_PILOT_" + args.mode.upper().replace("-", "_") + "_OK_20261113"
    prompt = "请不要调用任何工具。只回复：" + marker
    binary = shutil.which("codex")
    if not binary:
        parser.error("Codex CLI is required")
    # This explicit one-process flag is for reviewed automation only. Never persist it.
    command = [binary, "exec", "--ephemeral", "--json", "--sandbox", "read-only",
               "--dangerously-bypass-hook-trust", "-c", hooks, "-c", "features.hooks=true",
               "-o", str(work / (args.mode + "-final.txt")), prompt]
    started = time.monotonic()
    with (work / (args.mode + "-events.jsonl")).open("w") as out, (work / (args.mode + "-stderr.log")).open("w") as err:
        result = subprocess.run(command, stdout=out, stderr=err, timeout=90)
    events = [json.loads(line) for line in (work / (args.mode + "-events.jsonl")).read_text().splitlines()
              if line.startswith("{")]
    final = (work / (args.mode + "-final.txt")).read_text(encoding="utf-8")
    summary = dict(mode=args.mode, exit=result.returncode, elapsed_seconds=round(time.monotonic()-started, 3),
                   thread_ids=[e["thread_id"] for e in events if e.get("thread_id")],
                   prompt=prompt, final=final, final_exact=final == marker,
                   launcher_sha256=hashlib.sha256(launcher.read_bytes()).hexdigest())
    (work / (args.mode + "-summary.json")).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    if result.returncode or final != marker:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
