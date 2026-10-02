"""Small HTML helpers shared by the adapters (BeautifulSoup based, pure)."""
from __future__ import annotations

import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import clean

LOC_RE = re.compile(r"\b([A-Z][A-Za-z.'\- ]{1,30},\s*[A-Z]{2})\b(?:\s*\d{5})?|\b(Remote|Hybrid|United States|USA)\b")
POSTED_RE = re.compile(r"((?:Posted\s+)?(?:\d+\+?\s*(?:minutes?|hours?|days?|weeks?|months?)\s+ago|today|yesterday|just now|moments ago|\d+d|\d+h))", re.IGNORECASE)
SALARY_RE = re.compile(r"(\$\s?\d[\d,.]*\s?[kK]?(?:\s*(?:-|to|–)\s*\$?\s?\d[\d,.]*\s?[kK]?)?\s*(?:/|per|an?)?\s*(?:hour|hr|year|yr|annum|month)?)", re.IGNORECASE)


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html or "", "html.parser")


def text(el: Tag | None) -> str:
    return clean(el.get_text(" ", strip=True)) if el is not None else ""


def first(el: Tag, selectors: list[str]) -> Tag | None:
    for s in selectors:
        try:
            f = el.select_one(s)
        except Exception:
            f = None
        if f is not None:
            return f
    return None


def card_of(anchor: Tag, levels: int = 5, max_chars: int = 1200) -> Tag:
    """Walk up from a job-title link to the element that holds the whole card."""
    node: Tag = anchor
    best = anchor
    for _ in range(levels):
        if node.parent is None or not isinstance(node.parent, Tag) or node.parent.name in ("body", "html", "main", "ul", "ol"):
            break
        node = node.parent
        t = node.get_text(" ", strip=True)
        if len(t) > max_chars:
            break
        best = node
    return best


def absolute(href: str, base: str) -> str:
    return urljoin(base, href or "")


def find_location(t: str) -> str:
    m = LOC_RE.search(t)
    return clean(m.group(0)) if m else ""


def find_posted(t: str) -> str:
    m = POSTED_RE.search(t)
    return clean(m.group(1)).replace("Posted ", "") if m else ""


def find_salary(t: str) -> str:
    m = SALARY_RE.search(t)
    return clean(m.group(1)) if m else ""
