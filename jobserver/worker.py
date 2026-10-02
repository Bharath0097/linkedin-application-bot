"""Scrape runs, login tests and matching, executed in background threads."""
from __future__ import annotations

import json
import logging
import threading
import time
import traceback
from typing import Any

from . import db, portals
from .browser import BrowserError, clear_cookies, load_cookies, make_driver, save_cookies
from .matcher import score_job
from .resume import find_skills, search_queries
from .security import decrypt
from .settings import settings

log = logging.getLogger("jobserver")


class Runner:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.current_run: int | None = None
        self.thread: threading.Thread | None = None
        self.scheduler: threading.Thread | None = None
        self.next_run_at: int | None = None
        self.stop_event = threading.Event()
        self.logins = LoginSessions(self)

    # ---------- scheduling ----------
    def start_scheduler(self) -> None:
        if settings.scrape_every_min <= 0 or self.scheduler:
            return
        self.scheduler = threading.Thread(target=self._schedule_loop, name="jobserver-scheduler", daemon=True)
        self.scheduler.start()

    def _schedule_loop(self) -> None:
        every = settings.scrape_every_min * 60
        self.next_run_at = db.now_ms() + 60 * 1000  # first run a minute after start
        while not self.stop_event.is_set():
            wait = max(1.0, (self.next_run_at - db.now_ms()) / 1000)
            if self.stop_event.wait(wait):
                break
            try:
                self.start_run("schedule")
            except Exception as e:  # already running, or no work
                log.info("scheduled run skipped: %s", e)
            self.next_run_at = db.now_ms() + every * 1000

    def stop(self) -> None:
        self.stop_event.set()

    # ---------- runs ----------
    def is_busy(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def start_run(self, trigger: str, portal_keys: list[str] | None = None, uids: list[str] | None = None, queries: list[portals.SearchQuery] | None = None) -> int:
        """Start a run. With explicit queries (the Job grabber) those are searched instead of the consultants' profiles."""
        with self.lock:
            if self.is_busy():
                raise RuntimeError("A scrape run is already in progress.")
            if self.logins.active():
                raise RuntimeError("A portal login is in progress. Finish it (or wait a minute) before collecting jobs.")
            rid = db.run("INSERT INTO runs (started_at, status, trigger_by, portals_json, queries_json) VALUES (?,?,?,?,?)",
                         (db.now_ms(), "running", trigger, json.dumps(portal_keys or []), json.dumps([q.__dict__ for q in queries] if queries else [])))
            self.current_run = rid
            self.thread = threading.Thread(target=self._execute, args=(rid, portal_keys, uids, queries), name=f"jobserver-run-{rid}", daemon=True)
            self.thread.start()
            return rid

    def run_now_blocking(self, trigger: str = "test", portal_keys: list[str] | None = None, uids: list[str] | None = None, queries: list[portals.SearchQuery] | None = None) -> dict:
        rid = self.start_run(trigger, portal_keys, uids, queries)
        self.thread.join()
        return db.run_row(db.one("SELECT * FROM runs WHERE id = ?", (rid,)))

    def _execute(self, rid: int, portal_keys: list[str] | None, uids: list[str] | None, explicit: list[portals.SearchQuery] | None = None) -> None:
        lines: list[str] = []
        errors: list[dict] = []
        found = new = nq = 0

        def say(msg: str) -> None:
            lines.append(time.strftime("%H:%M:%S ") + msg)
            log.info(msg)
            db.run("UPDATE runs SET log = ? WHERE id = ?", ("\n".join(lines[-400:]), rid))

        try:
            queries = explicit if explicit else self.build_queries(uids)
            nq = len(queries)
            if not queries:
                say("No consultant has a resume or preferences yet, so there is nothing to search for.")
            plan = self.plan_portals(portal_keys)
            say(f"{len(queries)} searches across {len(plan)} portal session(s): " + ", ".join(p['label'] for p in plan))
            for p in plan:
                portal: portals.Portal = p["portal"]
                acct = p["account"]
                label = p["label"]
                try:
                    f, n = self._run_portal(portal, acct, queries, rid, say)
                    found += f
                    new += n
                except Exception as e:
                    msg = f"{label}: {e}"
                    errors.append({"portal": portal.key, "account": acct["id"] if acct else None, "error": str(e)})
                    say("ERROR " + msg)
                    log.debug(traceback.format_exc())
                    if acct:
                        db.run("UPDATE portal_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?", ("error", str(e)[:500], db.now_ms(), acct["id"]))
            pruned = db.prune_jobs(settings.job_max_age_days)
            if pruned:
                say(f"Removed {pruned} job(s) older than {settings.job_max_age_days} days.")
            m = self.rematch(uids)
            say(f"Matching done: {m} consultant(s) updated. {found} jobs seen, {new} new.")
            status = "done" if not errors else ("done_with_errors" if found else "failed")
        except Exception as e:
            errors.append({"portal": "", "error": str(e)})
            say("ERROR run failed: " + str(e))
            log.error(traceback.format_exc())
            status = "failed"
        db.run("UPDATE runs SET finished_at=?, status=?, queries=?, jobs_found=?, jobs_new=?, errors_json=?, log=? WHERE id=?",
               (db.now_ms(), status, nq, found, new, json.dumps(errors), "\n".join(lines[-400:]), rid))
        self.current_run = None

    def build_queries(self, uids: list[str] | None = None) -> list[portals.SearchQuery]:
        rows = db.q("SELECT * FROM consultants")
        seen: set[tuple] = set()
        out: list[portals.SearchQuery] = []
        for r in rows:
            if uids and r["uid"] not in uids:
                continue
            prof = db.j(r["profile_json"], {})
            if not prof.get("titles") and not prof.get("skills"):
                continue
            for qd in search_queries(prof, settings.default_location):
                key = (qd["q"].lower(), qd["location"].lower(), qd["remote"])
                if key in seen:
                    continue
                seen.add(key)
                out.append(portals.SearchQuery(q=qd["q"], location=qd["location"], remote=qd["remote"], posted_days=7))
                if len(out) >= settings.max_queries_per_run:
                    return out
        return out

    def plan_portals(self, portal_keys: list[str] | None) -> list[dict]:
        """Which portal sessions to use: every enabled account, plus login-free portals that have no account."""
        plan: list[dict] = []
        accounts = [a for a in db.q("SELECT * FROM portal_accounts WHERE enabled = 1 ORDER BY portal, id")]
        with_acct: set[str] = set()
        for a in accounts:
            if portal_keys and a["portal"] not in portal_keys:
                continue
            try:
                p = portals.get(a["portal"])
            except portals.PortalError:
                continue
            with_acct.add(p.key)
            plan.append({"portal": p, "account": dict(a), "label": f"{p.name} ({a['label'] or a['username']})"})
        for p in portals.REGISTRY.values():
            if p.key in with_acct or p.needs_account:
                continue
            if portal_keys and p.key not in portal_keys:
                continue
            plan.append({"portal": p, "account": None, "label": f"{p.name} (no account)"})
        return plan

    def _run_portal(self, portal: portals.Portal, acct: dict | None, queries: list[portals.SearchQuery], rid: int, say) -> tuple[int, int]:
        found = new = 0
        new_jobs: list[portals.Job] = []
        if acct is None and portal.supports_requests:
            say(f"{portal.name}: public search (no login)")
            for qd in queries:
                jobs = portal.search_requests(qd)
                f, n, nj = self._store(jobs, rid)
                found += f
                new += n
                new_jobs += nj
                say(f"{portal.name}: '{qd.q}' in {qd.location}: {len(jobs)} jobs, {n} new")
            if hasattr(portal, "fetch_description_requests"):
                for job in new_jobs[:40]:
                    d = portal.fetch_description_requests(job)
                    if d:
                        self._set_description(job, d)
                    time.sleep(0.8)
            return found, new
        try:
            driver = portal.open_browser()
        except BrowserError as e:
            raise portals.PortalError(str(e))
        except Exception as e:
            raise portals.PortalError(f"The browser could not start on the server ({str(e)[:200]}).")
        try:
            if acct:
                self._ensure_login(portal, acct, driver, say)
            else:
                say(f"{portal.name}: searching without an account")
            for qd in queries:
                jobs = portal.search(driver, qd)
                f, n, nj = self._store(jobs, rid)
                found += f
                new += n
                new_jobs += nj
                say(f"{portal.name}: '{qd.q}' in {qd.location}: {len(jobs)} jobs, {n} new")
            for job in new_jobs[:30]:
                if job.description and len(job.description) > 600:
                    continue
                d = portal.fetch_description(driver, job)
                if d:
                    self._set_description(job, d)
        finally:
            try:
                driver.quit()
            except Exception:
                pass
        return found, new

    def _set_description(self, job: portals.Job, text: str) -> None:
        skills = self._skills({"title": job.title, "description": text})
        db.run("UPDATE jobs SET description = ?, skills_json = ? WHERE portal = ? AND external_id = ?", (text, json.dumps(skills), job.portal, job.external_id))

    def _ensure_login(self, portal: portals.Portal, acct: dict, driver: Any, say) -> None:
        key = f"{portal.key}-{acct['id']}"
        if load_cookies(driver, key, portal.home_url) and portal.is_logged_in(driver):
            say(f"{portal.name}: session restored for {acct['username']}")
        else:
            say(f"{portal.name}: logging in as {acct['username']}")
            try:
                pw = decrypt(acct["password_enc"]) if acct["password_enc"] else ""
            except ValueError as e:
                raise portals.LoginError(str(e))
            portal.login(driver, acct["username"], pw)
            save_cookies(driver, key)
        db.run("UPDATE portal_accounts SET status = 'ok', last_login_at = ?, last_error = '', updated_at = ? WHERE id = ?", (db.now_ms(), db.now_ms(), acct["id"]))

    @staticmethod
    def _skills(job: dict) -> list[str]:
        return [s for s, _ in find_skills(f"{job.get('title', '')}\n{job.get('description', '')}")][:15]

    def _store(self, jobs: list[portals.Job], rid: int) -> tuple[int, int, list[portals.Job]]:
        new = 0
        new_jobs = []
        for job in jobs:
            d = job.as_dict()
            d["skills"] = self._skills(d)
            if db.upsert_job(d, rid):
                new += 1
                new_jobs.append(job)
        return len(jobs), new, new_jobs

    # ---------- login test ----------
    def test_account(self, aid: int) -> dict:
        a = db.get_account(aid)
        if not a:
            raise LookupError("No such account.")
        portal = portals.get(a["portal"])
        if self.is_busy():
            raise RuntimeError("Wait for the current scrape run to finish before testing a login.")
        try:
            driver = portal.open_browser()
        except Exception as e:
            msg = str(e) if isinstance(e, BrowserError) else f"The browser could not start on the server ({str(e)[:200]})."
            db.run("UPDATE portal_accounts SET status='error', last_error=?, updated_at=? WHERE id=?", (msg[:500], db.now_ms(), aid))
            return {"ok": False, "error": msg}
        try:
            clear_cookies(f"{portal.key}-{aid}")
            pw = decrypt(a["password_enc"]) if a["password_enc"] else ""
            portal.login(driver, a["username"], pw)
            save_cookies(driver, f"{portal.key}-{aid}")
            db.run("UPDATE portal_accounts SET status='ok', last_login_at=?, last_error='', updated_at=? WHERE id=?", (db.now_ms(), db.now_ms(), aid))
            return {"ok": True}
        except Exception as e:
            msg = str(e)
            db.run("UPDATE portal_accounts SET status='error', last_error=?, updated_at=? WHERE id=?", (msg[:500], db.now_ms(), aid))
            return {"ok": False, "error": msg}
        finally:
            try:
                driver.quit()
            except Exception:
                pass

    # ---------- matching ----------
    def rematch(self, uids: list[str] | None = None) -> int:
        rows = db.q("SELECT * FROM consultants")
        jobs = [db.job_row(r, full=True) for r in db.q("SELECT * FROM jobs")]
        n = 0
        for r in rows:
            if uids and r["uid"] not in uids:
                continue
            prof = db.j(r["profile_json"], {})
            if not prof.get("skills") and not prof.get("titles"):
                continue
            self.rematch_one(r["uid"], prof, jobs)
            n += 1
        return n

    def rematch_one(self, uid: str, profile: dict, jobs: list[dict] | None = None) -> int:
        if jobs is None:
            jobs = [db.job_row(r, full=True) for r in db.q("SELECT * FROM jobs")]
        existing = {r["job_id"]: r["state"] for r in db.q("SELECT job_id, state FROM matches WHERE uid = ?", (uid,))}
        t = db.now_ms()
        kept = 0
        with db.tx() as c:
            for job in jobs:
                score, reasons = score_job(job, profile)
                st = existing.get(job["id"])
                if st is None:
                    if score < settings.min_score:
                        continue
                    c.execute("INSERT INTO matches (uid, job_id, score, reasons_json, state, updated_at) VALUES (?,?,?,?,?,?)", (uid, job["id"], score, json.dumps(reasons), "new", t))
                elif st == "new" and score < settings.min_score:
                    c.execute("DELETE FROM matches WHERE uid = ? AND job_id = ?", (uid, job["id"]))
                    continue
                else:
                    c.execute("UPDATE matches SET score = ?, reasons_json = ? WHERE uid = ? AND job_id = ?", (score, json.dumps(reasons), uid, job["id"]))
                kept += 1
        return kept


class LoginSessions:
    """Interactive portal logins started from the Job grabber page.

    The browser runs on the server; when the site asks for a verification code the
    session waits (up to five minutes) for the code typed in the StratEdge portal.
    """

    CODE_WAIT = 300

    def __init__(self, runner: "Runner") -> None:
        self.runner = runner
        self.lock = threading.Lock()
        self.sessions: dict[int, dict] = {}

    def active(self) -> bool:
        with self.lock:
            return any(s["state"] in ("running", "needs_code") for s in self.sessions.values())

    def status(self, aid: int) -> dict:
        with self.lock:
            s = self.sessions.get(aid)
            return {k: v for k, v in s.items() if k not in ("event", "code")} if s else {"state": "idle", "message": ""}

    def start(self, aid: int) -> dict:
        a = db.get_account(aid)
        if not a:
            raise LookupError("No such account.")
        if self.runner.is_busy():
            raise RuntimeError("Wait for the current job collection to finish before logging in.")
        with self.lock:
            cur = self.sessions.get(aid)
            if cur and cur["state"] in ("running", "needs_code"):
                raise RuntimeError("A login for this account is already in progress.")
            s = {"state": "running", "message": "Opening the browser on the server…", "started_at": db.now_ms(), "updated_at": db.now_ms(), "event": threading.Event(), "code": ""}
            self.sessions[aid] = s
        t = threading.Thread(target=self._run, args=(aid, dict(a), s), name=f"jobserver-login-{aid}", daemon=True)
        t.start()
        return self.status(aid)

    def submit_code(self, aid: int, code: str) -> dict:
        with self.lock:
            s = self.sessions.get(aid)
            if not s or s["state"] != "needs_code":
                raise RuntimeError("This login is not waiting for a code.")
            s["code"] = code.strip()
            s["state"] = "running"
            s["message"] = "Checking the code…"
            s["updated_at"] = db.now_ms()
            s["event"].set()
        return self.status(aid)

    def cancel(self, aid: int) -> None:
        with self.lock:
            s = self.sessions.get(aid)
            if s and s["state"] in ("running", "needs_code"):
                s["code"] = ""
                s["state"] = "cancelled"
                s["event"].set()

    def _set(self, s: dict, state: str, message: str) -> None:
        with self.lock:
            s["state"] = state
            s["message"] = message
            s["updated_at"] = db.now_ms()

    def _run(self, aid: int, a: dict, s: dict) -> None:
        portal = portals.get(a["portal"])
        key = f"{portal.key}-{aid}"

        def ask_code() -> str:
            self._set(s, "needs_code", f"{portal.name} sent a verification code. Type it below.")
            s["event"].clear()
            s["event"].wait(self.CODE_WAIT)
            with self.lock:
                return s["code"] if s["state"] == "running" else ""

        try:
            driver = portal.open_browser()
        except Exception as e:
            self._set(s, "error", str(e) if isinstance(e, BrowserError) else f"The browser could not start on the server ({str(e)[:200]}).")
            db.run("UPDATE portal_accounts SET status='error', last_error=?, updated_at=? WHERE id=?", (s["message"][:500], db.now_ms(), aid))
            return
        try:
            clear_cookies(key)
            pw = decrypt(a["password_enc"]) if a["password_enc"] else ""
            self._set(s, "running", f"Signing in to {portal.name} as {a['username']}…")
            portal.login(driver, a["username"], pw, ask_code)
            save_cookies(driver, key)
            db.run("UPDATE portal_accounts SET status='ok', last_login_at=?, last_error='', updated_at=? WHERE id=?", (db.now_ms(), db.now_ms(), aid))
            self._set(s, "ok", f"Signed in to {portal.name}. The session is saved for job collection.")
        except Exception as e:
            msg = str(e)
            db.run("UPDATE portal_accounts SET status='error', last_error=?, updated_at=? WHERE id=?", (msg[:500], db.now_ms(), aid))
            self._set(s, "error", msg)
        finally:
            try:
                driver.quit()
            except Exception:
                pass

    def logout(self, aid: int) -> None:
        a = db.get_account(aid)
        if not a:
            raise LookupError("No such account.")
        self.cancel(aid)
        clear_cookies(f"{a['portal']}-{aid}")
        db.run("UPDATE portal_accounts SET status='untested', last_error='', updated_at=? WHERE id=?", (db.now_ms(), aid))
        with self.lock:
            self.sessions.pop(aid, None)


runner = Runner()
