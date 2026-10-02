"""LinkedIn adapter.

Two ways in:
  * guest search (no account) through LinkedIn's public job listing endpoint, read
    with plain HTTP; this is what runs when no LinkedIn account is configured;
  * a signed-in browser session with a stored account (same login flow as the
    original Easy Apply bot), which sees the full job search.
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

GUEST_SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
GUEST_DETAIL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{id}"
ID_RE = re.compile(r"(?:jobPosting:|/jobs/view/(?:[^/?#]*?-)?|currentJobId=)(\d{4,})")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


class LinkedIn(Portal):
    key = "linkedin"
    name = "LinkedIn"
    home_url = "https://www.linkedin.com/"
    login_url = "https://www.linkedin.com/login"
    needs_account = False
    supports_requests = True
    notes = "Works without an account (public job search). Add an account for the full signed-in search; LinkedIn may ask for a one-time code on a new server."

    # ----- pure -----
    def _params(self, query: SearchQuery, start: int) -> dict:
        p = {"keywords": query.q, "location": query.location or settings.default_location, "f_TPR": f"r{max(1, query.posted_days) * 86400}", "start": str(start), "sortBy": "DD"}
        if query.remote == "remote":
            p["f_WT"] = "2"
        return p

    def search_url(self, query: SearchQuery) -> str:
        return "https://www.linkedin.com/jobs/search/?" + urlencode(self._params(query, (query.page - 1) * 25))

    def guest_url(self, query: SearchQuery) -> str:
        return GUEST_SEARCH + "?" + urlencode(self._params(query, (query.page - 1) * 25))

    def parse_listing(self, html: str, query: str = "") -> list[Job]:
        s = H.soup(html)
        out: list[Job] = []
        seen: set[str] = set()
        cards = s.select("div.base-card, li[data-occludable-job-id], div.job-card-container, li.jobs-search-results__list-item, div[data-job-id]")
        for c in cards:
            jid = c.get("data-entity-urn", "") or c.get("data-occludable-job-id", "") or c.get("data-job-id", "")
            m = ID_RE.search(jid) if jid else None
            if not m:
                link = H.first(c, ["a.base-card__full-link", "a.job-card-list__title", "a.job-card-container__link", "a[href*='/jobs/view/']"])
                m = ID_RE.search(link.get("href", "")) if link else None
            if not m:
                m = re.search(r"(\d{4,})", jid)
            if not m:
                continue
            jid = m.group(1)
            if jid in seen:
                continue
            title = H.text(H.first(c, ["h3.base-search-card__title", ".job-card-list__title", ".job-card-list__title--link", "a.job-card-container__link strong", "a.job-card-container__link", "h3", "a[href*='/jobs/view/']"]))
            if not title:
                continue
            seen.add(jid)
            company = H.text(H.first(c, ["h4.base-search-card__subtitle", ".job-card-container__primary-description", ".artdeco-entity-lockup__subtitle", ".job-card-container__company-name", "h4"]))
            location = H.text(H.first(c, ["span.job-search-card__location", ".job-card-container__metadata-item", ".artdeco-entity-lockup__caption", ".job-card-container__metadata-wrapper"]))
            link = H.first(c, ["a.base-card__full-link", "a.job-card-list__title", "a.job-card-container__link", "a[href*='/jobs/view/']"])
            href = link.get("href", "") if link else ""
            url = href.split("?")[0] if href else f"https://www.linkedin.com/jobs/view/{jid}/"
            posted_el = H.first(c, ["time.job-search-card__listdate", "time.job-search-card__listdate--new", "time"])
            posted = (posted_el.get("datetime") if posted_el else "") or H.text(posted_el)
            ctext = c.get_text(" | ", strip=True)
            out.append(Job(portal=self.key, external_id=jid, title=title, company=company, location=location, url=H.absolute(url, self.home_url),
                           remote=guess_remote(location, ctext), job_type=guess_job_type(ctext), salary=H.find_salary(ctext), posted=posted, description="", query=query))
        return out

    def parse_description(self, html: str) -> str:
        s = H.soup(html)
        el = H.first(s, ["div.show-more-less-html__markup", ".description__text", ".jobs-description__content", "#job-details", "article"])
        return clean(el.get_text("\n", strip=True))[:8000] if el else ""

    # ----- login-free (HTTP) -----
    def search_requests(self, query: SearchQuery, session: Any = None) -> list[Job]:
        import requests

        sess = session or requests.Session()
        sess.headers.setdefault("User-Agent", UA)
        sess.headers.setdefault("Accept-Language", "en-US,en;q=0.9")
        jobs: list[Job] = []
        for page in range(1, settings.max_pages + 1):
            q = SearchQuery(**{**query.__dict__, "page": page})
            try:
                r = sess.get(self.guest_url(q), timeout=30)
            except requests.RequestException as e:
                raise PortalError(f"LinkedIn did not answer: {e}") from e
            if r.status_code == 429:
                raise PortalError("LinkedIn is rate limiting this server (HTTP 429). Try again later or add a LinkedIn account.")
            if r.status_code >= 400:
                if page == 1:
                    raise PortalError(f"LinkedIn public search returned HTTP {r.status_code}.")
                break
            found = self.parse_listing(r.text, query.q)
            if not found:
                break
            jobs.extend(found)
            if len(found) < 10:
                break
            time.sleep(settings.page_delay)
        return jobs

    def fetch_description_requests(self, job: Job, session: Any = None) -> str:
        import requests

        sess = session or requests.Session()
        sess.headers.setdefault("User-Agent", UA)
        try:
            r = sess.get(GUEST_DETAIL.format(id=job.external_id), timeout=30)
            if r.status_code != 200:
                return ""
            return self.parse_description(r.text)
        except requests.RequestException:
            return ""

    # ----- browser -----
    def is_logged_in(self, driver: Any) -> bool:
        try:
            driver.get("https://www.linkedin.com/feed/")
            time.sleep(2)
            return "/feed" in driver.current_url and bool(try_find(driver, [".global-nav__me", "#global-nav", "img.global-nav__me-photo"]))
        except Exception:
            return False

    def login(self, driver: Any, username: str, password: str) -> None:
        driver.get(self.login_url)
        try:
            u = wait_for(driver, "#username", 20)
        except Exception as e:
            raise LoginError("The LinkedIn login page did not load.") from e
        u.clear()
        u.send_keys(username)
        p = try_find(driver, ["#password"])
        if not p:
            raise LoginError("LinkedIn login form changed; no password field found.")
        p.clear()
        p.send_keys(password)
        btn = try_find(driver, ['button[type="submit"]', ".login__form_action_container button"])
        if btn:
            btn.click()
        time.sleep(4)
        url = driver.current_url
        body = page_text(driver).lower()
        if "checkpoint" in url or "challenge" in url or "verification" in body or "verify" in body and "code" in body:
            raise LoginError("LinkedIn wants a security check (code or captcha) for this server. Sign in once from a browser on the server, then test again.")
        if "/login" in url or "wrong" in body or "couldn't find" in body:
            raise LoginError("LinkedIn rejected the email or password.")
        if not self.is_logged_in(driver):
            raise LoginError("LinkedIn login did not complete.")

    def search(self, driver: Any, query: SearchQuery) -> list[Job]:
        jobs: list[Job] = []
        for page in range(1, settings.max_pages + 1):
            q = SearchQuery(**{**query.__dict__, "page": page})
            driver.get(self.search_url(q))
            try:
                wait_for(driver, "li[data-occludable-job-id], div.base-card, .jobs-search-no-results-banner, .jobs-search-results-list", 20)
            except Exception:
                pass
            # let the lazy list render
            for _ in range(4):
                try:
                    driver.execute_script("const l=document.querySelector('.jobs-search-results-list, .scaffold-layout__list');if(l){l.scrollTop+=900}else{window.scrollBy(0,900)}")
                except Exception:
                    break
                time.sleep(0.7)
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
            wait_for(driver, "#job-details, .jobs-description__content, .show-more-less-html__markup, .description__text", 15)
            time.sleep(1)
            return self.parse_description(driver.page_source)
        except Exception:
            return ""
