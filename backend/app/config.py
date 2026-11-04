"""Application settings (environment-driven, no cloud credentials required)."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
DATA_DIR = REPO_DIR / "data"

DB_PATH = Path(os.getenv("AEROSIM_DB_PATH", str(BACKEND_DIR / "aerosim.db")))
DEMO_SEED = int(os.getenv("AEROSIM_DEMO_SEED", "42"))
MC_DEFAULT_SAMPLES = int(os.getenv("AEROSIM_MC_SAMPLES", "400"))
CORS_ORIGINS = [o.strip() for o in os.getenv("AEROSIM_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")]
APP_VERSION = "0.1.0"
