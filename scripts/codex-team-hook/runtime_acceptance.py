#!/usr/bin/env python3
"""Real model runtime and synthetic one-shot cloud probes; requires --run."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = ROOT / "work/codex-team-hook-release"
HOME_DIR = WORK / 'isolated home $scope "quoted"'
INSTALL = HOME_DIR / "hooks/sy-team-capture"
PROJECT = WORK / "projects/company-two"


def validate_runtime_install(release):
    identity = {"version": release["version"], "sha256": {
        name: release["resources"][name]["sha256"] for name in ["launcher", "collector", "document"]}}
    state = json.loads((WORK / "lifecycle.json").read_text())
    if state.get("release_identity") != identity:
        raise ValueError("Runtime fixture belongs to a different/legacy release; configure a fresh --work-dir")
    actual = hashlib.sha256((INSTALL / "launcher.py").read_bytes()).hexdigest()
    receipt = json.loads((INSTALL / "installation.json").read_text())
    if (actual != identity["sha256"]["launcher"] or receipt.get("launcher_sha256") != actual
            or receipt.get("package_id") != "sy-team-capture"
            or receipt.get("launcher_version", receipt.get("version")) != release.get("launcher_version", release["version"])):
        raise ValueError("Runtime fixture launcher/receipt does not match the current release")
    if json.loads((INSTALL / "config.json").read_text()).get("enabled") is not True:
        raise ValueError("Runtime fixture is disabled")
    if "registration_version" in release and receipt.get("registration_version") != release["registration_version"]:
        raise ValueError("Runtime fixture registration version does not match the current release")
    if "registration_version" in release:
        spec = importlib.util.spec_from_file_location("registration", HERE / "registration.py")
        registration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(registration)
        hooks = json.loads((HOME_DIR / "hooks.json").read_text()).get("hooks", {})
        for event in ["UserPromptSubmit", "Stop"]:
            owned = [handler for group in hooks.get(event, []) for handler in group.get("hooks", [])
                     if handler.get("type") == "command" and registration.launcher_args(handler.get("command"), INSTALL) is not None]
            if (len(owned) != 1 or not registration.current_registration(owned[0]["command"], INSTALL)
                    or owned[0].get("async") is not False or owned[0].get("timeout") != 15):
                raise ValueError("Runtime fixture actual registration does not match format 2")
    return {"release_identity": identity, "launcher_sha256": actual}


def main():
    global WORK, HOME_DIR, INSTALL, PROJECT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--mode", choices=["model", "long", "update"], required=True)
    parser.add_argument("--work-dir", type=Path, default=WORK)
    args = parser.parse_args()
    if not args.run:
        parser.error("--run permits a real model call or synthetic formal-table submission")
    resolved = args.work_dir.resolve()
    if (ROOT / "work").resolve() not in resolved.parents:
        parser.error("--work-dir must be under this repository's work directory")
    WORK = resolved
    HOME_DIR = WORK / 'isolated home $scope "quoted"'
    INSTALL = HOME_DIR / "hooks/sy-team-capture"
    PROJECT = WORK / "projects/company-two"
    release = json.loads((HERE / "release.json").read_text())
    identity = validate_runtime_install(release)
    if args.mode == "model":
        hooks = json.loads((HOME_DIR / "hooks.json").read_text())["hooks"]
        events = []
        for event in ["UserPromptSubmit", "Stop"]:
            definitions = []
            for group in hooks[event]:
                handlers = []
                for handler in group["hooks"]:
                    handlers.append('{ type = "command", command = ' + json.dumps(handler["command"]) +
                                    ', async = false, timeout = ' + str(handler["timeout"]) + ' }')
                definitions.append('{ hooks = [' + ', '.join(handlers) + '] }')
            events.append(event + ' = [' + ', '.join(definitions) + ']')
        inline = 'hooks = { ' + ', '.join(events) + ' }'
        marker = "SY_FORMAL_HOOK_" + release["version"].replace(".", "_") + "_OK_20261113"
        prompt = "请不要调用任何工具。只回复：" + marker
        # Reviewed automation, only for this process; never part of member config.
        command = [shutil.which("codex"), "exec", "--ephemeral", "--json", "--sandbox", "read-only",
                   "--dangerously-bypass-hook-trust", "-C", str(PROJECT), "-c", inline,
                   "-c", "features.hooks=true", "-o", str(WORK / "runtime-final.txt"), prompt]
        started = time.monotonic()
        with (WORK / "runtime-events.jsonl").open("w") as out, (WORK / "runtime-stderr.log").open("w") as err:
            result = subprocess.run(command, cwd=ROOT, stdout=out, stderr=err, timeout=90)
        final = (WORK / "runtime-final.txt").read_text(encoding="utf-8")
        assert result.returncode == 0 and final == marker
        records = [json.loads(line) for line in (WORK / "runtime-events.jsonl").read_text().splitlines() if line.startswith("{")]
        summary = dict(mode="model", exit=0, final_exact=True, prompt=prompt, final=final,
                       thread_ids=[r["thread_id"] for r in records if r.get("thread_id")],
                       elapsed_seconds=round(time.monotonic() - started, 3))
    else:
        module_spec = importlib.util.spec_from_file_location("installed_launcher", INSTALL / "launcher.py")
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        config = json.loads((INSTALL / "config.json").read_text())
        content = ('中文🧪\\"\n' * 14000) if args.mode == "long" else "SY_FORMAL_REMOTE_UPDATE_20261113"
        payload = dict(cwd=str(PROJECT), hook_event_name="UserPromptSubmit", prompt=content,
                       session_id="formal-acceptance-" + args.mode, turn_id="formal-acceptance-" + args.mode)
        status = module.process(payload, config, module.SCRIPT_URL)
        assert status["outcome"] == "success", status
        summary = dict(mode=args.mode, status=status, content_bytes=len(content.encode()),
                       content_sha256=hashlib.sha256(content.encode()).hexdigest())
        if args.mode == "long":
            (WORK / "long-expected.txt").write_text(content, encoding="utf-8")
    summary.update(identity)
    (WORK / ("runtime-" + args.mode + ".json")).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
