"""Monster adapter (search without an account; optional login)."""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlencode

from ..browser import page_text, try_find, wait_for
from ..settings import settings
from . import _html as H
from .base import Job, LoginError, Portal, SearchQuery, clean, guess_job_type, guess_remote

ID_RE = re.compile(r"/job-openings/[^/?#]*?--([0-9a-f\-]{8,})|[?&]jobid=([0-9a-f\-]{8,})", re.IGNORECASE)


class Monster(Portal):
    key = "monster"
    name = "Monster"
    home_url = "https://www.monster.com/"
    login_url = "https://www.monster.com/profile/login"
    needs_account = False
    notes = "Search works without an account."

    def search_url(self, query: SearchQuery) -> str:
        p = {"q": query.q, "where": query.location or settings.default_location, "page": str(query.page), "so": "m.h.s", "recency": "last week" if query.posted_days <= 7 else "all"}
        return "https://www.monster.com/jobs/search?" + urlencode(p)

    def parse_listing(self, html: str, query: str = "") -> list[Job]:
        s = H.soup(html)
        out: list[Job] = []
        seen: set[str] = set()
        for a in s.select('a[data-testid="jobTitle"], a[href*="/job-openings/"]'):
            href = a.get("href", "")
            m = ID_RE.search(href)
            jid = (m.group(1) or m.group(2)).lower() if m else ""
            if not jid:
                jid = re.sub(r"[^a-z0-9]", "", href.lower())[-24:]
            title = H.text(a)
            if not jid or jid in seen or not title:
                continue
            seen.add(jid)
            card = H.card_of(a)
            ctext = card.get_text(" | ", strip=True)
            company = H.text(H.first(card, ['[data-testid="company"]', '[class*="company"]']))
            location = H.text(H.first(card, ['[data-testid="jobDetailLocation"]', '[data-testid="location"]', '[class*="location"]'])) or H.find_location(ctext)
            posted = H.text(H.first(card, ['[data-testid="jobDetailDateRecency"]', '[class*="posted"]'])) or H.find_posted(ctext)
            out.append(Job(portal=self.key, external_id=jid, title=title, company=company, location=location, url=H.absolute(href, self.home_url),
                           remote=guess_remote(location, ctext), job_type=guess_job_type(ctext), salary=H.find_salary(ctext), posted=posted, description=clean(ctext)[:1500], query=query))
        return out

    def is_logged_in(self, driver: Any) -> bool:
        try:
            driver.get("https://www.monster.com/profile/")
            time.sleep(2)
            return "login" not in driver.current_url
        except Exception:
            return False

    def login(self, driver: Any, username: str, password: str, ask_code: Any = None) -> None:
        driver.get(self.login_url)
        try:
            e = wait_for(driver, 'input[type="email"], input[name="email"]', 20)
        except Exception as ex:
            raise LoginError("The Monster login page did not load.") from ex
        e.clear()
        e.send_keys(username)
        pw = try_find(driver, ['input[type="password"]'])
        if not pw:
            btn = try_find(driver, ['button[type="submit"]'])
            if btn:
                btn.click()
            time.sleep(3)
            pw = try_find(driver, ['input[type="password"]'])
        if not pw:
            raise LoginError("Monster did not show a password field (code or social login only).")
        pw.clear()
        pw.send_keys(password)
        btn = try_find(driver, ['button[type="submit"]'])
        if btn:
            btn.click()
        time.sleep(4)
        if self.needs_code(driver):
            self.handle_code(driver, ask_code)
        if not self.is_logged_in(driver):
            raise LoginError("Monster rejected the login.")

    def search(self, driver: Any, query: SearchQuery) -> list[Job]:
        jobs: list[Job] = []
        for page in range(1, settings.max_pages + 1):
            q = SearchQuery(**{**query.__dict__, "page": page})
            driver.get(self.search_url(q))
            try:
                wait_for(driver, 'a[data-testid="jobTitle"], a[href*="/job-openings/"], h1', 20)
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
            wait_for(driver, '[data-testid="svx-description-container-inner"], .job-description, main', 15)
            el = try_find(driver, ['[data-testid="svx-description-container-inner"]', '.job-description', 'main'])
            return clean(el.text)[:8000] if el else ""
        except Exception:
            return ""
