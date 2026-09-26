"""
backend/pc_actions.py

"PC control", scoped down to something actually safe to wire up to an LLM
that also has vision (screen/webcam) and web search.

WHY THIS IS AN ALLOWLIST AND NOT "LET HER RUN COMMANDS":
Gemini's output is, in part, downstream of what it reads off your screen
or the web. If this module let the model pass through an arbitrary
command string, then anything malicious sitting in a webpage, an image,
or a chat message the model reads becomes something that can quietly
execute code on your machine — a classic prompt-injection-to-RCE path.
Restricting the model to picking a NAME from a fixed list defined here
(never a value it invents) closes that off: the worst it can do is
trigger an action YOU pre-approved and wrote yourself.

HOW TO ADD YOUR OWN ACTIONS
Add an entry to ACTIONS below: a short NAME (what Yumi will say/tag), and
either a `command` (list of args, passed straight to subprocess — never a
shell string, so no shell-injection surface either) or a `url` to open in
the default browser. Keep each action single-purpose.
"""

import subprocess
import webbrowser
from typing import Dict, List, Optional, TypedDict


class ActionDef(TypedDict, total=False):
    command: List[str]
    url: str
    description: str


# =============================================================================
# EDIT THIS — add/remove actions here. Nothing else in the app needs to
# change; build_system_prompt() and the server both just read this dict.
# =============================================================================
ACTIONS: Dict[str, ActionDef] = {
    # "open_notepad": {"command": ["notepad.exe"], "description": "Opens Notepad (Windows)"},
    # "open_browser": {"url": "https://www.google.com", "description": "Opens the browser"},
    # "play_pause_media": {"command": ["playerctl", "play-pause"], "description": "Toggles media playback (Linux/playerctl)"},
    # "volume_up": {"command": ["osascript", "-e", "set volume output volume ((output volume of (get volume settings)) + 10)"], "description": "Raises system volume (macOS)"},
}
# =============================================================================


def available_action_names() -> List[str]:
    return list(ACTIONS.keys())


def execute_action(name: str) -> Optional[str]:
    """Runs a pre-approved action by exact name. Returns a short status
    string on success, or None if the name isn't in the allowlist (which
    the model should never produce, since build_system_prompt only ever
    tells it about names from this same dict — but we check again here
    regardless, since a prompt is not a security boundary)."""
    action = ACTIONS.get(name)
    if action is None:
        print(f"[PC_ACTIONS] Ignored unknown action name: {name!r} (not in allowlist).")
        return None

    try:
        if "url" in action:
            webbrowser.open(action["url"])
            return f"Opened {action['url']}"
        if "command" in action:
            # No shell=True, ever — command is a fixed arg list from this
            # file, not a string the model could inject flags/operators into.
            subprocess.Popen(action["command"])
            return f"Ran: {' '.join(action['command'])}"
    except Exception as e:
        print(f"[PC_ACTIONS] Action {name!r} failed: {e}")
        return None

    return None
