import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_tmp = tempfile.mkdtemp(prefix="jobserver-test-")
os.environ["JOBSERVER_DATA"] = _tmp
os.environ["JOBSERVER_DB"] = os.path.join(_tmp, "test.sqlite")
os.environ["JOBSERVER_NO_SCHEDULER"] = "1"
os.environ["JOBSERVER_API_KEY"] = "test-key"
os.environ["JOBSERVER_PAGE_DELAY"] = "0"
os.environ["JOBSERVER_MIN_SCORE"] = "10"

import pytest  # noqa: E402

from jobserver import db, portals  # noqa: E402
from jobserver.portals.base import Job, Portal, SearchQuery  # noqa: E402


class FakePortal(Portal):
    """A login-free portal that answers from memory, so runs can be tested without a browser."""
    key = "fake"
    name = "Fake board"
    home_url = "https://fake.example/"
    needs_account = False
    supports_requests = True
    jobs: list[dict] = []
    calls: list[SearchQuery] = []

    def search_url(self, query):
        return f"https://fake.example/search?q={query.q}"

    def search_requests(self, query, session=None):
        self.calls.append(query)
        return [Job(portal="fake", query=query.q, **j) for j in self.jobs]


@pytest.fixture(scope="session", autouse=True)
def _register_fake():
    portals.register(FakePortal())
    yield


@pytest.fixture
def fresh_db(tmp_path):
    db.reset_for_tests(str(tmp_path / "db.sqlite"))
    db.connect()
    yield
    db.reset_for_tests(str(tmp_path / "db-closed.sqlite"))


@pytest.fixture
def fake():
    p = portals.REGISTRY["fake"]
    p.jobs = []
    p.calls = []
    return p


@pytest.fixture
def client(fresh_db):
    from fastapi.testclient import TestClient
    from jobserver.app import app

    with TestClient(app, headers={"X-Api-Key": "test-key"}) as c:
        yield c
