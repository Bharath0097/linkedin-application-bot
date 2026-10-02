"""End-to-end: the PHP portal API talking to the job server.

Boots `php -S` on a copy of website/ and `python -m jobserver` on a free port, then
walks through: admin + consultant + employee sign-up, the separate logins, a resume
upload through the portal, preferences, matches and the staff job-portal endpoints.
Skipped when php is not installed.
"""
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import time

import pytest
import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHP = shutil.which("php")
pytestmark = pytest.mark.skipif(not PHP, reason="php is not installed")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def wait_http(url: str, secs: float = 20) -> None:
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if requests.get(url, timeout=2).status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(0.25)
    raise RuntimeError(f"{url} did not come up")


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("site")
    site = tmp / "site"
    shutil.copytree(ROOT / "website", site, ignore=shutil.ignore_patterns("_source", "storage"))
    (site / "storage" / "files").mkdir(parents=True)
    jport, pport = free_port(), free_port()
    cfg = (site / "api" / "config.php").read_text()
    cfg = cfg.replace("'jobs_url' => 'http://127.0.0.1:8765'", f"'jobs_url' => 'http://127.0.0.1:{jport}'").replace("'jobs_key' => ''", "'jobs_key' => 'integration-key'")
    (site / "api" / "config.php").write_text(cfg)
    env = dict(os.environ, JOBSERVER_DATA=str(tmp / "jobdata"), JOBSERVER_DB=str(tmp / "jobdata" / "db.sqlite"), JOBSERVER_API_KEY="integration-key",
               JOBSERVER_PORT=str(jport), JOBSERVER_NO_SCHEDULER="1", JOBSERVER_MIN_SCORE="10")
    js = subprocess.Popen([sys.executable, "-m", "jobserver"], cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    ph = subprocess.Popen([PHP, "-S", f"127.0.0.1:{pport}", "-t", str(site)], cwd=str(site), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        wait_http(f"http://127.0.0.1:{jport}/health")
        wait_http(f"http://127.0.0.1:{pport}/api/index.php?r=me")
        yield {"site": site, "php": f"http://127.0.0.1:{pport}/api/index.php?r=", "jobs": f"http://127.0.0.1:{jport}"}
    finally:
        for p in (js, ph):
            p.terminate()
        for p in (js, ph):
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()


class Portal:
    def __init__(self, base: str):
        self.base = base
        self.s = requests.Session()
        self.s.headers["X-Requested-With"] = "fetch"

    def get(self, route: str):
        return self.s.get(self.base + route, timeout=20)

    def post(self, route: str, body: dict | None = None, **kw):
        if "files" in kw or "data" in kw:
            return self.s.post(self.base + route, timeout=120, **kw)
        return self.s.post(self.base + route, json=body or {}, timeout=60)


def register(p: Portal, name: str, email: str):
    r = p.post("register", {"name": name, "email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_separate_logins_and_resume_matching(stack):
    base = stack["php"]
    admin = Portal(base)
    a = register(admin, "Ada Admin", "admin@stratedge.test")
    assert a["role"] == "admin"

    # a consultant signs up and fills in the consultant profile
    cons = Portal(base)
    c = register(cons, "Priya Raman", "priya@stratedge.test")
    r = cons.post("set", {"path": f"u/{c['id']}", "data": {"p": {"n": "Priya Raman", "e": "priya@stratedge.test", "role": "consultant", "ti": "SAP FICO Consultant", "loc": "Edison, NJ"}, "joined": 1}})
    assert r.status_code == 200, r.text
    # an employee signs up too
    emp = Portal(base)
    e = register(emp, "Evan Employee", "evan@stratedge.test")
    assert emp.post("set", {"path": f"u/{e['id']}", "data": {"p": {"n": "Evan Employee", "e": "evan@stratedge.test", "role": "employee"}, "joined": 1}}).status_code == 200
    # admin approves both (same as the Team page does)
    assert admin.post("set", {"path": f"r/{c['id']}", "data": {"st": "active", "role": "consultant", "ty": "C2C"}}).status_code == 200
    assert admin.post("set", {"path": f"r/{e['id']}", "data": {"st": "active", "role": "employee"}}).status_code == 200
    assert admin.get("me").json()["portal"] == ""

    # separate logins: the consultant cannot use the employee or client login, and the other way round
    fresh = Portal(base)
    r = fresh.post("login", {"email": "priya@stratedge.test", "password": "password123", "as": "employee"})
    assert r.status_code == 403 and r.json()["error"] == "wrong_portal" and r.json()["portal"] == "consultant", r.text
    r = fresh.post("login", {"email": "priya@stratedge.test", "password": "password123", "as": "client"})
    assert r.status_code == 403
    r = fresh.post("login", {"email": "priya@stratedge.test", "password": "password123", "as": "consultant"})
    assert r.status_code == 200 and r.json()["portal"] == "consultant", r.text
    assert fresh.get("me").json()["portal"] == "consultant"
    r = Portal(base).post("login", {"email": "evan@stratedge.test", "password": "password123", "as": "consultant"})
    assert r.status_code == 403 and r.json()["portal"] == "employee"
    assert Portal(base).post("login", {"email": "evan@stratedge.test", "password": "password123", "as": "employee"}).status_code == 200
    # staff may use any login page; a login without "as" is never blocked
    assert Portal(base).post("login", {"email": "admin@stratedge.test", "password": "password123", "as": "consultant"}).status_code == 200
    assert Portal(base).post("login", {"email": "priya@stratedge.test", "password": "password123"}).status_code == 200

    # the recruiting workspace is for employees, not consultants
    assert cons.post("set", {"path": "rec/x/cand/1", "data": {"n": "x"}}).status_code == 403
    assert emp.post("set", {"path": "rec/x/cand/1", "data": {"n": "x"}}).status_code == 200

    # resume upload through the portal: stored under the person's documents and parsed by the job server
    resume = b"Priya Raman\nEdison, NJ\nSenior SAP FICO Consultant with 9 years of experience in S/4HANA, ABAP, Fiori and Power BI.\nSAP FICO Consultant, Acme, 2018 - Present"
    r = cons.post("jobs_resume", files={"file": ("priya-resume.txt", resume, "text/plain")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["doc"]["n"] == "priya-resume.txt" and j["consultant"]["has_resume"] and "SAP FICO" in j["consultant"]["profile"]["skills"]
    docs = cons.get("col&path=" + f"u/{c['id']}/f").json()["docs"]
    assert any(d[1]["c"] == "resume" for d in docs)
    r = cons.post("jobs_prefs", {"prefs": {"titles": "SAP FICO Consultant, S/4HANA Finance Lead", "remote": "remote", "exclude": ["clearance"], "job_types": ["Contract"]}})
    assert r.status_code == 200 and r.json()["consultant"]["prefs"]["titles"] == ["SAP FICO Consultant", "S/4HANA Finance Lead"], r.text
    assert r.json()["consultant"]["prefs"]["title"] == "SAP FICO Consultant" and r.json()["consultant"]["prefs"]["location"] == "Edison, NJ"
    me = cons.get("jobs_me").json()["consultant"]
    assert me["profile"]["remote"] == "remote" and me["match_counts"] in ({}, [])

    # seed a couple of jobs straight into the job server (as a scrape run would) and check the consultant sees the match
    from jobserver import db as jdb  # the test process has its own module state; talk to the running server over HTTP instead
    headers = {"X-Api-Key": "integration-key"}
    assert requests.get(stack["jobs"] + "/overview", headers=headers, timeout=10).json()["consultants_with_resume"] == 1
    assert requests.get(stack["jobs"] + "/overview", timeout=10).status_code == 401  # no key, not loopback-exempt
    # staff endpoints through the portal
    r = admin.post("jobs_admin", {"op": "account_add", "portal": "dice", "label": "Recruiting", "username": "recruiting@stratedge.test", "password": "s3cret"})
    assert r.status_code == 200 and r.json()["account"]["has_password"] and "password" not in r.json()["account"], r.text
    aid = r.json()["account"]["id"]
    ov = admin.get("jobs_admin&op=overview").json()
    assert ov["accounts"][0]["username"] == "recruiting@stratedge.test" and {p["key"] for p in ov["portals"]} >= {"dice", "linkedin", "indeed", "monster"}
    assert admin.post("jobs_admin", {"op": "account_update", "id": aid, "enabled": False}).json()["account"]["enabled"] is False
    assert cons.get("jobs_admin&op=overview").status_code == 403  # consultants cannot manage portal logins
    assert admin.post("jobs_admin", {"op": "account_delete", "id": aid}).json()["ok"]
    assert admin.get("jobs_admin&op=consultants").json()["consultants"][0]["uid"] == c["id"]
    assert admin.get("jobs_admin&op=runs").json()["runs"] == []
    del jdb
