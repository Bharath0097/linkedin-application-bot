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


class Portal:
    key: str = ""
    name: str = ""
    home_url: str = ""
    login_url: str = ""
    needs_account: bool = True          # False: can search without a login (used even with no account configured)
    supports_requests: bool = False     # True: has a search path that works without a browser
    notes: str = ""

    # ----- browser based -----
    def login(self, driver: Any, username: str, password: str) -> None:
        raise LoginError(f"{self.name} login is not implemented.")

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
