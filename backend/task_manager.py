"""
backend/task_manager.py

Persistent task and reminder management system.
Supports natural language commands from conversation (create, complete, list, remove, edit)
as well as direct UI management. Persisted to tasks_store.json.
"""

import json
import os
import time
import uuid
import threading
from typing import List, Dict, Any, Optional

TASKS_STORE_PATH = os.path.join(os.path.dirname(__file__), "tasks_store.json")


class TaskManager:
    def __init__(self, store_path: str = TASKS_STORE_PATH):
        self.store_path = store_path
        self._lock = threading.Lock()
        self.tasks: List[Dict[str, Any]] = self._load()

    def _load(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.store_path):
            return []
        try:
            with open(self.store_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception as e:
            print(f"[TASKS] Failed to load {self.store_path}: {e}")
            return []

    def _save(self) -> None:
        try:
            with open(self.store_path, "w", encoding="utf-8") as f:
                json.dump(self.tasks, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[TASKS] Failed to save {self.store_path}: {e}")

    def create_task(self, title: str, due: Optional[str] = None, reminder_seconds: Optional[int] = None, notes: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            task_id = f"task_{int(now)}_{uuid.uuid4().hex[:6]}"
            reminder_time = (now + reminder_seconds) if reminder_seconds and reminder_seconds > 0 else None
            task = {
                "id": task_id,
                "title": title.strip(),
                "due": due.strip() if due else "",
                "notes": notes.strip() if notes else "",
                "completed": False,
                "created_at": now,
                "reminder_time": reminder_time,
                "reminder_sent": False,
            }
            self.tasks.append(task)
            self._save()
            return task

    def list_tasks(self, filter_status: str = "all") -> List[Dict[str, Any]]:
        with self._lock:
            if filter_status == "pending":
                return [t for t in self.tasks if not t.get("completed", False)]
            elif filter_status == "completed":
                return [t for t in self.tasks if t.get("completed", False)]
            return list(self.tasks)

    def complete_task(self, identifier: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            target = self._find_task(identifier)
            if target:
                target["completed"] = True
                target["completed_at"] = time.time()
                self._save()
                return target
            return None

    def remove_task(self, identifier: str) -> bool:
        with self._lock:
            target = self._find_task(identifier)
            if target:
                self.tasks.remove(target)
                self._save()
                return True
            return False

    def delete_task(self, identifier: str) -> bool:
        return self.remove_task(identifier)

    def edit_task(self, identifier: str, title: Optional[str] = None, due: Optional[str] = None, notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            target = self._find_task(identifier)
            if target:
                if title is not None:
                    target["title"] = title.strip()
                if due is not None:
                    target["due"] = due.strip()
                if notes is not None:
                    target["notes"] = notes.strip()
                self._save()
                return target
            return None

    def _find_task(self, identifier: str) -> Optional[Dict[str, Any]]:
        ident = identifier.strip().lower()
        # Try match by exact ID
        for t in self.tasks:
            if t["id"].lower() == ident:
                return t
        # Try match by title substring
        for t in self.tasks:
            if ident in t["title"].lower() or t["title"].lower() in ident:
                return t
        return None

    def check_due_reminders(self) -> List[Dict[str, Any]]:
        due_now = []
        now = time.time()
        with self._lock:
            for t in self.tasks:
                if not t.get("completed", False) and not t.get("reminder_sent", False):
                    rem_time = t.get("reminder_time")
                    if rem_time and rem_time <= now:
                        t["reminder_sent"] = True
                        due_now.append(dict(t))
            if due_now:
                self._save()
        return due_now


# Global instance
task_manager = TaskManager()
