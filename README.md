# PyArch Graph

PyArch Graph is a local-first Python architecture explorer. A FastAPI backend reads a directory on the machine where it runs, parses Python with the standard-library AST without importing or executing project code, and exposes a typed graph. The frontend is an animated orbital workspace built entirely with plain HTML, CSS, JavaScript, and inline SVG. No Node.js, frontend packages, build step, or external fonts are needed.

## Architecture

- **Analyzer:** multi-pass AST analysis discovers files, modules, classes, functions, async functions, methods, decorators, signatures, docstrings, source locations, imports, calls, inheritance, route definitions, and outbound HTTP requests.
- **Graph schema:** file nodes, symbol nodes, external endpoint/library nodes, symbol-level evidence edges, containment edges, and aggregated file-level edges.
- **API:** background jobs, progress polling, node relationship details, safe source retrieval, and JSON export.
- **UI:** circular file layout, animated directed connections and ambient orbit effects, searchable file/symbol/dependency views, relationship filters, file-to-symbol drill-down, source snippets, and navigable evidence.

## Relationships

The graph includes containment, imports, calls, class instantiation, function references/callbacks, type annotations (including forward references), decorators, inheritance, method overrides, raised exceptions, routes, and HTTP requests. File-level links aggregate the underlying symbol evidence.

Resolution follows import aliases, dotted module calls, package-relative imports and re-exports, standard `src/` layouts, nested function scopes, `self`/`cls`, inherited methods, `super()`, constructor-assigned instances, annotated parameters, and annotated factory returns. Imported constants and unresolved type aliases retain their defining file dependencies. Unknown dynamic calls remain visibly unresolved rather than being linked to unrelated functions with the same name.

After scanning, switch from **Files** to **Files + symbols + dependencies** to see function-to-function and file-to-symbol links, including relationships within one file. Files sit on the outer circle; symbols and external dependencies occupy inner rings. Drag the canvas to pan, scroll to zoom, and use **Fit graph** to reset the view. Hover a link for its type and direction. Select a file or symbol to inspect all matching relationships; expand an evidence row for its source expression. Relationship filters apply to both the graph and inspector.

Use **Focus connections** to isolate the selected node, **Expand graph workspace** for more canvas space, and the theme toggle for light or dark mode. **Live motion** pauses or resumes arrow flows, orbit tracers, and background animation. System reduced-motion preferences are respected automatically. Keyboard shortcuts: `/` searches, `Esc` clears selection, and `+`, `-`, `0`, and `Space` zoom, fit, or pause while the canvas is focused. On small screens, use **Toggle project explorer** to open the file list and filters.

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

The launcher starts FastAPI, serves `frontend/index.html`, prints `http://127.0.0.1:8000`, and opens the browser automatically. Choose **Explore the demo project**, or enter a directory path belonging to the backend machine, for example `C:\Users\you\project` or `demo_project`.

## Demo

`demo_project` is a 25-file user-management application covering all 12 relationship types across routes, services, repositories, clients, models, decorators, events, reports, workflows, jobs, and plugins. It includes nested functions, recursion, callbacks, method overrides, package re-exports, and intentionally unresolved dynamic dispatch. See `demo_project/README.md` for the relationship examples and optional API setup.

Run its standard-library-only offline walkthrough without making network requests:

```powershell
python -B demo_project/run_demo.py
```

## Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

With the server running, open `http://127.0.0.1:8000/tests/graph.test.html` for the frontend checks. This native-browser test page exercises the real interface using plain JavaScript, including circular geometry, directed animation, filtering, search, inspection, camera controls, motion preferences, themes, and keyboard access. No test packages or Node.js are required.

## Safety and limitations

The scanner never imports or executes analyzed code, installs dependencies, follows symlinks outside the root, or sends source to external services. It skips virtual environments, VCS metadata, caches, build outputs, dependency folders, files matched by `.gitignore`, symlinks, oversized files, and syntax-error files while reporting warnings.

Bindings and receiver types are static approximations, not runtime traces. Conditional rebinding, multiple-inheritance dispatch order, wildcard exports, and arbitrary dynamic factories cannot be fully resolved; external constructor receivers are inferred from class-style names.
