#!/usr/bin/env python3
"""Explicit real-AI lifecycle acceptance, isolated from the user's Codex home."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = ROOT / "work/codex-team-hook-release"
HOME_DIR = WORK / 'isolated home $scope "quoted"'
INSTALL = HOME_DIR / "hooks/sy-team-capture"
PROJECTS = [WORK / "projects/company-one", WORK / "projects/company-two"]
MEMBER = "FormalAcceptance20261113"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot():
    return {str(p.relative_to(HOME_DIR)): [digest(p), p.stat().st_mtime_ns, stat.S_IMODE(p.stat().st_mode)]
            for p in HOME_DIR.rglob("*") if p.is_file()}


def owned_handlers():
    data = read_json(HOME_DIR / "hooks.json")
    result = {}
    for event in ["UserPromptSubmit", "Stop"]:
        found = []
        for group in data.get("hooks", {}).get(event, []):
            for handler in group.get("hooks", []):
                if handler.get("type") != "command":
                    continue
                args = shlex.split(handler["command"])
                if len(args) > 1 and Path(args[1]).resolve() == (INSTALL / "launcher.py").resolve():
                    found.append((handler, args))
        result[event] = found
    return result


def validate_sentinels(state):
    actual = read_json(HOME_DIR / "hooks.json")
    assert actual["description"] == state["sentinel_hooks"]["description"]
    for event, groups in state["sentinel_hooks"]["hooks"].items():
        for group in groups:
            for handler in group["hooks"]:
                assert any(handler in candidate.get("hooks", []) for candidate in actual["hooks"].get(event, [])), event
    assert (HOME_DIR / "config.toml").read_text() == state["sentinel_toml"]
    assert (HOME_DIR / "unrelated.py").read_text() == 'print("{}")\n'


def validate_installed(release, roots):
    assert digest(INSTALL / "launcher.py") == release["resources"]["launcher"]["sha256"]
    config = read_json(INSTALL / "config.json")
    assert config["member_name"] == MEMBER
    assert config["project_roots"] == [str(p.resolve()) for p in roots]
    assert config["version"] == 1
    for event, entries in owned_handlers().items():
        assert len(entries) == 1, event
        handler, args = entries[0]
        assert handler.get("async") is False and handler["timeout"] == 15
        assert args[2:] == ["--config", str(INSTALL / "config.json"), "--diagnostic", str(INSTALL / "last-run.json")]
        assert Path(args[0]).is_absolute() and Path(args[0]).is_file()
    receipt = read_json(INSTALL / "installation.json")
    assert receipt["package_id"] == "sy-team-capture"
    assert receipt["version"] == "1.0.0"
    assert receipt["launcher_sha256"] == release["resources"]["launcher"]["sha256"]
    for name in ["launcher.py", "config.json", "installation.json"]:
        assert stat.S_IMODE((INSTALL / name).stat().st_mode) == 0o600
    assert stat.S_IMODE(INSTALL.stat().st_mode) == 0o700


def ensure_fixture(state):
    if state.get("sentinel_hooks"):
        return
    HOME_DIR.mkdir(parents=True, exist_ok=False)
    for p in PROJECTS:
        p.mkdir(parents=True, exist_ok=True)
    sentinel = HOME_DIR / "unrelated.py"
    sentinel.write_text('print("{}")\n')
    command = shlex.join([shutil.which("python3") or "/usr/bin/python3", str(sentinel)])
    handler = {"type": "command", "command": command, "timeout": 5}
    hooks = {"description": "Pre-existing unrelated hooks; must survive acceptance",
             "hooks": {event: [{"hooks": [dict(handler)]}] for event in ["UserPromptSubmit", "Stop", "SessionStart"]}}
    toml = '[features]\nhooks = true\n\n[acceptance_sentinel]\npreserve = "yes"\n'
    write_json(HOME_DIR / "hooks.json", hooks)
    (HOME_DIR / "config.toml").write_text(toml)
    state.update(sentinel_hooks=hooks, sentinel_toml=toml)


def run_ai(case, prompt, state):
    common = f'''This is an explicitly authorized isolated acceptance test of a published Hook guide.
The Codex configuration directory for ALL requested operations is {HOME_DIR}.
Do not set or change CODEX_HOME. Never inspect or edit the real global Codex configuration, credentials or other chats.
Only create or change files under that isolated directory. Preserve all pre-existing unrelated hooks and TOML settings.
Member name already supplied: {MEMBER}. Initial project roots already supplied: {PROJECTS[0]} and {PROJECTS[1]}.
The guide may say validation in progress: this is that explicitly authorized isolated validation.
Do not ask the user to repeat these values. Do not start other Codex sessions, execute Hook/collector code, submit records or run upload tests: an outer harness validates runtime separately.
Do not commit, push, use Synapse MCP, edit project source, or change hook trust. If trust cannot be read, report unknown.
Read the provided public Markdown freshly and follow only the requested action. Do not implement a separate installer program or put operational code into launcher.py.
Finish with a concise factual result. This is configuration acceptance, not a code-development task.'''
    args = [shutil.which("codex"), "exec", "--ephemeral", "--json", "--sandbox", "workspace-write",
            "-c", "sandbox_workspace_write.network_access=true", "-c", "features.hooks=false",
            "-c", "developer_instructions=" + json.dumps(common),
            "-o", str(WORK / (case + "-final.txt")), prompt]
    start = time.monotonic()
    with (WORK / (case + "-events.jsonl")).open("w") as out, (WORK / (case + "-stderr.log")).open("w") as err:
        result = subprocess.run(args, cwd=ROOT, stdout=out, stderr=err, timeout=240)
    assert result.returncode == 0, case + " CLI failed"
    events = [json.loads(line) for line in (WORK / (case + "-events.jsonl")).read_text().splitlines() if line.startswith("{")]
    return dict(case=case, elapsed_seconds=round(time.monotonic() - start, 3),
                thread_ids=[e["thread_id"] for e in events if e.get("thread_id")],
                final=(WORK / (case + "-final.txt")).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--phase", choices=["configure", "uninstall"], required=True)
    args = parser.parse_args()
    if not args.run:
        parser.error("--run explicitly permits real AI calls and isolated configuration writes")
    WORK.mkdir(parents=True, exist_ok=True)
    release = read_json(HERE / "release.json")
    state_path = WORK / "lifecycle.json"
    state = read_json(state_path) if state_path.exists() else {"results": []}
    ensure_fixture(state)
    write_json(state_path, state)
    url = release["resources"]["document"]["url"]
    cases = [("initialize", "初始化hook"), ("repeat_initialize", "初始化hook"),
             ("status", "检查我现在的状态"), ("diagnose", "诊断我的hook"),
             ("change_roots", "把我的hook匹配目录替换为 " + str(PROJECTS[1])),
             ("disable", "停用我的hook"), ("enable", "启用我的hook"), ("upgrade", "更新我的hook")]
    if args.phase == "uninstall":
        cases = [("uninstall", "卸载我的hook"), ("repeat_uninstall", "卸载我的hook")]
    done = {r["case"] for r in state["results"]}
    for case, action in cases:
        if case in done:
            continue
        if case == "upgrade":
            # Controlled outdated copy exercises a real replacement, not a no-op check.
            source = INSTALL / "launcher.py"
            source.write_bytes(b"# acceptance outdated copy\n" + source.read_bytes())
            receipt = read_json(INSTALL / "installation.json")
            receipt["version"] = "0.9.0"
            write_json(INSTALL / "installation.json", receipt)
        before = snapshot()
        result = run_ai(case, "请根据 " + url + " " + action, state)
        validate_sentinels(state)
        if case in ["status", "diagnose"]:
            assert snapshot() == before, case + " mutated the installation"
            result["readonly_exact"] = True
        if case in ["initialize", "repeat_initialize", "status", "diagnose", "change_roots", "enable", "disable", "upgrade"]:
            roots = PROJECTS if case in ["initialize", "repeat_initialize", "status", "diagnose"] else [PROJECTS[1]]
            validate_installed(release, roots)
            assert read_json(INSTALL / "config.json")["enabled"] is (case != "disable")
        if case in ["uninstall", "repeat_uninstall"]:
            assert all(not entries for entries in owned_handlers().values())
            assert read_json(INSTALL / "config.json")["enabled"] is False
            stub = (INSTALL / "launcher.py").read_text()
            assert "print" in stub and "urllib" not in stub and "stdin" not in stub
        result["verified"] = True
        state["results"].append(result)
        write_json(state_path, state)
        print(json.dumps({k:v for k,v in result.items() if k != "final"}, ensure_ascii=False), flush=True)
    print("PHASE_COMPLETE " + args.phase, flush=True)


if __name__ == "__main__":
    main()
