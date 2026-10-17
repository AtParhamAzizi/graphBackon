import time
import unittest
from backend.main import AnalyzeRequest, health, jobs, start

class BackendTests(unittest.TestCase):
    def test_health_and_background_job(self):
        self.assertEqual(health(), {"ok": True})
        job_id = start(AnalyzeRequest(path="demo_project"))["job_id"]
        for _ in range(30):
            if jobs[job_id]["status"] in {"complete", "error"}:
                break
            time.sleep(0.05)
        self.assertEqual(jobs[job_id]["status"], "complete")
        self.assertEqual(jobs[job_id]["result"]["stats"]["files"], 4)

if __name__ == "__main__":
    unittest.main()
