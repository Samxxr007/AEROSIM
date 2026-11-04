import pytest

from app.db import Database, set_db
from app.services.seed import seed_database


@pytest.fixture()
def db():
    """Seeded fleet with the synthetic history (twins NOT yet initialised)."""
    d = Database(":memory:")
    seed_database(d)
    set_db(d)
    return d


@pytest.fixture()
def db_init(db):
    """Fleet with ENG-MOUNT-001 initialised from its own history."""
    from app.services.twin import replay_history

    replay_history(db, "ENG-MOUNT-001")
    return db


@pytest.fixture()
def client(db):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
