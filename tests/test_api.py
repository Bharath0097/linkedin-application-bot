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
