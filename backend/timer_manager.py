"""
backend/timer_manager.py

Accurate internal time, timer, and alarm system.
Persisted to timers_store.json so timers and alarms survive application restarts.
"""

import json
import os
import time
import uuid
import threading
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

TIMERS_STORE_PATH = os.path.join(os.path.dirname(__file__), "timers_store.json")


class TimerManager:
    def __init__(self, store_path: str = TIMERS_STORE_PATH):
        self.store_path = store_path
        self._lock = threading.Lock()
        self.timers: List[Dict[str, Any]] = self._load()

    def _load(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.store_path):
            return []
        try:
            with open(self.store_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception as e:
            print(f"[TIMERS] Failed to load {self.store_path}: {e}")
            return []

    def _save(self) -> None:
        try:
            with open(self.store_path, "w", encoding="utf-8") as f:
                json.dump(self.timers, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[TIMERS] Failed to save {self.store_path}: {e}")

    def set_timer(self, seconds: int, label: str = "Timer") -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            target_time = now + max(1, seconds)
            timer_id = f"timer_{int(now)}_{uuid.uuid4().hex[:6]}"
            item = {
                "id": timer_id,
                "type": "timer",
                "label": label.strip() or "Timer",
                "seconds": seconds,
                "created_at": now,
                "target_time": target_time,
                "completed": False,
            }
            # Remove any identical active duplicate
            self.timers = [t for t in self.timers if not (t["type"] == "timer" and t["label"] == item["label"] and not t["completed"])]
            self.timers.append(item)
            self._save()
            return item

    def set_alarm(self, target_iso_or_clock: str, label: str = "Alarm") -> Dict[str, Any]:
        """Sets an alarm for a specific time string like '14:30' or ISO timestamp."""
        with self._lock:
            now_dt = datetime.now()
            now_timestamp = now_dt.timestamp()

            target_ts = None
            try:
                # Try clock time e.g. "14:30" or "7:00"
                if ":" in target_iso_or_clock:
                    parts = target_iso_or_clock.strip().split(":")
                    hour = int(parts[0])
                    minute = int(parts[1][:2])
                    alarm_dt = now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    if alarm_dt <= now_dt:
                        # Schedule for tomorrow if the time has already passed today
                        alarm_dt += timedelta(days=1)
                    target_ts = alarm_dt.timestamp()
                else:
                    target_ts = float(target_iso_or_clock)
            except Exception:
                target_ts = now_timestamp + 300  # fallback 5 min

            alarm_id = f"alarm_{int(now_timestamp)}_{uuid.uuid4().hex[:6]}"
            item = {
                "id": alarm_id,
                "type": "alarm",
                "label": label.strip() or "Alarm",
                "created_at": now_timestamp,
                "target_time": target_ts,
                "completed": False,
            }
            self.timers.append(item)
            self._save()
            return item

    def cancel(self, identifier: str) -> bool:
        with self._lock:
            ident = identifier.strip().lower()
            initial_len = len(self.timers)
            self.timers = [
                t for t in self.timers
                if t["id"].lower() != ident and ident not in t["label"].lower()
            ]
            if len(self.timers) < initial_len:
                self._save()
                return True
            return False

    def list_active(self) -> List[Dict[str, Any]]:
        with self._lock:
            now = time.time()
            return [t for t in self.timers if not t.get("completed", False) and t.get("target_time", 0) > now]

    def list_all(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self.timers)

    def check_expired(self) -> List[Dict[str, Any]]:
        """Returns any timers/alarms that have hit their target time and marks them complete."""
        now = time.time()
        expired = []
        with self._lock:
            for t in self.timers:
                if not t.get("completed", False) and t.get("target_time", 0) <= now:
                    t["completed"] = True
                    t["completed_at"] = now
                    expired.append(dict(t))
            if expired:
                self._save()
        return expired


timer_manager = TimerManager()
