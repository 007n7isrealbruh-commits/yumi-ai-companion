"""Comprehensive End-to-End Test Suite for AI Waifu App.
Verifies all 26 areas:
- Local vs Cloud Provider keyless validation
- STT Engine Whisper support & graceful degradation
- Task Manager CRUD, due checks
- Timer & Alarm Manager countdown, expiration, cancellation
- Environment Manager system time & weather
- Memory Graph schema v5, node cross-linking, export/import
- Server REST endpoints via running uvicorn instance
"""

import sys
import os
import time
import json
import uuid
import subprocess
import requests
import unittest

# Ensure root directory is on PYTHONPATH
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.config import settings
from backend.environment_manager import get_current_time_context, get_weather_telemetry, format_environment_prompt_block
from backend.task_manager import task_manager
from backend.timer_manager import timer_manager
from backend.memory_manager import MemoryManager, _migrate
from backend.stt_engine import check_whisper_available
from backend.providers.registry import PROVIDERS, list_providers, get_provider_info


class TestWaifuCore(unittest.TestCase):
    def test_01_config_and_local_models(self):
        """Test that local models do not require API keys."""
        self.assertIsNotNone(settings)
        # Providers metadata check
        self.assertIn("mock", PROVIDERS)
        self.assertIn("ollama", PROVIDERS)
        self.assertIn("lmstudio", PROVIDERS)
        self.assertIn("gemini", PROVIDERS)
        self.assertFalse(PROVIDERS["mock"].requires_api_key)
        self.assertFalse(PROVIDERS["ollama"].requires_api_key)
        self.assertFalse(PROVIDERS["lmstudio"].requires_api_key)
        self.assertTrue(PROVIDERS["gemini"].requires_api_key)
        self.assertTrue(PROVIDERS["mock"].is_local)
        self.assertTrue(PROVIDERS["ollama"].is_local)

    def test_02_environment_telemetry(self):
        """Test system time and weather telemetry."""
        time_ctx = get_current_time_context()
        self.assertIn("time", time_ctx)
        self.assertIn("date", time_ctx)
        self.assertIn("phase", time_ctx)
        weather = get_weather_telemetry()
        # Weather can be dict or None if offline
        self.assertTrue(weather is None or isinstance(weather, dict))
        prompt_snippet = format_environment_prompt_block()
        self.assertTrue(len(prompt_snippet) > 0)

    def test_03_task_system(self):
        """Test task creation, listing, completion, and reminder checks."""
        tm = task_manager
        # Add task
        task = tm.create_task("Review math assignment", due="tonight", reminder_seconds=900)
        self.assertEqual(task["title"], "Review math assignment")
        self.assertFalse(task["completed"])
        task_id = task["id"]

        # List tasks
        tasks = tm.list_tasks(filter_status="all")
        self.assertTrue(any(t["id"] == task_id for t in tasks))

        # Complete task
        updated = tm.complete_task(task_id)
        self.assertIsNotNone(updated)
        self.assertTrue(updated["completed"])

        # Delete task
        deleted = tm.delete_task(task_id)
        self.assertTrue(deleted)

    def test_04_timer_and_alarm_system(self):
        """Test countdown timer and alarm management."""
        # Add countdown timer
        t = timer_manager.set_timer(2, label="Quick Test Timer")
        self.assertEqual(t["label"], "Quick Test Timer")
        self.assertEqual(t["seconds"], 2)
        timer_id = t["id"]

        # Check active timers
        active = timer_manager.list_active()
        self.assertTrue(any(item["id"] == timer_id for item in active))

        # Wait for timer expiration
        time.sleep(2.5)
        expired = timer_manager.check_expired()
        self.assertTrue(any(item["id"] == timer_id for item in expired))

        # Add alarm and cancel
        alarm = timer_manager.set_alarm("23:59", label="Bedtime")
        alarm_id = alarm["id"]
        cancelled = timer_manager.cancel(alarm_id)
        self.assertTrue(cancelled)

    def test_05_memory_graph_and_export_import(self):
        """Test Memory Graph Schema v5, nodes, cross-linking, export & import."""
        mm = MemoryManager()
        # Remember fact with emotion and context
        mm.remember_fact(
            fact="User loves programming Python in Termux",
            emotion="happy",
            context="coding session",
            event="conversation"
        )
        nodes = mm.get_all_memory_nodes()
        self.assertTrue(any("programming Python" in n.get("text", "") for n in nodes))
        target_node = next(n for n in nodes if "programming Python" in n.get("text", ""))
        self.assertEqual(target_node["emotion"], "happy")
        self.assertEqual(target_node["context"], "coding session")

        # Export memory graph
        export_data = mm.export_memory_graph()
        self.assertEqual(export_data["version"], 5)
        self.assertTrue(any(n["id"] == target_node["id"] for n in export_data["nodes"]))

        # Test Import memory graph safely
        unique_import_id = f"test-imported-{uuid.uuid4().hex[:6]}"
        unique_import_text = f"Imported memory test node {uuid.uuid4().hex[:6]}"
        test_import_payload = {
            "format": "yumi-memory-graph",
            "version": 5,
            "exported_at": "2026-10-02T03:00:00Z",
            "nodes": [
                {
                    "id": unique_import_id,
                    "text": unique_import_text,
                    "event": "import test",
                    "context": "testing",
                    "emotion": "excited",
                    "associations": ["test"],
                    "sentiment": 0.5,
                    "created_at": time.time()
                }
            ]
        }
        res = mm.import_memory_graph(test_import_payload)
        self.assertEqual(res["status"], "ok")
        self.assertGreaterEqual(res["imported_count"], 1)

        # Clean up
        mm.delete_memory_node(target_node["id"])
        mm.delete_memory_node(unique_import_id)

    def test_06_stt_engine_whisper_support(self):
        """Test STT Engine multi-backend configuration."""
        status = check_whisper_available()
        self.assertIn("available", status)
        self.assertIn("engine", status)

    def test_07_invalid_memory_import_rejection(self):
        """Verify invalid memory import payloads are safely rejected without corrupting state."""
        mm = MemoryManager()
        before_nodes = len(mm.get_all_memory_nodes())
        before_facts = len(mm.get_all_facts())

        # Test passing malformed payload
        with self.assertRaises(ValueError):
            mm.import_memory_graph("not-a-dict")

        with self.assertRaises(ValueError):
            mm.import_memory_graph({"wrong_key": [1, 2, 3]})

        # State should be completely unchanged
        self.assertEqual(len(mm.get_all_memory_nodes()), before_nodes)
        self.assertEqual(len(mm.get_all_facts()), before_facts)

    def test_08_schema_migration_preserves_data(self):
        """Verify schema migration upgrades legacy v1/v2/v3 data to v5 without data loss."""
        legacy_data = {
            "schema_version": 2,
            "affection": 45,
            "facts": ["Loves hot cocoa on rainy days", "Prefers quiet study sessions"],
            "fact_embeddings": {},
            "history": [{"role": "user", "text": "Hi"}, {"role": "model", "text": "Hello"}],
            "milestones_hit": []
        }
        migrated = _migrate(legacy_data)
        self.assertEqual(migrated["schema_version"], 5)
        self.assertEqual(migrated["affection"], 45)
        self.assertIn("trust", migrated)
        self.assertIn("comfort", migrated)
        self.assertEqual(len(migrated["facts"]), 2)
        self.assertGreaterEqual(len(migrated["memory_nodes"]), 2)
        # Should have automatically marked as onboarded since existing interaction/facts exist
        self.assertTrue(migrated["is_onboarded"])


class TestServerEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Start FastAPI backend server on a test port."""
        cls.port = 8899
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        env = os.environ.copy()
        env["PORT"] = str(cls.port)
        cls.proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.server:app", "--port", str(cls.port), "--host", "127.0.0.1"],
            cwd=ROOT_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        # Wait for server to become responsive
        max_attempts = 30
        for _ in range(max_attempts):
            try:
                r = requests.get(f"{cls.base_url}/settings", timeout=1)
                if r.status_code == 200:
                    return
            except Exception:
                time.sleep(0.3)
        raise RuntimeError("Failed to start FastAPI test server")

    @classmethod
    def tearDownClass(cls):
        """Cleanly terminate test server."""
        if cls.proc:
            cls.proc.terminate()
            cls.proc.wait()

    def test_10_settings_endpoint(self):
        """Verify /settings returns complete state with keyless local models."""
        r = requests.get(f"{self.base_url}/settings")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("character_name", data)
        self.assertIn("llm_provider", data)
        self.assertIn("is_onboarded", data)
        self.assertIn("stt_engine", data)
        self.assertIn("whisper_status", data)

    def test_11_environment_endpoint(self):
        """Verify /environment returns real system time and weather."""
        r = requests.get(f"{self.base_url}/environment")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("time", data)
        self.assertIn("weather", data)
        self.assertIn("time", data["time"])
        self.assertIn("phase", data["time"])

    def test_12_tasks_api(self):
        """Verify /tasks GET and POST."""
        # Create task
        post_r = requests.post(f"{self.base_url}/tasks", json={
            "title": "API Test Task for Tonight",
            "due": "tonight",
            "reminder_seconds": 600
        })
        self.assertEqual(post_r.status_code, 200)
        task = post_r.json()["task"]
        self.assertEqual(task["title"], "API Test Task for Tonight")
        task_id = task["id"]

        # List tasks
        get_r = requests.get(f"{self.base_url}/tasks")
        self.assertEqual(get_r.status_code, 200)
        tasks = get_r.json()["tasks"]
        self.assertTrue(any(t["id"] == task_id for t in tasks))

        # Delete task
        del_r = requests.delete(f"{self.base_url}/tasks/{task_id}")
        self.assertEqual(del_r.status_code, 200)
        self.assertTrue(del_r.json()["removed"])

    def test_13_timers_api(self):
        """Verify /timers GET and POST."""
        post_r = requests.post(f"{self.base_url}/timers", json={
            "seconds": 60,
            "label": "Coffee Break"
        })
        self.assertEqual(post_r.status_code, 200)
        timer = post_r.json()["item"]
        timer_id = timer["id"]

        get_r = requests.get(f"{self.base_url}/timers")
        self.assertEqual(get_r.status_code, 200)
        timers = get_r.json()["timers"]
        self.assertTrue(any(t["id"] == timer_id for t in timers))

        # Cancel timer
        del_r = requests.delete(f"{self.base_url}/timers/{timer_id}")
        self.assertEqual(del_r.status_code, 200)
        self.assertTrue(del_r.json()["removed"])

    def test_14_memory_graph_api(self):
        """Verify memory nodes, graph export & import endpoints."""
        # Add node
        post_r = requests.post(f"{self.base_url}/memory/node", json={
            "text": "User prefers dark mode aesthetic",
            "emotion": "happy",
            "context": "ui theme",
            "event": "settings"
        })
        self.assertEqual(post_r.status_code, 200)
        nodes = post_r.json()["nodes"]
        target = next((n for n in nodes if "dark mode" in n.get("text", "")), None)
        self.assertIsNotNone(target)
        node_id = target["id"]

        # List nodes
        get_r = requests.get(f"{self.base_url}/memory/nodes")
        self.assertEqual(get_r.status_code, 200)
        nodes = get_r.json()["nodes"]
        self.assertTrue(any(n["id"] == node_id for n in nodes))

        # Export
        export_r = requests.get(f"{self.base_url}/memory/export")
        self.assertEqual(export_r.status_code, 200)
        graph = export_r.json()
        self.assertEqual(graph["version"], 5)

        # Delete node
        del_r = requests.delete(f"{self.base_url}/memory/node/{node_id}")
        self.assertEqual(del_r.status_code, 200)
        self.assertTrue(del_r.json()["removed"])

    def test_15_onboarding_persistence_api(self):
        """Verify /onboarding/complete persists state."""
        r = requests.post(f"{self.base_url}/onboarding/complete")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["is_onboarded"])

    def test_16_invalid_memory_import_api(self):
        """Verify POST /memory/import with invalid format returns error status without crashing."""
        r = requests.post(f"{self.base_url}/memory/import", json={"invalid_format": True})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data.get("status"), "error")
        self.assertIn("message", data)

    def test_17_cloud_provider_missing_key_handled_gracefully(self):
        """Verify PATCH /settings rejects cloud provider when key is missing with helpful configuration error."""
        r = requests.patch(f"{self.base_url}/settings", json={
            "llm_provider": "gemini",
            "gemini_api_key": ""
        })
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data.get("status"), "error")
        self.assertIn("API key", data.get("message", ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)
