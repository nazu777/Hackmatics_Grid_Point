"""GridPoint per-user workspace persistence (server-side, file-backed JSON).

Why: browser localStorage keeps each account's warehouses, vehicles, demand
nodes and optimizer config on one device only. This module persists the same
workspace per user id on the backend so data survives across sessions,
devices, restarts and serverless cold starts.

- Store: JSON file at GRIDPOINT_DATA_FILE (default backend/data/users.json's
  sibling user_data.json, git-ignored; Vercel: /tmp/gridpoint_user_data.json).
  Best-effort I/O — a missing/corrupt/read-only file degrades to empty
  workspaces, never a 500.
- Shape per user: {updated_at, neighborhoods[], vehicles[], warehouses[],
  config{}} with sanity caps (not full schema validation — the frontend
  already validates; the API re-validates on /api/optimize).
- Long-term production path: Neon Postgres workspace table (same TODO as
  auth users).
"""
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

MAX_NEIGHBORHOODS = 5000
MAX_VEHICLES = 500
MAX_WAREHOUSES = 64
MAX_ASSIGNMENTS = 5000


def _data_file() -> Path:
    override = os.environ.get("GRIDPOINT_DATA_FILE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "data" / "user_data.json"


_WORKSPACES: Dict[str, dict] = {}
_LOADED_FROM: Optional[str] = None


def _ensure_loaded() -> None:
    global _LOADED_FROM
    path = _data_file()
    key = str(path)
    if _LOADED_FROM == key:
        return
    _LOADED_FROM = key
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                for uid, ws in data.items():
                    if isinstance(uid, str) and isinstance(ws, dict):
                        _WORKSPACES.setdefault(uid, ws)
    except Exception:
        pass


def _persist() -> None:
    try:
        path = _data_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_WORKSPACES, indent=2), encoding="utf-8")
    except Exception:
        pass


def empty_workspace() -> Dict[str, Any]:
    return {"updated_at": 0, "neighborhoods": [], "vehicles": [],
            "warehouses": [], "assignments": [], "config": None}


def get_workspace(user_id: str) -> Dict[str, Any]:
    _ensure_loaded()
    ws = _WORKSPACES.get(str(user_id))
    if not isinstance(ws, dict):
        return empty_workspace()
    merged = empty_workspace()
    for k in ("neighborhoods", "vehicles", "warehouses", "assignments"):
        v = ws.get(k)
        merged[k] = v if isinstance(v, list) else []
    cfg = ws.get("config")
    merged["config"] = cfg if isinstance(cfg, dict) else None
    try:
        merged["updated_at"] = float(ws.get("updated_at") or 0)
    except (TypeError, ValueError):
        merged["updated_at"] = 0
    return merged


def _check_list(name: str, value: Any, cap: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, list):
        return f"{name} must be a list"
    if len(value) > cap:
        return f"{name} exceeds {cap} rows"
    for i, row in enumerate(value):
        if not isinstance(row, dict):
            return f"{name}[{i}] must be an object"
    return None


def save_workspace(user_id: str, payload: Dict[str, Any]) -> Tuple[Optional[dict], Optional[str]]:
    """Upsert (partial payloads merge over the stored workspace)."""
    _ensure_loaded()
    if not isinstance(payload, dict):
        return None, "workspace payload must be an object"
    for name, cap in (("neighborhoods", MAX_NEIGHBORHOODS),
                      ("vehicles", MAX_VEHICLES),
                      ("warehouses", MAX_WAREHOUSES),
                      ("assignments", MAX_ASSIGNMENTS)):
        if name in payload:
            err = _check_list(name, payload[name], cap)
            if err:
                return None, err
    if "config" in payload and payload["config"] is not None and not isinstance(payload["config"], dict):
        return None, "config must be an object"
    ws = get_workspace(user_id)
    for name in ("neighborhoods", "vehicles", "warehouses", "assignments"):
        if name in payload and payload[name] is not None:
            ws[name] = payload[name]
    if "config" in payload:
        ws["config"] = payload["config"]
    try:
        ts = float(payload.get("updated_at") or 0)
    except (TypeError, ValueError):
        ts = 0
    ws["updated_at"] = ts if ts > 0 else time.time()
    _WORKSPACES[str(user_id)] = ws
    _persist()
    return ws, None


def clear_workspaces() -> None:
    """Test helper — resets the in-memory cache."""
    _WORKSPACES.clear()
    global _LOADED_FROM
    _LOADED_FROM = None


def workspace_counts(ws: Dict[str, Any]) -> Dict[str, int]:
    return {k: len(ws.get(k) or []) for k in ("neighborhoods", "vehicles", "warehouses", "assignments")}
