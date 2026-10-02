"""Dice.com adapter: account login and job search.

Dice logs in with an email, then a password (two steps). Search works without a login
too, but a signed-in session sees more results and is not rate limited as hard.
"""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlencode

from ..browser import page_text, try_find, wait_for
from ..settings import settings
from . import _html as H
from .base import Job, LoginError, Portal, PortalError, SearchQuery, clean, guess_job_type, guess_remote

JOB_ID_RE = re.compile(r"/job-detail/([0-9a-f\-]{8,})", re.IGNORECASE)


class Dice(Portal):
    key = "dice"
    name = "Dice"
    home_url = "https://www.dice.com/"
    login_url = "https://www.dice.com/dashboard/login"
    needs_account = False
    notes = "Email + password login. If Dice asks for a verification code, log in once from a browser on the server, then retry."

    # ----- pure -----
    def search_url(self, query: SearchQuery) -> str:
        days = {1: "ONE", 3: "THREE", 7: "SEVEN"}.get(query.posted_days, "SEVEN")
        params = {"q": query.q, "location": query.location or "United States", "radius": "30", "radiusUnit": "mi", "page": str(query.page), "pageSize": "20",
                  "filters.postedDate": days, "language": "en"}
        if query.remote == "remote":
            params["filters.workplaceTypes"] = "Remote"
        return "https://www.dice.com/jobs?" + urlencode(params)

    def parse_listing(self, html: str, query: str = "") -> list[Job]:
        s = H.soup(html)
        out: list[Job] = []
        seen: set[str] = set()
        anchors = s.select('a[data-testid="job-search-job-detail-link"], a[href*="/job-detail/"]')
        for a in anchors:
            href = a.get("href", "")
            m = JOB_ID_RE.search(href)
            if not m:
                continue
            jid = m.group(1).lower()
            title = H.text(a) or clean(a.get("aria-label", ""))
            if jid in seen or not title:
                continue
            seen.add(jid)
            card = H.card_of(a)
            ctext = card.get_text(" | ", strip=True)
            company_el = H.first(card, ['a[href*="/company-profile/"]', '[data-testid*="company"]', '[class*="company"]', '[data-cy="search-result-company-name"]'])
            company = H.text(company_el)
            loc_el = H.first(card, ['[data-testid*="location"]', '[data-cy="search-result-location"]', '[class*="location"]'])
            location = H.text(loc_el) or H.find_location(ctext)
            posted_el = H.first(card, ['[data-testid*="posted"]', '[data-cy="card-posted-date"]', '[class*="posted"]'])
            posted = H.text(posted_el) or H.find_posted(ctext)
            emp_el = H.first(card, ['[data-testid*="employment"]', '[data-cy="search-result-employment-type"]'])
            job_type = guess_job_type(H.text(emp_el), ctext)
            out.append(Job(portal=self.key, external_id=jid, title=title, company=company, location=location, url=H.absolute(href, self.home_url),
                           remote=guess_remote(location, ctext), job_type=job_type, salary=H.find_salary(ctext), posted=posted,
                           description=clean(ctext)[:1500], query=query))
        return out

    # ----- browser -----
    def is_logged_in(self, driver: Any) -> bool:
        try:
            driver.get("https://www.dice.com/dashboard")
            time.sleep(2)
            url = driver.current_url
            if "/login" in url:
                return False
            return bool(try_find(driver, ['[data-testid="user-menu"]', 'a[href*="/dashboard/profiles"]', 'a[href*="/dashboard"]', '[aria-label*="account" i]']))
        except Exception:
            return False

    def login(self, driver: Any, username: str, password: str) -> None:
        driver.get(self.login_url)
        try:
            email = wait_for(driver, 'input[type="email"], input[name="email"], #email', 20)
        except Exception as e:
            raise LoginError("The Dice login page did not load.") from e
        email.clear()
        email.send_keys(username)
        btn = try_find(driver, ['button[type="submit"]', '[data-testid="sign-in-button"]', 'button'])
        if btn:
            btn.click()
        try:
            pw = wait_for(driver, 'input[type="password"]', 20)
        except Exception as e:
            raise LoginError("Dice did not ask for a password. The email may be unknown, or a verification step is in the way.") from e
        pw.clear()
        pw.send_keys(password)
        btn = try_find(driver, ['button[type="submit"]', '[data-testid="submit-password"]', 'button'])
        if btn:
            btn.click()
        time.sleep(4)
        body = page_text(driver).lower()
        if "verification code" in body or "verify your" in body or "one-time" in body:
            raise LoginError("Dice is asking for a verification code. Complete it once in a browser on the server, then test again.")
        if "/login" in driver.current_url and ("incorrect" in body or "invalid" in body or "password" in body):
            raise LoginError("Dice rejected the email or password.")
        if not self.is_logged_in(driver):
            raise LoginError("Dice login did not complete. Check the credentials or a captcha.")

    def search(self, driver: Any, query: SearchQuery) -> list[Job]:
        jobs: list[Job] = []
        for page in range(1, settings.max_pages + 1):
            q = SearchQuery(**{**query.__dict__, "page": page})
            driver.get(self.search_url(q))
            try:
                wait_for(driver, 'a[href*="/job-detail/"], [data-testid="job-search-no-results"], h1', 20)
            except Exception:
                pass
            time.sleep(settings.page_delay)
            found = self.parse_listing(driver.page_source, query.q)
            if not found:
                break
            jobs.extend(found)
            if len(found) < 15:
                break
        return jobs

    def fetch_description(self, driver: Any, job: Job) -> str:
        try:
            driver.get(job.url)
            wait_for(driver, '[data-testid="jobDescriptionHtml"], #jobDescription, .job-description, main', 15)
            time.sleep(1)
            el = try_find(driver, ['[data-testid="jobDescriptionHtml"]', '#jobDescription', '.job-description', 'main'])
            return clean(el.text)[:8000] if el else ""
        except Exception:
            return ""
