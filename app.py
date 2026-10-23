from __future__ import annotations

import os
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
if not PYTHON.exists():
    PYTHON = Path(sys.executable)
FRONTENDS = {"1": ("frontend", "Full UI - orbital graph, rich visuals"), "2": ("frontendlow", "Lite UI - liquid glass, lightweight")}


def choose_frontend() -> str:
    for arg in sys.argv[1:]:
        if arg.startswith("--ui="):
            return arg.split("=", 1)[1]
    print("Which front end do you want to load?")
    for key, (folder, description) in FRONTENDS.items():
        print(f"  [{key}] {folder:<12} {description}")
    while True:
        try:
            answer = input("Choose 1 or 2 [1]: ").strip() or "1"
        except EOFError:
            answer = "1"
        if answer in FRONTENDS:
            return FRONTENDS[answer][0]
        print("Please enter 1 or 2.")


def main() -> int:
    frontend = choose_frontend()
    backend = subprocess.Popen(
        [str(PYTHON), "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=ROOT,
        env={**os.environ, "PYARCH_FRONTEND": frontend},
    )
    print("")
    print("PyArch Graph is starting")
    print("  App:      http://127.0.0.1:8000")
    print(f"  UI:       {frontend}")
    print("  Enter a path from this computer, such as ..\\demo_project")
    print("  Press Ctrl+C to stop the server")
    print("")
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:8000")
    try:
        while backend.poll() is None:
            time.sleep(1)
        print("Server stopped unexpectedly.")
    except KeyboardInterrupt:
        print("\nStopping PyArchg Graph...")
    finally:
        if backend.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(backend.pid), "/T", "/F"], capture_output=True)
            else:
                backend.terminate()
        try:
            backend.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
