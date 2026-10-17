from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
if not PYTHON.exists():
    PYTHON = Path(sys.executable)

def main() -> int:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        print("npm was not found. Install Node.js LTS, then run this command again.")
        return 1

    backend = subprocess.Popen(
        [str(PYTHON), "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=ROOT,
    )
    frontend = subprocess.Popen(
        [npm, "run", "dev", "--", "--host", "127.0.0.1"],
        cwd=ROOT / "frontend",
        shell=False,
    )
    print("")
    print("PyArch Graph is starting")
    print("  Backend:  http://127.0.0.1:8000")
    print("  Frontend: http://127.0.0.1:5173")
    print("  Enter a path from this computer, such as ..\\demo_project")
    print("  Press Ctrl+C to stop both servers")
    print("")
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:5173")
    try:
        while True:
            if backend.poll() is not None:
                print("Backend stopped unexpectedly.")
                break
            if frontend.poll() is not None:
                print("Frontend stopped unexpectedly.")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping PyArch Graph...")
    finally:
        for process in (frontend, backend):
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
                else:
                    process.terminate()
        for process in (frontend, backend):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

