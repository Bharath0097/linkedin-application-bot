"""Shared contract for job-portal adapters.

An adapter knows how to log in to one job site with a stored account, how to build a
search, and how to read the results. Adapters keep the Selenium parts separate from
pure functions (search URLs, HTML parsing) so the latter can be unit tested.
"""
from __future__ import annotations

import dataclasses
import re
from typing import Any


class LoginError(RuntimeError):
    """The portal did not accept the login (bad password, captcha, verification step)."""


class PortalError(RuntimeError):
    """Something else went wrong while talking to the portal."""


@dataclasses.dataclass
class SearchQuery:
    q: str
    location: str = ""
    remote: str = "any"  # any | remote | onsite
    posted_days: int = 7
    page: int = 1


@dataclasses.dataclass
class Job:
    portal: str
    external_id: str
    title: str
    company: str = ""
    location: str = ""
    url: str = ""
    remote: str = ""
    job_type: str = ""
    salary: str = ""
    posted: str = ""
    description: str = ""
    query: str = ""

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


CODE_WORDS = ("verification code", "enter the code", "security code", "one-time", "one time code", "passcode", "verify it's you", "enter the pin", "confirmation code", "code we sent", "6-digit")
CODE_SELECTORS = ['input[autocomplete="one-time-code"]', 'input[name*="code" i]', 'input[id*="code" i]', 'input[name*="pin" i]', 'input[id*="pin" i]', 'input[name*="passcode" i]', 'input[name*="otp" i]', 'input[inputmode="numeric"]', 'input[type="tel"]', 'input[type="text"]']


class Portal:
    key: str = ""
    name: str = ""
    home_url: str = ""
    login_url: str = ""
    needs_account: bool = True          # False: can search without a login (used even with no account configured)
    supports_requests: bool = False     # True: has a search path that works without a browser
    notes: str = ""

    # ----- browser based -----
    def open_browser(self) -> Any:
        from ..browser import make_driver

        return make_driver()

    def login(self, driver: Any, username: str, password: str, ask_code: Any = None) -> None:
        """Sign in. ask_code, when given, is called if the site wants a verification code; it blocks until the
        person types the code in the StratEdge portal (or returns '' on timeout)."""
        raise LoginError(f"{self.name} login is not implemented.")

    def needs_code(self, driver: Any) -> bool:
        from ..browser import page_text

        body = page_text(driver).lower()
        return any(w in body for w in CODE_WORDS) and bool(self._code_field(driver))

    def _code_field(self, driver: Any) -> Any:
        from ..browser import try_find

        el = try_find(driver, CODE_SELECTORS[:-1])
        if el is not None:
            return el
        el = try_find(driver, [CODE_SELECTORS[-1]])
        return el

    def handle_code(self, driver: Any, ask_code: Any) -> None:
        """Called when the site shows a verification-code prompt."""
        import time

        from ..browser import try_find

        if ask_code is None:
            raise LoginError(f"{self.name} is asking for a verification code. Use \"Log in\" on the Job grabber page, which lets you type the code.")
        code = (ask_code() or "").strip()
        if not code:
            raise LoginError("No verification code was entered in time. Start the login again.")
        field = self._code_field(driver)
        if field is None:
            raise LoginError("The verification-code field disappeared. Start the login again.")
        field.clear()
        field.send_keys(code)
        btn = try_find(driver, ['button[type="submit"]', 'input[type="submit"]', 'button[id*="submit" i]', 'button'])
        if btn:
            try:
                btn.click()
            except Exception:
                from selenium.webdriver.common.keys import Keys

                field.send_keys(Keys.ENTER)
        time.sleep(5)
        if self.needs_code(driver):
            raise LoginError("The site did not accept that verification code.")

    def is_logged_in(self, driver: Any) -> bool:
        return False

    def search(self, driver: Any, query: SearchQuery) -> list[Job]:
        raise PortalError(f"{self.name} search is not implemented.")

    def fetch_description(self, driver: Any, job: Job) -> str:
        return ""

    # ----- pure -----
    def search_url(self, query: SearchQuery) -> str:
        raise NotImplementedError

    def search_requests(self, query: SearchQuery, session: Any = None) -> list[Job]:
        raise PortalError(f"{self.name} has no login-free search.")

    def describe(self) -> dict:
        return {"key": self.key, "name": self.name, "needs_account": self.needs_account, "login_url": self.login_url, "notes": self.notes}


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def guess_remote(*parts: str) -> str:
    t = " ".join(p or "" for p in parts).lower()
    if re.search(r"\bhybrid\b", t):
        return "Hybrid"
    if re.search(r"\b(remote|work from home|wfh|telecommut)", t):
        return "Remote"
    if re.search(r"\b(on-?site|onsite|in office)\b", t):
        return "On-site"
    return ""


def guess_job_type(*parts: str) -> str:
    t = " ".join(p or "" for p in parts).lower()
    found = []
    for k, label in (("contract to hire", "Contract-to-hire"), ("c2h", "Contract-to-hire"), ("contract", "Contract"), ("c2c", "C2C"), ("corp to corp", "C2C"),
                     ("w2", "W2"), ("1099", "1099"), ("full-time", "Full-time"), ("full time", "Full-time"), ("fulltime", "Full-time"), ("part-time", "Part-time"), ("part time", "Part-time"), ("internship", "Internship")):
        if k in t and label not in found:
            found.append(label)
    return ", ".join(found)
