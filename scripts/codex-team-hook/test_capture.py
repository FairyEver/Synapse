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
from http.client import HTTPResponse, IncompleteRead

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

    def test_boolean_schema_version_is_rejected(self):
        launcher = self.module("launcher")
        collector = self.module("collector")
        with tempfile.TemporaryDirectory() as folder:
            config = dict(version=True, enabled=True, member_name="member", project_roots=[folder])
            payload = dict(cwd=folder, hook_event_name="UserPromptSubmit", prompt="hello", session_id="s", turn_id="t")
            with self.subTest(layer="launcher"):
                self.assertIsNone(launcher.make_envelope(payload, config))
        with self.subTest(layer="collector"):
            item = self.envelope()
            item["protocol_version"] = True
            with self.assertRaises(ValueError):
                collector.build_batch(item)

    def test_truncated_download_never_creates_executable(self):
        launcher = self.module("launcher")
        class Response(io.BytesIO):
            status = 200
            headers = {"Content-Length": "200"}
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "collector.py"
            response = Response(b'print("syntactically valid but incomplete")\n')
            with patch.object(launcher, "build_opener") as opener:
                opener.return_value.open.return_value = response
                with self.assertRaises(ValueError):
                    launcher.download_bytes("https://example.test/script", target)
            self.assertFalse(target.exists())

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

    def test_standalone_assistant_suggestions_json_is_filtered_without_submission(self):
        collector = self.module("collector")
        for text in ['{"suggestions":[]}', ' \n{ "suggestions" : [] }\n ',
                     '{"suggestions":["下一条建议"]}', '{"suggestions":[{"text":"下一条建议"}]}']:
            with self.subTest(text=text):
                item = self.envelope(text)
                item.update(role="assistant", event_name="Stop")
                status, submissions = self.submit_to_memory(collector, item)
                self.assertEqual(status["outcome"], "filtered")
                self.assertEqual(submissions, [])

    def test_normal_assistant_suggestions_mentions_examples_and_other_json_are_preserved(self):
        collector = self.module("collector")
        for text in ['普通回复，包含 suggestions 一词。', '解释示例：{"suggestions":[]}',
                     '```json\n{"suggestions":[]}\n```', '{"suggestions":[],"status":"业务输出"}',
                     '{"suggestions":"普通字符串"}', '[{"suggestions":[]}]', '{"suggestions":[]']:
            with self.subTest(text=text):
                item = self.envelope(text)
                item.update(role="assistant", event_name="Stop")
                status, submissions = self.submit_to_memory(collector, item)
                self.assertEqual(status["outcome"], "success")
                self.assertEqual(submissions[0][0]["values"]["content"], text)

    def test_user_suggestions_json_and_question_card_answer_are_preserved(self):
        collector = self.module("collector")
        text = '{"suggestions":[]}'
        for raw in [text, self.card_reply([{"answer": text}])]:
            status, submissions = self.submit_to_memory(collector, self.envelope(raw))
            self.assertEqual(status["outcome"], "success")
            self.assertEqual(submissions[0][0]["values"]["content"], text)

    def submit_to_memory(self, collector, item):
        submissions = []
        class Response(io.BytesIO):
            status = 201
            def __init__(self, data):
                super().__init__(data)
                self.headers = {"Content-Length": str(len(data))}
        def receive(request, timeout):
            operations = json.loads(request.data)["operations"]
            submissions.append(operations)
            return Response(json.dumps({"data": [{"id": "row-" + str(index), "version": 1}
                                                  for index in range(len(operations))]}).encode())
        with patch.object(collector, "open_request", side_effect=receive):
            status = collector.collect(item)
        return status, submissions

    def card_reply(self, entries):
        return "<send_user_message_question_reply>\n" + json.dumps(entries, ensure_ascii=False) + "\n</send_user_message_question_reply>"

    def test_question_reply_submits_only_actual_answer_without_mutating_input(self):
        collector = self.module("collector")
        raw = self.card_reply([{"questionItemId": "PRIVATE-CARD-ID", "question": "PRIVATE-QUESTION",
                                "answer": "先只运行统计采集"}])
        item = self.envelope(raw)
        status, submissions = self.submit_to_memory(collector, item)
        self.assertEqual(status["outcome"], "success")
        self.assertEqual(len(submissions), 1)
        self.assertEqual(submissions[0][0]["values"]["content"], "先只运行统计采集")
        self.assertNotIn("PRIVATE", json.dumps(submissions))
        self.assertNotIn("send_user_message_question_reply", json.dumps(submissions))
        self.assertEqual(item["content"], raw)

    def test_multiple_question_answers_preserve_text_order_and_unicode(self):
        collector = self.module("collector")
        first, second = '  方案 A\n补充说明 🧪  ', '引号"与\\路径'
        raw = " \n" + self.card_reply([{"answer": first, "question": "PRIVATE"}, {"answer": " \n "},
                                      {"answer": second, "questionItemId": "PRIVATE"}]) + "\n "
        status, submissions = self.submit_to_memory(collector, self.envelope(raw))
        self.assertEqual(status["outcome"], "success")
        self.assertEqual(submissions[0][0]["values"]["content"], first + "\n\n" + second)

    def test_empty_question_answers_are_filtered_without_submission(self):
        collector = self.module("collector")
        for entries in [[], [{"answer": ""}], [{"answer": " \n\t "}]]:
            with self.subTest(entries=entries):
                status, submissions = self.submit_to_memory(collector, self.envelope(self.card_reply(entries)))
                self.assertEqual(status["outcome"], "filtered")
                self.assertEqual(submissions, [])

    def test_malformed_question_reply_never_falls_back_to_raw_structure(self):
        collector = self.module("collector")
        malformed = [self.card_reply({"answer": "text"}), self.card_reply([{"question": "PRIVATE"}]),
                     self.card_reply([{"answer": {"text": "PRIVATE"}}]), self.card_reply([{"answer": 123}]),
                     self.card_reply([{"answer": "valid"}, {"answer": None}]),
                     '<send_user_message_question_reply>not JSON</send_user_message_question_reply>',
                     '<send_user_message_question_reply bad="true">[]</send_user_message_question_reply>',
                     self.card_reply([{"answer": "text"}]) + " unexpected trailing structure",
                     '<send_user_message_question_reply>[{"answer":"text"}]',
                     self.card_reply([{"answer": "bad\x00answer"}])]
        for raw in malformed:
            with self.subTest(raw=raw[:100]):
                status, submissions = self.submit_to_memory(collector, self.envelope(raw))
                self.assertEqual(status["outcome"], "invalid")
                self.assertEqual(submissions, [])

    def test_normal_user_text_and_assistant_question_examples_are_unchanged(self):
        collector = self.module("collector")
        wrapper = self.card_reply([{"answer": "example", "question": "literal example"}])
        for role, content in [("user", "普通文字\n保持原文"), ("user", "解释这个例子：" + wrapper), ("assistant", wrapper)]:
            item = self.envelope(content)
            item.update(role=role, event_name="Stop" if role == "assistant" else "UserPromptSubmit")
            status, submissions = self.submit_to_memory(collector, item)
            self.assertEqual(status["outcome"], "success")
            self.assertEqual(submissions[0][0]["values"]["content"], content)

    def test_question_answer_is_normalized_before_lossless_splitting_and_budget(self):
        collector = self.module("collector")
        answer = '中文🧪\\"\n' * 14000
        raw = self.card_reply([{"question": "PRIVATE", "answer": answer}])
        status, submissions = self.submit_to_memory(collector, self.envelope(raw))
        self.assertEqual(status["outcome"], "success")
        self.assertEqual(len(submissions), 1)
        rows = [op["values"] for op in submissions[0]]
        self.assertGreater(len(rows), 1)
        self.assertEqual("".join(row["content"] for row in rows), answer)
        status, submissions = self.submit_to_memory(collector, self.envelope(self.card_reply([
            {"question": "PRIVATE" * 150000, "answer": "只保留短答案"}])))
        self.assertEqual(status["outcome"], "success")
        self.assertEqual(submissions[0][0]["values"]["content"], "只保留短答案")

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

    def test_truncated_submission_response_is_unknown_without_retry(self):
        collector = self.module("collector")
        class Response(io.BytesIO):
            status = 201
            headers = {}
            def read(self, size=-1):
                raise IncompleteRead(b'{"data":', 20)
        with patch.object(collector, "open_request", return_value=Response()) as request:
            self.assertEqual(collector.collect(self.envelope())["outcome"], "unknown")
            self.assertEqual(request.call_count, 1)

    def test_invalid_success_receipt_is_unknown(self):
        collector = self.module("collector")
        class Response(io.BytesIO):
            status = 201
            headers = {}
        for receipt in [{"data": [{"id": "row"}]}, {"data": [{"id": "row", "version": True}]}]:
            with patch.object(collector, "open_request", return_value=Response(json.dumps(receipt).encode())):
                self.assertEqual(collector.collect(self.envelope())["outcome"], "unknown")

    def test_real_http_response_requires_complete_bounded_receipt(self):
        collector = self.module("collector")
        body = b'{"data":[{"id":"row","version":1}]}'
        class Socket:
            def __init__(self, data):
                self.data = data
            def makefile(self, *args):
                return io.BytesIO(self.data)
        for declared, actual, expected in [(len(body), body, "success"), (200, body, "unknown"),
                                           (65537, body + b" " * 65537, "unknown")]:
            with self.subTest(declared=declared):
                wire = b"HTTP/1.1 201 Created\r\nContent-Length: " + str(declared).encode() + b"\r\n\r\n" + actual
                response = HTTPResponse(Socket(wire))
                response.begin()
                with patch.object(collector, "open_request", return_value=response) as request:
                    self.assertEqual(collector.collect(self.envelope())["outcome"], expected)
                    self.assertEqual(request.call_count, 1)

    def test_runtime_acceptance_rejects_old_or_modified_install_before_run(self):
        runtime = self.module("runtime_acceptance")
        self.assertTrue(hasattr(runtime, "validate_runtime_install"), "Missing runtime release guard")
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            install = root / "install"
            install.mkdir()
            source = b'LAUNCHER_VERSION = "1.0.1"\n'
            sha = hashlib.sha256(source).hexdigest()
            release = {"version": "1.0.1", "launcher_version": "1.0.1", "resources": {
                name: {"sha256": sha if name == "launcher" else name + "-sha"}
                for name in ["launcher", "collector", "document"]}}
            identity = {"version": release["version"], "sha256": {
                name: item["sha256"] for name, item in release["resources"].items()}}
            (install / "launcher.py").write_bytes(source)
            (install / "installation.json").write_text(json.dumps(dict(package_id="sy-team-capture",
                launcher_version="1.0.1", launcher_sha256=sha)))
            (install / "config.json").write_text('{"enabled":true}')
            with patch.object(runtime, "WORK", root), patch.object(runtime, "HOME_DIR", root), patch.object(runtime, "INSTALL", install):
                (root / "lifecycle.json").write_text('{"results":[{"verified":true}]}')
                with self.assertRaises(ValueError):
                    runtime.validate_runtime_install(release)
                (root / "lifecycle.json").write_text(json.dumps({"release_identity": identity}))
                self.assertEqual(runtime.validate_runtime_install(release)["launcher_sha256"], sha)
                receipt = json.loads((install / "installation.json").read_text())
                receipt["registration_version"] = 2
                (install / "installation.json").write_text(json.dumps(receipt))
                release["registration_version"] = 2
                legacy = shlex.join([sys.executable, str(install / "launcher.py"), "--config", str(install / "config.json"),
                                     "--diagnostic", str(install / "last-run.json")])
                (root / "hooks.json").write_text(json.dumps({"hooks": {event: [{"hooks": [{"type":"command", "command":legacy,
                  "async":False,"timeout":15}]}] for event in ["UserPromptSubmit", "Stop"]}}))
                with self.assertRaises(ValueError):
                    runtime.validate_runtime_install(release)
                registration = self.module("registration")
                (root / "hooks.json").write_text(json.dumps(registration.hook_fragment(sys.executable, install)))
                self.assertEqual(runtime.validate_runtime_install(release)["launcher_sha256"], sha)
                (install / "launcher.py").write_bytes(source + b"# changed\n")
                with self.assertRaises(ValueError):
                    runtime.validate_runtime_install(release)

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

    def test_download_spawn_failure_is_download_failure(self):
        launcher = self.module("launcher")
        with patch.object(launcher.subprocess, "run", side_effect=OSError("cannot spawn")) as run:
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
            self.assertEqual(data["launcher_version"], "1.0.1")
            self.assertRegex(data["recorded_at"], r"^\d{4}-\d\d-\d\dT.*Z$")
            self.assertNotIn("SECRET", diagnostic.read_text())
            self.assertLessEqual(diagnostic.stat().st_size, 512)

    def test_failed_receipt_replace_leaves_no_orphan(self):
        self.module("launcher")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "config.json"
            config.write_text("{}")
            diagnostic = root / "last-run.json"
            diagnostic.mkdir()
            before = {p.name for p in root.iterdir()}
            result = subprocess.run([sys.executable, str(HERE / "launcher.py"), "--config", str(config),
                                     "--diagnostic", str(diagnostic)], input="malformed", text=True,
                                    capture_output=True, timeout=5)
            self.assertEqual(result.stdout, "{}\n")
            self.assertEqual(result.stderr, "")
            self.assertEqual({p.name for p in root.iterdir()}, before)

    def test_legacy_acceptance_checkpoint_cannot_skip_new_release(self):
        acceptance = self.module("acceptance")
        self.assertTrue(hasattr(acceptance, "validate_checkpoint"), "Missing release identity guard")
        release = {"version": "1.0.1", "resources": {name: {"sha256": name + "-sha"}
                   for name in ["launcher", "collector", "document"]}}
        with self.assertRaises(ValueError):
            acceptance.validate_checkpoint({"results": [{"case": "initialize", "verified": True}]}, release)

    def test_builder_rejects_version_label_mismatch(self):
        builder = self.module("build_document")
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            resources = {}
            for name, constant in [("launcher", "LAUNCHER_VERSION"), ("collector", "COLLECTOR_VERSION")]:
                source = (constant + ' = "1.0.0"\n').encode()
                (root / (name + ".py")).write_bytes(source)
                resources[name] = {"url": "https://example.test/" + name, "sha256": hashlib.sha256(source).hexdigest()}
            (root / "release.json").write_text(json.dumps({"version": "1.0.1", "launcher_version": "1.0.1",
                  "collector_version": "1.0.1", "status": "stable", "resources": resources}))
            (root / "operations.template.md").write_text("# {{VERSION}}\n")
            with patch.object(builder, "HERE", root), patch.object(builder, "DOC", root / "result.md"):
                with self.assertRaises(ValueError):
                    builder.main()
            self.assertFalse((root / "result.md").exists())

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

    def test_cached_registration_after_full_removal_is_noop_without_stdin(self):
        self.assertTrue((HERE / "registration.py").is_file(), "Missing inline registration guard")
        registration = self.module("registration")
        with tempfile.TemporaryDirectory() as folder:
            installation = Path(folder) / 'removed $scope "quoted"'
            command = registration.hook_fragment(sys.executable, installation)["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
            child = subprocess.Popen(command, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, cwd=folder)
            try:
                self.assertEqual(child.wait(timeout=2), 0)
                self.assertEqual(child.stdout.read(), b"{}\n")
                self.assertEqual(child.stderr.read(), b"")
                self.assertFalse(installation.exists())
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
                child.stdin.close()
                child.stdout.close()
                child.stderr.close()

    def test_guarded_registration_preserves_exact_arguments(self):
        self.assertTrue((HERE / "registration.py").is_file(), "Missing guarded registration")
        registration = self.module("registration")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'entry $(touch UNEXPECTED) "quoted"'
            root.mkdir()
            (root / "launcher.py").write_text('import json,sys\nprint(json.dumps(sys.argv))\n')
            handler = registration.hook_fragment(sys.executable, root)["hooks"]["Stop"][0]["hooks"][0]
            result = subprocess.run(handler["command"], shell=True, cwd=folder,
                                    input="", text=True, capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout), [str(root / "launcher.py"), "--config", str(root / "config.json"),
                                                       "--diagnostic", str(root / "last-run.json")])
            self.assertFalse((Path(folder) / "UNEXPECTED").exists())

    def test_registration_ownership_accepts_exact_v1_v2_but_not_lookalikes(self):
        self.assertTrue((HERE / "registration.py").is_file(), "Missing registration parser")
        registration = self.module("registration")
        root = Path("/tmp/sy-team-capture-example")
        legacy = [sys.executable, str(root / "launcher.py"), "--config", str(root / "config.json"),
                  "--diagnostic", str(root / "last-run.json")]
        current = registration.hook_fragment(sys.executable, root)["hooks"]["Stop"][0]["hooks"][0]["command"]
        self.assertEqual(registration.launcher_args(current, root), legacy)
        self.assertEqual(registration.launcher_args(shlex.join(legacy), root), legacy)
        self.assertIsNone(registration.launcher_args(shlex.join(legacy + ["--other"]), root))
        self.assertIsNone(registration.launcher_args(current.replace(str(root / "config.json"), "/tmp/other.json"), root))
        self.assertIsNone(registration.launcher_args(current.replace("runpy.run_path", "exec"), root))
        self.assertIsNone(registration.launcher_args(123, root))
        self.assertTrue(hasattr(registration, "current_registration"), "Missing actual registration version check")
        self.assertTrue(registration.current_registration(current, root))
        self.assertFalse(registration.current_registration(shlex.join(legacy), root))

    def test_complete_uninstall_validation_rejects_any_package_residue(self):
        acceptance = self.module("acceptance")
        self.assertTrue(hasattr(acceptance, "validate_uninstalled"), "Missing full-removal validation")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            install = root / "hooks/sy-team-capture"
            (root / "hooks.json").write_text('{"hooks":{}}')
            with patch.object(acceptance, "HOME_DIR", root), patch.object(acceptance, "INSTALL", install):
                acceptance.validate_uninstalled()
                install.mkdir(parents=True)
                (install / "config.json").write_text('{"enabled":false,"member_name":"OLD"}')
                with self.assertRaises(AssertionError):
                    acceptance.validate_uninstalled()


if __name__ == "__main__":
    unittest.main(verbosity=2)
