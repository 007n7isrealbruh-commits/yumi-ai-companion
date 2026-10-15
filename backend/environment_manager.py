"""
backend/environment_manager.py

Environmental awareness system for Yumi:
- Accurate local system time, date, and diurnal phase (morning, afternoon, evening, night).
- Real-time weather and temperature telemetry with in-memory caching (30-min TTL).
- Graceful degradation without data fabrication when offline or unavailable.
"""

import time
import requests
from datetime import datetime
from typing import Dict, Any, Optional

_weather_cache: Optional[Dict[str, Any]] = None
_weather_cache_time: float = 0.0
WEATHER_CACHE_TTL = 1800.0  # 30 minutes


def get_current_time_context() -> Dict[str, Any]:
    now = datetime.now()
    hour = now.hour
    if 5 <= hour < 12:
        phase = "morning"
    elif 12 <= hour < 17:
        phase = "afternoon"
    elif 17 <= hour < 21:
        phase = "evening"
    else:
        phase = "night"

    formatted_time = now.strftime("%I:%M %p").lstrip("0")
    formatted_date = now.strftime("%A, %B %d, %Y")

    return {
        "time": formatted_time,
        "date": formatted_date,
        "phase": phase,
        "iso": now.isoformat(),
    }


def get_weather_telemetry() -> Optional[Dict[str, Any]]:
    global _weather_cache, _weather_cache_time
    now = time.time()

    if _weather_cache is not None and (now - _weather_cache_time) < WEATHER_CACHE_TTL:
        return _weather_cache

    try:
        # Keyless open weather telemetry via wttr.in JSON endpoint
        resp = requests.get("https://wttr.in/?format=j1", timeout=3.5)
        if resp.status_code == 200:
            data = resp.json()
            current = data.get("current_condition", [{}])[0]
            area = data.get("nearest_area", [{}])[0]

            temp_c = current.get("temp_C", "")
            temp_f = current.get("temp_F", "")
            weather_desc = current.get("weatherDesc", [{}])[0].get("value", "")
            humidity = current.get("humidity", "")
            area_name = area.get("areaName", [{}])[0].get("value", "")
            region = area.get("region", [{}])[0].get("value", "")

            result = {
                "temp_c": f"{temp_c}°C" if temp_c else "",
                "temp_f": f"{temp_f}°F" if temp_f else "",
                "condition": weather_desc,
                "humidity": f"{humidity}%" if humidity else "",
                "location": f"{area_name}, {region}".strip(", "),
                "fetched_at": now,
            }
            _weather_cache = result
            _weather_cache_time = now
            return result
    except Exception as e:
        # Graceful degradation without fabricating data
        print(f"[ENVIRONMENT] Weather lookup skipped or failed ({e}). Proceeding without weather context.")

    return _weather_cache  # return stale cache if available, or None


def format_environment_prompt_block() -> str:
    time_ctx = get_current_time_context()
    weather = get_weather_telemetry()

    lines = [
        f"- Current local time: {time_ctx['time']} ({time_ctx['phase']})",
        f"- Today's date: {time_ctx['date']}",
    ]

    if weather and weather.get("temp_c"):
        lines.append(
            f"- Local weather: {weather['condition']}, {weather['temp_c']} / {weather['temp_f']} "
            f"(near {weather['location']})"
        )
    else:
        lines.append("- Weather sensor: currently offline/unavailable (do not fabricate weather data).")

    return "\n".join(lines)
