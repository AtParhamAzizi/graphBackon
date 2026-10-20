import time
import unittest
from pathlib import Path
from backend.analyzer import analyze_directory
from backend.main import AnalyzeRequest, health, jobs, node_details, start

class BackendTests(unittest.TestCase):
    def test_file_details_include_its_symbol_relationships(self):
        result = analyze_directory("demo_project")
        file = next(node for node in result["nodes"] if node.get("path") == "app/main.py" and node["kind"] == "file")
        job_id = "test-file-details"
        jobs[job_id] = {"status": "complete", "result": result}
        try:
            relationships = node_details(job_id, file["id"])["relationships"]
            self.assertTrue(any(edge["type"] == "CALLS" and edge["source"] != file["id"] for edge in relationships))
            self.assertTrue(any(edge["type"] == "USES_TYPE" for edge in relationships))
        finally:
            jobs.pop(job_id, None)

    def test_health_and_background_job(self):
        self.assertEqual(health(), {"ok": True})
        job_id = start(AnalyzeRequest(path="demo_project"))["job_id"]
        for _ in range(30):
            if jobs[job_id]["status"] in {"complete", "error"}:
                break
            time.sleep(0.05)
        self.assertEqual(jobs[job_id]["status"], "complete")
        expected_files = len(list(Path("demo_project").rglob("*.py")))
        self.assertEqual(jobs[job_id]["result"]["stats"]["files"], expected_files)

if __name__ == "__main__":
    unittest.main()
