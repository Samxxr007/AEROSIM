"""Vercel Serverless Function entrypoint for AeroSim FastAPI backend."""
from __future__ import annotations

import sys
from pathlib import Path

# Add backend directory and repo root to sys.path
_CURRENT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _CURRENT_DIR.parent
_BACKEND_DIR = _REPO_ROOT / "backend"

for _p in (str(_BACKEND_DIR), str(_REPO_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.main import app  # noqa: E402

__all__ = ["app"]
