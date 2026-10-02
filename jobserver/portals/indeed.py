"""Indeed adapter.

Indeed's search page carries its result list as JSON (the "mosaic" provider data), so
the parser reads that first and falls back to the HTML cards. Indeed logs people in
with an emailed code more often than not; a stored password is tried, and a clear
error is raised when a code is required.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import urlencode

from ..browser import page_text, try_find, wait_for
from ..settings import settings
from . import _html as H
from .base import Job, LoginError, Portal, SearchQuery, clean, guess_job_type, guess_remote

MOSAIC_RE = re.compile(r'window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{.*?\});\s*(?:window\.mosaic|</script>)', re.DOTALL)
JK_RE = re.compile(r"[?&]jk=([0-9a-f]{8,})|/viewjob/([0-9a-f]{8,})", re.IGNORECASE)


class Indeed(Portal):
    key = "indeed"
    name = "Indeed"
    home_url = "https://www.indeed.com/"
    login_url = "https://secure.indeed.com/account/login"
    needs_account = False
    notes = "Search works without an account. Indeed usually verifies logins with an emailed code; sign in once from a browser on the server to keep a session."

    def search_url(self, query: SearchQuery) -> str:
        p = {"q": query.q, "l": query.location or settings.default_location, "fromage": str(max(1, query.posted_days)), "start": str((query.page - 1) * 10), "sort": "date"}
        if query.remote == "remote":
            p["sc"] = "0kf:attr(DSQF7);"
        return "https://www.indeed.com/jobs?" + urlencode(p)

    def parse_listing(self, html: str, query: str = "") -> list[Job]:
        m = MOSAIC_RE.search(html or "")
        if m:
            try:
                data = json.loads(m.group(1))
                results = data.get("metaData", {}).get("mosaicProviderJobCardsModel", {}).get("results", [])
                jobs = [self._from_result(r, query) for r in results if r.get("jobkey")]
                if jobs:
                    return jobs
            except (ValueError, AttributeError):
                pass
        s = H.soup(html)
        out: list[Job] = []
        seen: set[str] = set()
        for a in s.select("a.jcs-JobTitle, h2.jobTitle a, a[data-jk], a[href*='/viewjob?jk='], a[href*='/rc/clk?jk=']"):
            jk = a.get("data-jk") or ""
            if not jk:
                mm = JK_RE.search(a.get("href", ""))
                jk = (mm.group(1) or mm.group(2)) if mm else ""
            title = H.text(a) or clean(a.get("aria-label", ""))
            if not jk or jk in seen or not title:
                continue
            seen.add(jk)
            card = H.card_of(a)
            ctext = card.get_text(" | ", strip=True)
            company = H.text(H.first(card, ['[data-testid="company-name"]', ".companyName", ".company"]))
            location = H.text(H.first(card, ['[data-testid="text-location"]', ".companyLocation", ".location"])) or H.find_location(ctext)
            salary = H.text(H.first(card, [".salary-snippet-container", '[data-testid="attribute_snippet_testid"]', ".estimated-salary"])) or H.find_salary(ctext)
            posted = H.text(H.first(card, ['[data-testid="myJobsStateDate"]', ".date"])) or H.find_posted(ctext)
            out.append(Job(portal=self.key, external_id=jk, title=title, company=company, location=location, url=f"https://www.indeed.com/viewjob?jk={jk}",
                           remote=guess_remote(location, ctext), job_type=guess_job_type(ctext), salary=salary, posted=posted, description=clean(ctext)[:1500], query=query))
        return out

    def _from_result(self, r: dict, query: str) -> Job:
        jk = r.get("jobkey", "")
        loc = r.get("formattedLocation") or r.get("jobLocationCity", "")
        remote = (r.get("remoteWorkModel") or {}).get("text", "") if isinstance(r.get("remoteWorkModel"), dict) else ""
        types = ", ".join(r.get("jobTypes") or [])
        salary = (r.get("salarySnippet") or {}).get("text", "") if isinstance(r.get("salarySnippet"), dict) else (r.get("extractedSalary") or {}).get("text", "") if isinstance(r.get("extractedSalary"), dict) else ""
        snippet = re.sub(r"<[^>]+>", " ", r.get("snippet", "") or "")
        return Job(portal=self.key, external_id=jk, title=clean(r.get("title") or r.get("displayTitle") or ""), company=clean(r.get("company", "")), location=clean(loc),
                   url=f"https://www.indeed.com/viewjob?jk={jk}", remote=guess_remote(remote, loc, snippet), job_type=types or guess_job_type(snippet),
                   salary=clean(salary), posted=clean(r.get("formattedRelativeTime", "")), description=clean(snippet)[:1500], query=query)

    def parse_description(self, html: str) -> str:
        s = H.soup(html)
        el = H.first(s, ["#jobDescriptionText", ".jobsearch-JobComponent-description", "main"])
        return clean(el.get_text("\n", strip=True))[:8000] if el else ""

    # ----- browser -----
    def is_logged_in(self, driver: Any) -> bool:
        try:
            driver.get("https://myjobs.indeed.com/")
            time.sleep(2)
            return "login" not in driver.current_url and "secure.indeed.com" not in driver.current_url
        except Exception:
            return False

    def login(self, driver: Any, username: str, password: str) -> None:
        driver.get(self.login_url)
        try:
            e = wait_for(driver, 'input[type="email"], input[name="__email"], #ifl-InputFormField-3', 20)
        except Exception as ex:
            raise LoginError("The Indeed login page did not load (Indeed may be showing a bot check).") from ex
        e.clear()
        e.send_keys(username)
        btn = try_find(driver, ['button[type="submit"]', 'button[data-tn-element="auth-page-email-submit-button"]'])
        if btn:
            btn.click()
        time.sleep(3)
        pw = try_find(driver, ['input[type="password"]', 'input[name="__password"]'])
        if not pw:
            body = page_text(driver).lower()
            if "code" in body or "verify" in body:
                raise LoginError("Indeed sent a one-time code instead of asking for a password. Sign in once from a browser on the server so the session is kept.")
            raise LoginError("Indeed did not show a password field (login with a code or Google only).")
        pw.clear()
        pw.send_keys(password)
        btn = try_find(driver, ['button[type="submit"]', 'button[data-tn-element="auth-page-password-submit-button"]'])
        if btn:
            btn.click()
        time.sleep(4)
        body = page_text(driver).lower()
        if "code" in body and ("enter" in body or "sent" in body):
            raise LoginError("Indeed is asking for a verification code. Complete it once in a browser on the server, then test again.")
        if not self.is_logged_in(driver):
            raise LoginError("Indeed rejected the login.")

    def search(self, driver: Any, query: SearchQuery) -> list[Job]:
        jobs: list[Job] = []
        for page in range(1, settings.max_pages + 1):
            q = SearchQuery(**{**query.__dict__, "page": page})
            driver.get(self.search_url(q))
            try:
                wait_for(driver, "#mosaic-provider-jobcards, .jobsearch-NoResult-messageContainer, #jobsearch-Main", 20)
            except Exception:
                pass
            time.sleep(settings.page_delay)
            found = self.parse_listing(driver.page_source, query.q)
            if not found:
                break
            jobs.extend(found)
            if len(found) < 10:
                break
        return jobs

    def fetch_description(self, driver: Any, job: Job) -> str:
        try:
            driver.get(job.url)
            wait_for(driver, "#jobDescriptionText, .jobsearch-JobComponent-description", 15)
            return self.parse_description(driver.page_source)
        except Exception:
            return ""
