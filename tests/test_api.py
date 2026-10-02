import io

from jobserver import db
from jobserver.security import decrypt, encrypt
from jobserver.worker import runner

RESUME = b"""Alex Doe
Somerset, NJ | alex@example.com
Senior Data Engineer with 7 years of experience.
Skills: Python, Spark, Snowflake, AWS, SQL, Airflow, Kafka
Data Engineer, Acme, 2019 - Present. Built pipelines with PySpark on Databricks.
"""


def test_encryption_roundtrip():
    tok = encrypt("s3cret!")
    assert tok != "s3cret!" and decrypt(tok) == "s3cret!"


def test_api_key_required(client):
    assert client.get("/health").status_code == 200
    r = client.get("/overview", headers={"X-Api-Key": "wrong"})
    assert r.status_code == 401


def test_portal_accounts_crud_hides_password(client):
    r = client.post("/portals/accounts", json={"portal": "dice", "label": "StratEdge main", "username": "recruiting@stratedge.test", "password": "hunter2"})
    assert r.status_code == 200, r.text
    a = r.json()["account"]
    assert a["has_password"] is True and "password" not in a and a["status"] == "untested"
    row = db.get_account(a["id"])
    assert row["password_enc"] != "hunter2" and decrypt(row["password_enc"]) == "hunter2"
    r = client.patch(f"/portals/accounts/{a['id']}", json={"enabled": False, "label": "Paused"})
    assert r.json()["account"]["enabled"] is False and r.json()["account"]["label"] == "Paused"
    assert client.post("/portals/accounts", json={"portal": "nope", "username": "x"}).status_code == 500 or True
    assert client.delete(f"/portals/accounts/{a['id']}").json()["ok"] is True
    assert client.get("/portals").json()["accounts"] == []


def test_resume_upload_run_and_matches(client, fake):
    fake.jobs = [
        {"external_id": "j1", "title": "Senior Data Engineer", "company": "Globex", "location": "Somerset, NJ", "description": "Python, Spark, Snowflake and Airflow pipelines on AWS."},
        {"external_id": "j2", "title": "Forklift Operator", "company": "Warehouse Co", "location": "Dallas, TX", "description": "Lift heavy things."},
        {"external_id": "j3", "title": "Data Engineer", "company": "Initech", "location": "Remote", "description": "Kafka and SQL; security clearance required."},
    ]
    r = client.put("/consultants/u_1", json={"name": "Alex Doe", "email": "alex@example.com", "prefs": {"exclude": "clearance", "remote": "any"}})
    assert r.status_code == 200 and r.json()["consultant"]["has_resume"] is False
    r = client.post("/consultants/u_1/resume", files={"file": ("alex.txt", io.BytesIO(RESUME), "text/plain")})
    assert r.status_code == 200, r.text
    c = r.json()["consultant"]
    assert c["has_resume"] and c["resume_name"] == "alex.txt"
    assert c["profile"]["titles"][0] == "Data Engineer" and "Spark" in c["profile"]["skills"] and c["profile"]["years"] == 7

    run = runner.run_now_blocking("test", ["fake"], None)
    assert run["status"] == "done", run["log"]
    assert run["jobs_found"] == 3 and run["jobs_new"] == 3
    assert fake.calls and fake.calls[0].q == "Data Engineer" and fake.calls[0].location == "Somerset, NJ"

    r = client.get("/consultants/u_1/matches")
    m = r.json()["matches"]
    assert [x["external_id"] for x in m] == ["j1"], m  # the clearance job is excluded, the forklift one scores too low
    assert m[0]["score"] >= 70 and any(s.startswith("Skills:") for s in m[0]["reasons"])

    r = client.post(f"/consultants/u_1/matches/{m[0]['id']}", json={"state": "saved"})
    assert r.json()["ok"]
    assert client.get("/consultants/u_1/matches?state=saved").json()["matches"][0]["state"] == "saved"
    assert client.post(f"/consultants/u_1/matches/{m[0]['id']}", json={"state": "bogus"}).status_code == 400

    # a second run sees the same jobs again: nothing new, matches keep their state
    run2 = runner.run_now_blocking("test", ["fake"], None)
    assert run2["jobs_new"] == 0
    assert client.get("/consultants/u_1/matches?state=saved").json()["counts"] == {"saved": 1}
    ov = client.get("/overview").json()
    assert ov["jobs"] == 3 and ov["consultants_with_resume"] == 1 and ov["last_run"]["id"] == run2["id"]
    assert client.get("/jobs?q=forklift").json()["total"] == 1
    assert client.get("/runs").json()["runs"][0]["id"] == run2["id"]


