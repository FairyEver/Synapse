"""Standalone contract tests; no production cloud writes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import io
import shlex

HERE = Path(__file__).resolve().parent


class CaptureTests(unittest.TestCase):
    def module(self, name):
        path = HERE / (name + ".py")
        self.assertTrue(path.is_file(), "Missing implementation: " + path.name)
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def envelope(self, content="中文\nemoji 🧪"):
        return dict(protocol_version=1, event_id="11111111-1111-4111-8111-111111111111",
                    event_name="UserPromptSubmit", event_at="2026-11-13T02:00:00.000Z",
                    session_id="test-session", turn_id="test-turn", member_name="试验成员",
                    project_name="公司项目", platform="macos", role="user", content=content)

    def test_scope_uses_path_components_and_real_paths(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "公司 项目"
            child = root / "sub"
            child.mkdir(parents=True)
            sibling = Path(folder) / "公司 项目-other"
            sibling.mkdir()
            link = Path(folder) / "link"
            link.symlink_to(root, target_is_directory=True)
            self.assertEqual(launcher.match_project(str(child), [str(root)]), root.name)
            self.assertEqual(launcher.match_project(str(link / "sub"), [str(root)]), root.name)
            self.assertIsNone(launcher.match_project(str(sibling), [str(root)]))
            self.assertIsNone(launcher.match_project(str(root), []))

    def test_envelope_excludes_unapproved_fields_and_preserves_text(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            config = dict(version=1, enabled=True, member_name="试验成员", project_roots=[folder])
            payload = dict(cwd=folder, hook_event_name="UserPromptSubmit", prompt="中文\n🧪",
                           session_id="s", turn_id="t", transcript_path="SECRET", tool_output="SECRET")
            item = launcher.make_envelope(payload, config)
            self.assertEqual(item["content"], "中文\n🧪")
            self.assertEqual(item["role"], "user")
            self.assertNotIn("SECRET", json.dumps(item))
            self.assertNotIn("cwd", item)
            config["enabled"] = False
            self.assertIsNone(launcher.make_envelope(payload, config))

    def test_empty_stop_is_skipped(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            config = dict(version=1, enabled=True, member_name="成员", project_roots=[folder])
            payload = dict(cwd=folder, hook_event_name="Stop", last_assistant_message=None,
                           session_id="s", turn_id="t")
            self.assertIsNone(launcher.make_envelope(payload, config))

    def test_unsupported_platform_is_not_captured(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            config = dict(version=1, enabled=True, member_name="member", project_roots=[folder])
            payload = dict(cwd=folder, hook_event_name="UserPromptSubmit", prompt="hello", session_id="s", turn_id="t")
            with patch.object(launcher.sys, "platform", "win32"):
                self.assertIsNone(launcher.make_envelope(payload, config))

    def test_relative_missing_or_file_cwd_is_rejected(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "file"
            file.write_text("test")
            for cwd in [".", str(file), str(Path(folder) / "missing")]:
                self.assertIsNone(launcher.match_project(cwd, [folder]))

    def test_outside_scope_does_not_download(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "allowed"
            root.mkdir()
            config = dict(version=1, enabled=True, member_name="成员", project_roots=[str(root)])
            payload = dict(cwd=folder, hook_event_name="UserPromptSubmit", prompt="private",
                           session_id="s", turn_id="t")
            # Network is an external boundary. Any attempted download fails this test.
            with patch.object(launcher, "download_script", side_effect=AssertionError("network outside scope")):
                self.assertEqual(launcher.process(payload, config, "https://invalid.test/x")["outcome"], "skipped")

    def test_splitting_preserves_unicode_and_json_escaping(self):
        collector = self.module("collector")
        content = '中文🧪\\"\n' * 14000
        batch = json.loads(collector.build_batch(self.envelope(content)))
        rows = [op["values"] for op in batch["operations"]]
        self.assertGreater(len(rows), 1)
        self.assertEqual("".join(row["content"] for row in rows), content)
        self.assertEqual([r["part_index"] for r in rows], list(range(1, len(rows) + 1)))
        for row in rows:
            self.assertLessEqual(len(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode()), 48 * 1024)
            self.assertEqual(row["part_count"], len(rows))

    def test_oversized_or_invalid_message_is_not_truncated(self):
        collector = self.module("collector")
        for content in ["a" * (1024 * 1024), "bad\x00text", "bad\ud800text"]:
            with self.subTest(length=len(content)):
                with self.assertRaises(ValueError):
                    collector.build_batch(self.envelope(content))

    def test_known_internal_request_is_filtered(self):
        collector = self.module("collector")
        item = self.envelope("This is an app-generated request for a suggested next user message. The user did not write this message.\nprivate")
        self.assertEqual(collector.collect(item)["outcome"], "filtered")

    def test_submission_failure_is_not_retried(self):
        collector = self.module("collector")
        attempts = []
        def fail(request, timeout):
            attempts.append(request)
            raise TimeoutError("must not expose body")
        with patch.object(collector, "open_request", side_effect=fail):
            result = collector.collect(self.envelope())
        self.assertEqual(result["outcome"], "unknown")
        self.assertEqual(len(attempts), 1)
        self.assertNotIn("content", result)

    def test_server_error_has_unknown_commit_status(self):
        collector = self.module("collector")
        with patch.object(collector, "open_request", side_effect=HTTPError("https://test", 503, "busy", {}, None)):
            self.assertEqual(collector.collect(self.envelope())["outcome"], "unknown")

    def test_invalid_success_receipt_is_unknown(self):
        collector = self.module("collector")
        class Response(io.BytesIO):
            status = 201
        for receipt in [{"data": [{"id": "row"}]}, {"data": [{"id": "row", "version": True}]}]:
            with patch.object(collector, "open_request", return_value=Response(json.dumps(receipt).encode())):
                self.assertEqual(collector.collect(self.envelope())["outcome"], "unknown")

    def test_remote_stdout_cannot_enter_codex_context(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "remote.py"
            script.write_text('print("SECRET MODEL CONTEXT")\nraise SystemExit(1)\n')
            result = launcher.execute_script(script, self.envelope())
            self.assertEqual(result["outcome"], "script_failed")
            self.assertNotIn("SECRET", json.dumps(result))

    def test_child_execution_has_hard_deadline(self):
        launcher = self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "remote.py"
            script.write_text("import time\ntime.sleep(3)\n")
            with patch.object(launcher, "EXECUTION_SECONDS", 0.15):
                self.assertEqual(launcher.execute_script(script, self.envelope())["outcome"], "script_timeout")

    def test_download_deadline_returns_failure_without_retry(self):
        launcher = self.module("launcher")
        with patch.object(launcher.subprocess, "run", side_effect=subprocess.TimeoutExpired("download", 5)) as run:
            self.assertFalse(launcher.download_script("https://invalid.test/code", Path("unused")))
            self.assertEqual(run.call_count, 1)

    def test_cli_failure_outputs_only_empty_json(self):
        self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "config.json"
            config.write_text("{}")
            result = subprocess.run([sys.executable, str(HERE / "launcher.py"), "--config", str(config)],
                                    input="malformed SECRET", text=True, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "{}\n")
            self.assertEqual(result.stderr, "")

    def test_diagnostic_receipt_has_version_time_and_no_input(self):
        self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "config.json"
            diagnostic = Path(folder) / "last-run.json"
            config.write_text("{}")
            result = subprocess.run([sys.executable, str(HERE / "launcher.py"), "--config", str(config),
                                     "--diagnostic", str(diagnostic)], input="SECRET INVALID INPUT",
                                    text=True, capture_output=True, timeout=5)
            self.assertEqual(result.stdout, "{}\n")
            data = json.loads(diagnostic.read_bytes())
            self.assertEqual(data["launcher_version"], "1.0.0")
            self.assertRegex(data["recorded_at"], r"^\d{4}-\d\d-\d\dT.*Z$")
            self.assertNotIn("SECRET", diagnostic.read_text())
            self.assertLessEqual(diagnostic.stat().st_size, 512)

    def test_shell_command_preserves_special_filename(self):
        self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script = root / 'entry $(touch UNEXPECTED) "quoted".py'
            script.write_bytes((HERE / "launcher.py").read_bytes())
            config = root / "config.json"
            config.write_text("{}")
            result = subprocess.run(shlex.join([sys.executable, str(script), "--config", str(config)]),
                                    shell=True, cwd=folder, input="{}", text=True, capture_output=True, timeout=5)
            self.assertEqual(result.stdout, "{}\n")
            self.assertFalse((root / "UNEXPECTED").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
