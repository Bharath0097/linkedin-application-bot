"""HTTP API used by the StratEdge portal (api/index.php proxies to it).

Every request needs the X-Api-Key header (JOBSERVER_API_KEY) unless it comes from the
same machine and no key is configured.
"""
from __future__ import annotations

import contextlib
import logging
import os
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import __version__, db, portals
from .resume import ResumeError, build_profile, extract_text, normalize
from .security import api_key_ok, encrypt
from .settings import settings
from .worker import runner

log = logging.getLogger("jobserver")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    db.connect()
    if not os.environ.get("JOBSERVER_NO_SCHEDULER"):
        runner.start_scheduler()
    yield
    runner.stop()


app = FastAPI(title="StratEdge job-portal server", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)


async def auth(request: Request) -> None:
    host = request.client.host if request.client else None
    if not api_key_ok(request.headers.get("x-api-key"), host):
        raise HTTPException(401, "Missing or wrong API key.")


@app.exception_handler(portals.PortalError)
async def portal_error(request: Request, exc: portals.PortalError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error")
    return JSONResponse({"detail": f"The job server hit a problem: {exc}"}, status_code=500)


# ---------- models ----------
class AccountIn(BaseModel):
    portal: str
    label: str = ""
    username: str
    password: str = ""
    enabled: bool = True
    settings: dict[str, Any] = Field(default_factory=dict)


class AccountPatch(BaseModel):
    label: str | None = None
    username: str | None = None
    password: str | None = None
    enabled: bool | None = None
    settings: dict[str, Any] | None = None


class ConsultantIn(BaseModel):
    name: str = ""
    email: str = ""
    prefs: dict[str, Any] = Field(default_factory=dict)


class RunIn(BaseModel):
    portals: list[str] = Field(default_factory=list)
    uids: list[str] = Field(default_factory=list)
    trigger: str = "portal"


class MatchState(BaseModel):
    state: str


class CodeIn(BaseModel):
    code: str


class GrabIn(BaseModel):
    keywords: list[str] = Field(default_factory=list)
    location: str = ""
    remote: str = "any"
    posted_days: int = 7
    portals: list[str] = Field(default_factory=list)
    trigger: str = "grab"


class JobPatch(BaseModel):
    published: bool | None = None


# ---------- status ----------
@app.get("/health")
async def health():
    return {"ok": True, "version": __version__}


@app.get("/overview", dependencies=[Depends(auth)])
async def overview():
    last = db.one("SELECT * FROM runs ORDER BY id DESC LIMIT 1")
    return {
        "version": __version__,
        "portals": portals.describe_all(),
        "accounts": db.list_accounts(),
        "jobs": db.one("SELECT COUNT(*) AS n FROM jobs")["n"],
        "jobs_7d": db.one("SELECT COUNT(*) AS n FROM jobs WHERE first_seen > ?", (db.now_ms() - 7 * 86400000,))["n"],
        "consultants": db.one("SELECT COUNT(*) AS n FROM consultants")["n"],
        "consultants_with_resume": db.one("SELECT COUNT(*) AS n FROM consultants WHERE resume_text != ''")["n"],
        "matches": db.one("SELECT COUNT(*) AS n FROM matches")["n"],
        "last_run": db.run_row(last) if last else None,
        "running": runner.is_busy(),
        "next_run_at": runner.next_run_at,
        "schedule_minutes": settings.scrape_every_min,
        "browser": settings.browser,
        "headless": settings.headless,
    }


# ---------- portal accounts ----------
@app.get("/portals", dependencies=[Depends(auth)])
async def portals_list():
    return {"portals": portals.describe_all(), "accounts": db.list_accounts()}


@app.post("/portals/accounts", dependencies=[Depends(auth)])
async def account_create(a: AccountIn):
    portal = portals.get(a.portal)  # raises for unknown
    if not a.username.strip():
        raise HTTPException(400, "Enter the username or email for this portal account.")
    t = db.now_ms()
    aid = db.run("INSERT INTO portal_accounts (portal, label, username, password_enc, enabled, status, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                 (portal.key, a.label.strip(), a.username.strip(), encrypt(a.password) if a.password else "", 1 if a.enabled else 0, "untested", __import__("json").dumps(a.settings), t, t))
    return {"account": db.account_row(db.get_account(aid))}


@app.patch("/portals/accounts/{aid}", dependencies=[Depends(auth)])
async def account_update(aid: int, p: AccountPatch):
    a = db.get_account(aid)
    if not a:
        raise HTTPException(404, "No such account.")
    sets, args = [], []
    if p.label is not None:
        sets.append("label = ?"); args.append(p.label.strip())
    if p.username is not None:
        sets.append("username = ?"); args.append(p.username.strip())
    if p.password:
        sets.append("password_enc = ?"); args.append(encrypt(p.password)); sets.append("status = 'untested'")
    if p.enabled is not None:
        sets.append("enabled = ?"); args.append(1 if p.enabled else 0)
    if p.settings is not None:
        sets.append("settings_json = ?"); args.append(__import__("json").dumps(p.settings))
    sets.append("updated_at = ?"); args.append(db.now_ms())
    args.append(aid)
    db.run(f"UPDATE portal_accounts SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return {"account": db.account_row(db.get_account(aid))}


@app.delete("/portals/accounts/{aid}", dependencies=[Depends(auth)])
async def account_delete(aid: int):
    a = db.get_account(aid)
    if not a:
        raise HTTPException(404, "No such account.")
    db.run("DELETE FROM portal_accounts WHERE id = ?", (aid,))
    from .browser import clear_cookies
    clear_cookies(f"{a['portal']}-{aid}")
    return {"ok": True}


@app.post("/portals/accounts/{aid}/test", dependencies=[Depends(auth)])
async def account_test(aid: int):
    import anyio

    try:
        res = await anyio.to_thread.run_sync(runner.test_account, aid)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {**res, "account": db.account_row(db.get_account(aid))}


@app.get("/portals/status", dependencies=[Depends(auth)])
async def portals_status():
    """Per portal: the accounts, whether a saved session is usable, and any login in progress (for the Job grabber)."""
    accounts = db.list_accounts()
    out = []
    for p in portals.describe_all():
        accs = []
        for a in accounts:
            if a["portal"] != p["key"]:
                continue
            accs.append({**a, "login": runner.logins.status(a["id"])})
        out.append({**p, "accounts": accs, "logged_in": any(a["status"] == "ok" and a["enabled"] for a in accs), "supports_requests": portals.get(p["key"]).supports_requests})
    return {"portals": out, "running": runner.is_busy(), "current_run": runner.current_run}


@app.post("/portals/accounts/{aid}/login", dependencies=[Depends(auth)])
async def account_login_start(aid: int):
    try:
        return {"login": runner.logins.start(aid)}
    except LookupError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.get("/portals/accounts/{aid}/login", dependencies=[Depends(auth)])
async def account_login_status(aid: int):
    return {"login": runner.logins.status(aid), "account": db.account_row(db.get_account(aid)) if db.get_account(aid) else None}


@app.post("/portals/accounts/{aid}/login/code", dependencies=[Depends(auth)])
async def account_login_code(aid: int, c: CodeIn):
    if not c.code.strip():
        raise HTTPException(400, "Type the code first.")
    try:
        return {"login": runner.logins.submit_code(aid, c.code)}
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.post("/portals/accounts/{aid}/logout", dependencies=[Depends(auth)])
async def account_logout(aid: int):
    try:
        runner.logins.logout(aid)
    except LookupError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@app.post("/grab", dependencies=[Depends(auth)])
async def grab(g: GrabIn):
    """The Job grabber: search the chosen portals for these keywords now."""
    kws = [k.strip() for k in g.keywords if k and k.strip()][:12]
    if not kws:
        raise HTTPException(400, "Enter at least one keyword or job title.")
    for k in g.portals:
        portals.get(k)
    remote = g.remote if g.remote in ("any", "remote", "onsite", "hybrid") else "any"
    qs = [portals.SearchQuery(q=k, location=g.location.strip() or settings.default_location, remote=remote, posted_days=max(1, min(30, g.posted_days))) for k in kws]
    try:
        rid = runner.start_run(g.trigger or "grab", g.portals or None, None, qs)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"run": db.run_row(db.one("SELECT * FROM runs WHERE id = ?", (rid,)))}


@app.get("/runs/{rid}/jobs", dependencies=[Depends(auth)])
async def run_jobs(rid: int, limit: int = Query(300, ge=1, le=1000)):
    rows = db.q("SELECT * FROM jobs WHERE run_id = ? ORDER BY first_seen DESC LIMIT ?", (rid, limit))
    return {"jobs": [db.job_row(r) for r in rows]}


@app.patch("/jobs/{jid}", dependencies=[Depends(auth)])
async def job_patch(jid: int, p: JobPatch):
    if not db.one("SELECT id FROM jobs WHERE id = ?", (jid,)):
        raise HTTPException(404, "No such job.")
    if p.published is not None:
        db.run("UPDATE jobs SET published = ? WHERE id = ?", (1 if p.published else 0, jid))
    return {"job": db.job_row(db.one("SELECT * FROM jobs WHERE id = ?", (jid,)), full=True)}


# ---------- runs ----------
@app.get("/runs", dependencies=[Depends(auth)])
async def runs_list(limit: int = Query(20, ge=1, le=200)):
    rows = db.q("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,))
    return {"runs": [db.run_row(r) for r in rows], "running": runner.is_busy(), "next_run_at": runner.next_run_at}


@app.post("/runs", dependencies=[Depends(auth)])
async def run_start(r: RunIn):
    for k in r.portals:
        portals.get(k)
    try:
        rid = runner.start_run(r.trigger or "portal", r.portals or None, r.uids or None)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"run": db.run_row(db.one("SELECT * FROM runs WHERE id = ?", (rid,)))}


@app.get("/runs/{rid}", dependencies=[Depends(auth)])
async def run_get(rid: int):
    r = db.one("SELECT * FROM runs WHERE id = ?", (rid,))
    if not r:
        raise HTTPException(404, "No such run.")
    return {"run": db.run_row(r)}


# ---------- jobs ----------
@app.get("/jobs", dependencies=[Depends(auth)])
async def jobs_list(q: str = "", portal: str = "", limit: int = Query(100, ge=1, le=500), offset: int = 0):
    sql = "SELECT * FROM jobs WHERE 1=1"
    args: list[Any] = []
    if portal:
        sql += " AND portal = ?"; args.append(portal)
    if q:
        like = f"%{q.lower()}%"
        sql += " AND (lower(title) LIKE ? OR lower(company) LIKE ? OR lower(location) LIKE ? OR lower(description) LIKE ?)"; args += [like, like, like, like]
    total = db.one("SELECT COUNT(*) AS n FROM (" + sql + ")", tuple(args))["n"]
    sql += " ORDER BY first_seen DESC LIMIT ? OFFSET ?"; args += [limit, offset]
    return {"jobs": [db.job_row(r) for r in db.q(sql, tuple(args))], "total": total}


@app.get("/jobs/{jid}", dependencies=[Depends(auth)])
async def job_get(jid: int):
    r = db.one("SELECT * FROM jobs WHERE id = ?", (jid,))
    if not r:
        raise HTTPException(404, "No such job.")
    return {"job": db.job_row(r, full=True)}


# ---------- consultants ----------
@app.get("/consultants", dependencies=[Depends(auth)])
async def consultants_list():
    rows = db.q("SELECT * FROM consultants ORDER BY name")
    out = []
    for r in rows:
        d = db.consultant_row(r)
        d["match_counts"] = {m["state"]: m["n"] for m in db.q("SELECT state, COUNT(*) AS n FROM matches WHERE uid = ? GROUP BY state", (r["uid"],))}
        out.append(d)
    return {"consultants": out}


@app.get("/consultants/{uid}", dependencies=[Depends(auth)])
async def consultant_get(uid: str):
    r = db.get_consultant(uid)
    if not r:
        return {"consultant": None, "match_counts": {}}
    d = db.consultant_row(r)
    d["match_counts"] = {m["state"]: m["n"] for m in db.q("SELECT state, COUNT(*) AS n FROM matches WHERE uid = ? GROUP BY state", (uid,))}
    last = db.one("SELECT * FROM runs WHERE status != 'running' ORDER BY id DESC LIMIT 1")
    d["last_run"] = db.run_row(last) if last else None
    return {"consultant": d}


@app.put("/consultants/{uid}", dependencies=[Depends(auth)])
async def consultant_put(uid: str, c: ConsultantIn):
    r = db.get_consultant(uid)
    text = r["resume_text"] if r else ""
    profile = build_profile(text, c.prefs) if (text or c.prefs) else {}
    db.save_consultant(uid, name=c.name, email=c.email, prefs=c.prefs, profile=profile)
    if profile.get("skills") or profile.get("titles"):
        runner.rematch_one(uid, profile)
    return {"consultant": db.consultant_row(db.get_consultant(uid))}


@app.post("/consultants/{uid}/resume", dependencies=[Depends(auth)])
async def consultant_resume(uid: str, file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "The resume file is empty.")
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(400, "The resume is larger than 12 MB.")
    try:
        text = normalize(extract_text(data, file.filename or ""))
    except ResumeError as e:
        raise HTTPException(400, str(e))
    r = db.get_consultant(uid)
    prefs = db.j(r["prefs_json"], {}) if r else {}
    profile = build_profile(text, prefs)
    settings.ensure_dirs()
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in (file.filename or "resume"))[:120]
    (settings.resume_dir / f"{uid}__{safe}").write_bytes(data)
    db.save_consultant(uid, resume_name=file.filename or "resume", resume_text=text[:200000], resume_at=db.now_ms(), profile=profile)
    n = runner.rematch_one(uid, profile)
    return {"consultant": db.consultant_row(db.get_consultant(uid)), "matches": n}


@app.post("/consultants/{uid}/rematch", dependencies=[Depends(auth)])
async def consultant_rematch(uid: str):
    r = db.get_consultant(uid)
    if not r:
        raise HTTPException(404, "Upload a resume first.")
    n = runner.rematch_one(uid, db.j(r["profile_json"], {}))
    return {"matches": n}


@app.get("/consultants/{uid}/matches", dependencies=[Depends(auth)])
async def consultant_matches(uid: str, state: str = "", limit: int = Query(200, ge=1, le=1000)):
    sql = "SELECT j.*, m.score, m.reasons_json, m.state, m.updated_at AS m_at FROM matches m JOIN jobs j ON j.id = m.job_id WHERE m.uid = ?"
    args: list[Any] = [uid]
    if state:
        sql += " AND m.state = ?"; args.append(state)
    sql += " ORDER BY m.score DESC, j.first_seen DESC LIMIT ?"; args.append(limit)
    out = []
    for r in db.q(sql, tuple(args)):
        d = db.job_row(r)
        d.update({"score": r["score"], "reasons": db.j(r["reasons_json"], []), "state": r["state"], "state_at": r["m_at"]})
        out.append(d)
    counts = {m["state"]: m["n"] for m in db.q("SELECT state, COUNT(*) AS n FROM matches WHERE uid = ? GROUP BY state", (uid,))}
    return {"matches": out, "counts": counts}


@app.post("/consultants/{uid}/matches/{jid}", dependencies=[Depends(auth)])
async def consultant_match_state(uid: str, jid: int, s: MatchState):
    if s.state not in ("new", "saved", "applied", "dismissed"):
        raise HTTPException(400, "State must be new, saved, applied or dismissed.")
    if not db.one("SELECT id FROM jobs WHERE id = ?", (jid,)):
        raise HTTPException(404, "No such job.")
    ex = db.one("SELECT uid FROM matches WHERE uid = ? AND job_id = ?", (uid, jid))
    if ex:
        db.run("UPDATE matches SET state = ?, updated_at = ? WHERE uid = ? AND job_id = ?", (s.state, db.now_ms(), uid, jid))
    else:
        db.run("INSERT INTO matches (uid, job_id, score, reasons_json, state, updated_at) VALUES (?,?,?,?,?,?)", (uid, jid, 0, "[]", s.state, db.now_ms()))
    return {"ok": True}