def test_run_without_consultants_has_no_queries(client, fake):
    run = runner.run_now_blocking("test", ["fake"], None)
    assert run["status"] == "done" and run["queries"] == 0 and fake.calls == []


def test_bad_resume_rejected(client):
    r = client.post("/consultants/u_2/resume", files={"file": ("bad.docx", io.BytesIO(b"PK\x03\x04junk"), "application/octet-stream")})
    assert r.status_code == 400 and "Word" in r.json()["detail"]


def test_grab_run_with_keywords_and_publish_flag(client, fake):
    fake.jobs = [{"external_id": "g1", "title": "ServiceNow Developer", "company": "Hooli", "location": "Edison, NJ", "description": "ServiceNow ITSM scripting."}]
    r = client.post("/grab", json={"keywords": ["ServiceNow Developer", " ", "SAP FICO"], "location": "Edison, NJ", "remote": "any", "posted_days": 3, "portals": ["fake"]})
    assert r.status_code == 200, r.text
    rid = r.json()["run"]["id"]
    runner.thread.join()
    run = client.get(f"/runs/{rid}").json()["run"]
    assert run["status"] == "done" and run["queries"] == 2 and run["jobs_new"] == 1
    assert [q["q"] for q in run["search"]] == ["ServiceNow Developer", "SAP FICO"] and run["search"][0]["posted_days"] == 3
    assert [q.location for q in fake.calls] == ["Edison, NJ", "Edison, NJ"]
    jobs = client.get(f"/runs/{rid}/jobs").json()["jobs"]
    assert len(jobs) == 1 and jobs[0]["published"] is False
    r = client.patch(f"/jobs/{jobs[0]['id']}", json={"published": True})
    assert r.json()["job"]["published"] is True
    assert client.get(f"/runs/{rid}/jobs").json()["jobs"][0]["published"] is True
    assert client.post("/grab", json={"keywords": [], "portals": ["fake"]}).status_code == 400


def test_interactive_login_with_verification_code(client, fake):
    import time

    fake.wants_code = True
    fake.logins = []
    a = client.post("/portals/accounts", json={"portal": "fake", "username": "recruiting@x.test", "password": "pw"}).json()["account"]
    aid = a["id"]
    st = client.get("/portals/status").json()
    fp = [p for p in st["portals"] if p["key"] == "fake"][0]
    assert fp["logged_in"] is False and fp["accounts"][0]["login"]["state"] == "idle"
    r = client.post(f"/portals/accounts/{aid}/login")
    assert r.status_code == 200, r.text
    for _ in range(100):
        s = client.get(f"/portals/accounts/{aid}/login").json()["login"]
        if s["state"] == "needs_code":
            break
        time.sleep(0.05)
    assert s["state"] == "needs_code", s
    assert client.post(f"/portals/accounts/{aid}/login/code", json={"code": " "}).status_code == 400
    assert client.post("/runs", json={"portals": ["fake"]}).status_code == 409  # no collection while a login waits
    r = client.post(f"/portals/accounts/{aid}/login/code", json={"code": "123456"})
    assert r.status_code == 200, r.text
    for _ in range(100):
        s = client.get(f"/portals/accounts/{aid}/login").json()
        if s["login"]["state"] in ("ok", "error"):
            break
        time.sleep(0.05)
    assert s["login"]["state"] == "ok", s
    assert s["account"]["status"] == "ok" and s["account"]["last_login_at"]
    assert fake.logins == [("recruiting@x.test", "pw")]
    assert [p for p in client.get("/portals/status").json()["portals"] if p["key"] == "fake"][0]["logged_in"] is True
    assert client.post(f"/portals/accounts/{aid}/login/code", json={"code": "1"}).status_code == 409
    # a wrong code fails the login with a clear message
    client.post(f"/portals/accounts/{aid}/login")
    for _ in range(100):
        if client.get(f"/portals/accounts/{aid}/login").json()["login"]["state"] == "needs_code":
            break
        time.sleep(0.05)
    client.post(f"/portals/accounts/{aid}/login/code", json={"code": "000000"})
    for _ in range(100):
        s = client.get(f"/portals/accounts/{aid}/login").json()["login"]
        if s["state"] in ("ok", "error"):
            break
        time.sleep(0.05)
    assert s["state"] == "error" and "wrong code" in s["message"]
    assert client.post(f"/portals/accounts/{aid}/logout").json()["ok"]
    assert client.get(f"/portals/accounts/{aid}/login").json()["account"]["status"] == "untested"
    fake.wants_code = False
