"""SQLite storage for portal accounts, consultants, jobs, matches and scrape runs."""
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

from .settings import settings

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS portal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  password_enc TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'untested',
  last_login_at INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS consultants (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  prefs_json TEXT NOT NULL DEFAULT '{}',
  resume_name TEXT NOT NULL DEFAULT '',
  resume_text TEXT NOT NULL DEFAULT '',
  resume_at INTEGER,
  profile_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  remote TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL DEFAULT '',
  salary TEXT NOT NULL DEFAULT '',
  posted TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  skills_json TEXT NOT NULL DEFAULT '[]',
  query TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  run_id INTEGER,
  UNIQUE (portal, external_id)
);
CREATE INDEX IF NOT EXISTS jobs_seen ON jobs (last_seen);
CREATE TABLE IF NOT EXISTS matches (
  uid TEXT NOT NULL,
  job_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'new',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, job_id)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_by TEXT NOT NULL DEFAULT '',
  portals_json TEXT NOT NULL DEFAULT '[]',
  queries INTEGER NOT NULL DEFAULT 0,
  jobs_found INTEGER NOT NULL DEFAULT 0,
  jobs_new INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  log TEXT NOT NULL DEFAULT ''
);
"""


def now_ms() -> int:
    return int(time.time() * 1000)


def connect() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            settings.ensure_dirs()
            _conn = sqlite3.connect(str(settings.db_path), check_same_thread=False, isolation_level=None)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA busy_timeout=5000")
            _conn.executescript(SCHEMA)
        return _conn


def reset_for_tests(path: str) -> None:
    """Point the module at a fresh database file (used by the test-suite)."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        settings.db_path = __import__("pathlib").Path(path)


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    c = connect()
    with _lock:
        c.execute("BEGIN")
        try:
            yield c
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return connect().execute(sql, args).fetchall()


def one(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    with _lock:
        return connect().execute(sql, args).fetchone()


def run(sql: str, args: tuple = ()) -> int:
    with _lock:
        cur = connect().execute(sql, args)
        return cur.lastrowid or cur.rowcount


def j(s: str | None, default: Any) -> Any:
    try:
        return json.loads(s) if s else default
    except ValueError:
        return default


# ---------- portal accounts ----------
def account_row(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "portal": r["portal"], "label": r["label"], "username": r["username"],
        "has_password": bool(r["password_enc"]), "enabled": bool(r["enabled"]), "status": r["status"],
        "last_login_at": r["last_login_at"], "last_error": r["last_error"], "settings": j(r["settings_json"], {}),
        "created_at": r["created_at"], "updated_at": r["updated_at"],
    }


def list_accounts() -> list[dict]:
    return [account_row(r) for r in q("SELECT * FROM portal_accounts ORDER BY portal, id")]


def get_account(aid: int) -> sqlite3.Row | None:
    return one("SELECT * FROM portal_accounts WHERE id = ?", (aid,))


# ---------- jobs ----------
def job_row(r: sqlite3.Row, full: bool = False) -> dict:
    d = {
        "id": r["id"], "portal": r["portal"], "external_id": r["external_id"], "title": r["title"], "company": r["company"],
        "location": r["location"], "remote": r["remote"], "job_type": r["job_type"], "salary": r["salary"], "posted": r["posted"],
        "url": r["url"], "skills": j(r["skills_json"], []), "query": r["query"], "first_seen": r["first_seen"], "last_seen": r["last_seen"],
    }
    desc = r["description"] or ""
    d["summary"] = desc[:400]
    if full:
        d["description"] = desc
    return d


def upsert_job(job: dict, run_id: int | None) -> bool:
    """Insert or refresh a scraped job. Returns True when it is new."""
    t = now_ms()
    ex = one("SELECT id, description FROM jobs WHERE portal = ? AND external_id = ?", (job["portal"], job["external_id"]))
    if ex:
        desc = job.get("description") or ex["description"]
        run("UPDATE jobs SET title=?, company=?, location=?, remote=?, job_type=?, salary=?, posted=?, url=?, description=?, skills_json=?, last_seen=?, run_id=? WHERE id=?",
            (job.get("title", ""), job.get("company", ""), job.get("location", ""), job.get("remote", ""), job.get("job_type", ""), job.get("salary", ""),
             job.get("posted", ""), job.get("url", ""), desc, json.dumps(job.get("skills", [])), t, run_id, ex["id"]))
        return False
    run("INSERT INTO jobs (portal, external_id, title, company, location, remote, job_type, salary, posted, url, description, skills_json, query, first_seen, last_seen, run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (job["portal"], job["external_id"], job.get("title", ""), job.get("company", ""), job.get("location", ""), job.get("remote", ""), job.get("job_type", ""),
         job.get("salary", ""), job.get("posted", ""), job.get("url", ""), job.get("description", ""), json.dumps(job.get("skills", [])), job.get("query", ""), t, t, run_id))
    return True


def prune_jobs(max_age_days: int) -> int:
    cutoff = now_ms() - max_age_days * 86400 * 1000
    ids = [r["id"] for r in q("SELECT id FROM jobs WHERE last_seen < ?", (cutoff,))]
    if not ids:
        return 0
    with tx() as c:
        for i in ids:
            c.execute("DELETE FROM matches WHERE job_id = ? AND state IN ('new','dismissed')", (i,))
        # keep jobs a consultant saved or applied to
        keep = {r["job_id"] for r in c.execute("SELECT DISTINCT job_id FROM matches").fetchall()}
        gone = [i for i in ids if i not in keep]
        for i in gone:
            c.execute("DELETE FROM jobs WHERE id = ?", (i,))
    return len(gone)


# ---------- consultants ----------
def consultant_row(r: sqlite3.Row) -> dict:
    return {
        "uid": r["uid"], "name": r["name"], "email": r["email"], "prefs": j(r["prefs_json"], {}), "resume_name": r["resume_name"],
        "resume_at": r["resume_at"], "has_resume": bool(r["resume_text"]), "profile": j(r["profile_json"], {}), "updated_at": r["updated_at"],
    }


def get_consultant(uid: str) -> sqlite3.Row | None:
    return one("SELECT * FROM consultants WHERE uid = ?", (uid,))


def save_consultant(uid: str, **fields: Any) -> None:
    ex = get_consultant(uid)
    t = now_ms()
    cols = {"name": "", "email": "", "prefs_json": "{}", "resume_name": "", "resume_text": "", "resume_at": None, "profile_json": "{}"}
    if ex:
        for k in cols:
            cols[k] = ex[k]
    for k, v in fields.items():
        if k == "prefs":
            cols["prefs_json"] = json.dumps(v)
        elif k == "profile":
            cols["profile_json"] = json.dumps(v)
        else:
            cols[k] = v
    run("REPLACE INTO consultants (uid, name, email, prefs_json, resume_name, resume_text, resume_at, profile_json, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (uid, cols["name"], cols["email"], cols["prefs_json"], cols["resume_name"], cols["resume_text"], cols["resume_at"], cols["profile_json"], t))


# ---------- runs ----------
def run_row(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "started_at": r["started_at"], "finished_at": r["finished_at"], "status": r["status"], "trigger_by": r["trigger_by"],
        "portals": j(r["portals_json"], []), "queries": r["queries"], "jobs_found": r["jobs_found"], "jobs_new": r["jobs_new"],
        "errors": j(r["errors_json"], []), "log": r["log"],
    }
