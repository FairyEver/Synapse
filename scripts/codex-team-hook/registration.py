"""Registration fragment embedded in the operations Markdown; no management CLI."""
from pathlib import Path
import shlex

REGISTRATION_VERSION = 2
MISSING_LAUNCHER_GUARD = '''import runpy, sys
sys.argv = sys.argv[1:]
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
except FileNotFoundError:
    print("{}")
'''


def hook_fragment(python_executable, installation_directory):
    root = Path(installation_directory)
    args = [python_executable, "-I", "-B", "-c", MISSING_LAUNCHER_GUARD,
            str(root / "launcher.py"), "--config", str(root / "config.json"),
            "--diagnostic", str(root / "last-run.json")]
    handler = {"type": "command", "command": shlex.join(args),
               "async": False, "timeout": 15}
    return {"hooks": {event: [{"hooks": [dict(handler)]}]
                      for event in ["UserPromptSubmit", "Stop"]}}


def launcher_args(command, installation_directory):
    """Recognize only this package's exact v1/v2 argument shape, without execution."""
    if not isinstance(command, str):
        return None
    try:
        args = shlex.split(command)
    except (ValueError, TypeError):
        return None
    if args[1:5] == ["-I", "-B", "-c", MISSING_LAUNCHER_GUARD]:
        args = args[:1] + args[5:]
    root = Path(installation_directory)
    expected = [str(root / "launcher.py"), "--config", str(root / "config.json"),
                "--diagnostic", str(root / "last-run.json")]
    return args if len(args) == 6 and args[1:] == expected else None


def current_registration(command, installation_directory):
    args = launcher_args(command, installation_directory)
    return args is not None and shlex.split(command)[1:5] == ["-I", "-B", "-c", MISSING_LAUNCHER_GUARD]
