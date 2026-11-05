"""
Lightweight SQLite JSON-document repository.

Each collection is a table (id TEXT PRIMARY KEY, created_at, updated_at, doc JSON).
This keeps persistence simple and auditable for a prototype while still being
a real on-disk database that survives restarts.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COLLECTIONS = [
    "aircraft",
    "components",
    "flights",
    "maintenance",
    "predictions",
    "scenarios",
    "simulation_runs",
    "flight_records",
    "reconciliations",
    "inspections",
    "model_updates",
    "ground_truth",
    "settings",
    "activity",
    "imports",
    "operational_records",
    "load_histories",
    "component_identity_events",
    "data_trust_decisions",
    "rul_calibration_records",
    "federated_rounds",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        with self._lock:
            for c in COLLECTIONS:
                self._conn.execute(
                    f"CREATE TABLE IF NOT EXISTS {c} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, doc TEXT NOT NULL)"
                )
            self._conn.commit()

    # -------------------------------------------------------------- CRUD
    def insert(self, collection: str, doc: dict[str, Any], id_prefix: str | None = None) -> dict[str, Any]:
        self._check(collection)
        doc = sanitize(dict(doc))
        doc.setdefault("id", new_id(id_prefix or collection[:3]))
        ts = now_iso()
        doc.setdefault("created_at", ts)
        doc["updated_at"] = ts
        doc.setdefault("seq", time.time_ns())
        with self._lock:
            self._conn.execute(
                f"INSERT INTO {collection} (id, created_at, updated_at, doc) VALUES (?,?,?,?)",
                (doc["id"], doc["created_at"], doc["updated_at"], json.dumps(doc, default=_json_default)),
            )
            self._conn.commit()
        return doc

    def upsert(self, collection: str, doc: dict[str, Any]) -> dict[str, Any]:
        self._check(collection)
        if "id" not in doc:
            return self.insert(collection, doc)
        existing = self.get(collection, doc["id"])
        doc = sanitize(dict(doc))
        ts = now_iso()
        doc["created_at"] = existing["created_at"] if existing else doc.get("created_at", ts)
        doc["updated_at"] = ts
        doc.setdefault("seq", existing["seq"] if existing and "seq" in existing else time.time_ns())
        with self._lock:
            self._conn.execute(
                f"INSERT INTO {collection} (id, created_at, updated_at, doc) VALUES (?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, doc=excluded.doc",
                (doc["id"], doc["created_at"], doc["updated_at"], json.dumps(doc, default=_json_default)),
            )
            self._conn.commit()
        return doc

    def get(self, collection: str, id_: str) -> dict[str, Any] | None:
        self._check(collection)
        with self._lock:
            row = self._conn.execute(f"SELECT doc FROM {collection} WHERE id=?", (id_,)).fetchone()
        return json.loads(row["doc"]) if row else None

    def list(self, collection: str, where: dict[str, Any] | None = None, limit: int | None = None, newest_first: bool = False) -> list[dict[str, Any]]:
        self._check(collection)
        order = "DESC" if newest_first else "ASC"
        clauses: list[str] = []
        params: list[Any] = []
        for k, v in (where or {}).items():
            if v is None:
                clauses.append(f"json_extract(doc, '$.{k}') IS NULL")
            elif isinstance(v, bool):
                clauses.append(f"json_extract(doc, '$.{k}') = ?"); params.append(1 if v else 0)
            else:
                clauses.append(f"json_extract(doc, '$.{k}') = ?"); params.append(v)
        sql = f"SELECT doc FROM {collection}" + (" WHERE " + " AND ".join(clauses) if clauses else "") + f" ORDER BY rowid {order}" + (f" LIMIT {int(limit)}" if limit else "")
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [json.loads(r["doc"]) for r in rows]

    def list_fields(self, collection: str, fields: list[str], where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Return only selected top-level fields (via json_extract) without decoding whole documents."""
        self._check(collection)
        clauses: list[str] = []
        params: list[Any] = []
        for k, v in (where or {}).items():
            clauses.append(f"json_extract(doc, '$.{k}') = ?"); params.append(v)
        sel = ", ".join(f"json_extract(doc, '$.{f}') AS \"{f}\"" for f in fields)
        sql = f"SELECT {sel} FROM {collection}" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY rowid ASC"
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def delete(self, collection: str, id_: str) -> bool:
        self._check(collection)
        with self._lock:
            cur = self._conn.execute(f"DELETE FROM {collection} WHERE id=?", (id_,))
            self._conn.commit()
        return cur.rowcount > 0

    def count(self, collection: str) -> int:
        self._check(collection)
        with self._lock:
            return self._conn.execute(f"SELECT COUNT(*) FROM {collection}").fetchone()[0]

    def clear_all(self) -> None:
        with self._lock:
            for c in COLLECTIONS:
                self._conn.execute(f"DELETE FROM {c}")
            self._conn.commit()

    def log_activity(self, kind: str, message: str, ref: dict[str, Any] | None = None) -> None:
        self.insert("activity", {"kind": kind, "message": message, "ref": ref or {}}, "act")

    def _check(self, collection: str) -> None:
        if collection not in COLLECTIONS:
            raise KeyError(f"Unknown collection {collection}")


def sanitize(o: Any) -> Any:
    """Recursively convert numpy scalars/arrays and non-finite floats into JSON-safe values (fast paths for flat lists)."""
    if isinstance(o, dict):
        return {str(k): sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        out = []
        for v in o:
            t = type(v)
            if t is float:
                out.append(None if (v != v or v in _INF) else v)
            elif t is int or t is str or v is None or t is bool:
                out.append(v)
            else:
                out.append(sanitize(v))
        return out
    if hasattr(o, "tolist") and not isinstance(o, (str, bytes)):
        return sanitize(o.tolist())
    if isinstance(o, bool):
        return o
    if isinstance(o, float):
        return None if (o != o or o in _INF) else o
    if hasattr(o, "item"):
        return sanitize(o.item())
    return o


_INF = (float("inf"), float("-inf"))


def _json_default(o: Any):
    if isinstance(o, float) and (o != o):
        return None
    if hasattr(o, "tolist"):
        return o.tolist()
    if hasattr(o, "__dict__"):
        return o.__dict__
    return str(o)


_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        from .config import DB_PATH

        _db = Database(DB_PATH)
    return _db


def set_db(db: Database) -> None:
    global _db
    _db = db
