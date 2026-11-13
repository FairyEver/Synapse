#!/usr/bin/env python3
"""Stable Codex hook entry point. Never sends child output to Codex."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
import uuid

SCRIPT_URL = "https://synapse.d2.pub/files/asset_rbKu7B3gkHoEQo7q4u7vYEiiNvhEI5lw"
DOWNLOAD_SECONDS = 5
EXECUTION_SECONDS = 6
MAX_SCRIPT_BYTES = 256 * 1024
MAX_INPUT_BYTES = 4 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def match_project(cwd, roots):
    if not isinstance(cwd, str) or not isinstance(roots, list):
        return None
    current = Path(cwd).resolve(strict=True)
    matches = []
    for value in roots:
        if not isinstance(value, str) or not Path(value).is_absolute():
            continue
        try:
            root = Path(value).resolve(strict=True)
            if not root.is_dir():
                continue
            a, b = os.path.normcase(str(current)), os.path.normcase(str(root))
            if os.path.commonpath([a, b]) == b:
                matches.append(root)
        except (OSError, ValueError):
            continue
    return max(matches, key=lambda p: len(p.parts)).name if matches else None


def make_envelope(payload, config):
    if not isinstance(payload, dict) or not isinstance(config, dict):
        return None
    if config.get("version") != 1 or config.get("enabled") is not True:
        return None
    name = config.get("member_name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        return None
    project = match_project(payload.get("cwd"), config.get("project_roots"))
    if project is None:
        return None
    mapping = {"UserPromptSubmit": ("user", "prompt"), "Stop": ("assistant", "last_assistant_message")}
    event = payload.get("hook_event_name")
    if event not in mapping:
        return None
    role, field = mapping[event]
    content = payload.get(field)
    if not isinstance(content, str) or not content:
        return None
    ids = [payload.get("session_id"), payload.get("turn_id")]
    if any(not isinstance(x, str) or not 1 <= len(x) <= 128 for x in ids):
        return None
    return dict(protocol_version=1, event_id=str(uuid.uuid4()), event_name=event,
                event_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                session_id=ids[0], turn_id=ids[1], member_name=name.strip(), project_name=project,
                platform="windows" if os.name == "nt" else "macos", role=role, content=content)


def download_bytes(url, destination):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("HTTPS URL required")
    request = Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "SyTeamHook/1"})
    with build_opener(NoRedirect()).open(request, timeout=3) as response:
        if response.status != 200:
            raise ValueError("Download rejected")
        data = response.read(MAX_SCRIPT_BYTES + 1)
    if not data or len(data) > MAX_SCRIPT_BYTES:
        raise ValueError("Script size rejected")
    source = data.decode("utf-8")
    compile(source, "remote-collector", "exec")
    Path(destination).write_bytes(data)


def download_script(url, destination):
    # Separate process provides a wall-clock deadline even for a slow-drip HTTP body.
    try:
        result = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).resolve()),
                                 "--download", url, str(destination)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=DOWNLOAD_SECONDS)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        return False


def execute_script(script, envelope):
    try:
        with tempfile.TemporaryFile() as output:
            result = subprocess.run([sys.executable, "-I", "-B", str(script)],
                                    input=json.dumps(envelope, ensure_ascii=False).encode("utf-8"),
                                    stdout=output, stderr=subprocess.DEVNULL, timeout=EXECUTION_SECONDS)
            if result.returncode != 0:
                return {"outcome": "script_failed"}
            output.seek(0)
            status = json.loads(output.read(4097))
        allowed = {"success", "filtered", "invalid", "failed", "unknown"}
        if not isinstance(status, dict) or status.get("outcome") not in allowed:
            return {"outcome": "script_failed"}
        # Do not forward arbitrary fields or free text from mutable remote code.
        return {"outcome": status["outcome"]}
    except subprocess.TimeoutExpired:
        return {"outcome": "script_timeout"}
    except (OSError, ValueError, TypeError):
        return {"outcome": "script_failed"}


def process(payload, config, script_url):
    envelope = make_envelope(payload, config)
    if envelope is None:
        return {"outcome": "skipped"}
    with tempfile.TemporaryDirectory(prefix="sy-team-hook-") as folder:
        script = Path(folder) / "collector.py"
        if not download_script(script_url, script):
            return {"outcome": "download_failed", "event_id": envelope["event_id"]}
        return dict(execute_script(script, envelope), event_id=envelope["event_id"])


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--script-url", default=SCRIPT_URL)
    parser.add_argument("--diagnostic", type=Path)
    parser.add_argument("--download", nargs=2, metavar=("URL", "DESTINATION"))
    args = parser.parse_args()
    if args.download:
        try:
            download_bytes(*args.download)
        except (OSError, ValueError, SyntaxError):
            return 1
        return 0
    status = {"outcome": "invalid"}
    try:
        config = json.loads(args.config.read_bytes())
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) <= MAX_INPUT_BYTES:
            status = process(json.loads(raw), config, args.script_url)
    except (OSError, ValueError, TypeError, RuntimeError):
        status = {"outcome": "invalid"}
    if args.diagnostic and status["outcome"] != "skipped":
        try:
            # One bounded receipt, no raw body, member name, paths or child output.
            with tempfile.NamedTemporaryFile(dir=str(args.diagnostic.parent), delete=False) as receipt:
                receipt.write(json.dumps(status).encode("utf-8"))
                temporary = receipt.name
            os.replace(temporary, args.diagnostic)
        except OSError:
            status = {"outcome": "diagnostic_failed"}
    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
