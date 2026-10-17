import tempfile
import unittest
from pathlib import Path
from backend.analyzer import analyze_directory

class AnalyzerTests(unittest.TestCase):
    def setUp(self):
        self.demo = Path(__file__).parents[2] / "demo_project"

    def test_demo_relationship_types_and_resolution(self):
        result = analyze_directory(str(self.demo))
        self.assertGreaterEqual(result["stats"]["files"], 4)
        kinds = {edge["type"] for edge in result["edges"]}
        self.assertTrue({"IMPORTS","CALLS","INHERITS","DEFINES_ROUTE","HTTP_REQUEST"} <= kinds)
        self.assertTrue(any(edge["status"] == "resolved" and edge["type"] == "CALLS" for edge in result["edges"]))
        self.assertGreater(result["stats"]["file_edges"], 0)

    def test_exclusions_and_gitignore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src").mkdir()
            (root / "venv").mkdir()
            (root / ".gitignore").write_text("ignored.py\n", encoding="utf-8")
            (root / "src" / "ok.py").write_text("def ok():\n    return 1\n", encoding="utf-8")
            (root / "venv" / "skip.py").write_text("def skip():\n    return 2\n", encoding="utf-8")
            (root / "ignored.py").write_text("def ignored():\n    return 3\n", encoding="utf-8")
            result = analyze_directory(directory)
            paths = {node["path"] for node in result["nodes"] if node["kind"] == "file"}
            self.assertEqual(paths, {"src/ok.py"})

    def test_syntax_error_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "good.py").write_text("def good():\n    return 1\n", encoding="utf-8")
            (root / "bad.py").write_text("def broken(:\n", encoding="utf-8")
            result = analyze_directory(directory)
            self.assertEqual(result["stats"]["files"], 1)
            self.assertTrue(any(w["code"] == "SYNTAX_ERROR" for w in result["warnings"]))

    def test_missing_directory(self):
        with self.assertRaises(ValueError):
            analyze_directory(str(self.demo / "missing"))

    def test_source_path_traversal_is_rejected_by_path_logic(self):
        root = self.demo.resolve()
        candidate = (root / ".." / "secret.py").resolve()
        with self.assertRaises(ValueError):
            candidate.relative_to(root)

if __name__ == "__main__":
    unittest.main()
