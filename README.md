# PyArch Graph

PyArch Graph is a local-first Python architecture explorer. A FastAPI backend reads a directory on the machine where it runs, parses Python with the standard-library AST without importing or executing project code, and exposes a typed graph. The frontend is a plain HTML, CSS, and JavaScript application served by FastAPI as a readable 2D file map.

## Architecture

- **Analyzer:** two-pass AST analysis discovers files, modules, classes, functions, async functions, methods, decorators, signatures, docstrings, source locations, imports, calls, inheritance, route definitions, and outbound HTTP requests.
- **Graph schema:** file nodes, symbol nodes, external endpoint/library nodes, symbol-level evidence edges, containment edges, and aggregated file-level edges.
- **API:** background jobs, progress polling, node relationship details, safe source retrieval, and JSON export.
- **UI:** static HTML/CSS/JavaScript workspace with a searchable 2D file map, relationship filters, file-to-symbol drill-down, source snippets, and evidence.

## Run locally

From the repository root, install the backend once:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

Then start everything with:

```powershell
python app.py
```

The launcher starts FastAPI, serves `frontend/index.html`, prints `http://127.0.0.1:8000`, and opens the browser automatically. Enter a directory path belonging to the backend machine, for example `C:\Users\you\project` or `..\demo_project`.

## Demo

`demo_project` contains package-relative imports and aliases, cross-file async calls, classes and inheritance, a FastAPI-style route, an outbound `httpx` request, and an unresolved dynamic call.

## Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

## Safety and limitations

The scanner never imports or executes analyzed code, installs dependencies, follows symlinks outside the root, or sends source to external services. It skips virtual environments, VCS metadata, caches, build outputs, dependency folders, files matched by `.gitignore`, symlinks, oversized files, and syntax-error files while reporting warnings.
