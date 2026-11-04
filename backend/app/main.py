"""AeroSim backend — FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import APP_VERSION, CORS_ORIGINS
from .db import get_db
from .services.seed import seed_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_database(get_db())
    yield


app = FastAPI(
    title="AeroSim API",
    version=APP_VERSION,
    description="Mission-aware, self-evolving aircraft component digital twin — research and engineering demonstration prototype. "
    "Outputs are model-based estimates and must not be used as substitutes for approved maintenance procedures, certified engineering analysis or airworthiness decisions.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS + ["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router, prefix="/api")


@app.get("/")
def root():
    return {"name": "AeroSim API", "version": APP_VERSION, "docs": "/docs", "api": "/api"}
