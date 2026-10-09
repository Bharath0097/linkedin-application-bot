"""Read a resume (PDF, Word, text) and turn it into a search profile.

The profile is what the scraper and matcher work from: the skills found, likely job
titles, years of experience, location and seniority. Consultants can override or add
to it from the portal (their preferences are merged in build_profile).
"""
from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from typing import Iterable

from .skills import SENIORITY, SKILLS, TITLES

_WORD = r"(?<![A-Za-z0-9+#./])"
_WORD_END = r"(?![A-Za-z0-9+#])"


def _pattern(alias: str) -> re.Pattern:
    return re.compile(_WORD + re.escape(alias) + _WORD_END, re.IGNORECASE)


SKILL_PATTERNS: list[tuple[str, re.Pattern]] = [(canon, _pattern(a)) for canon, aliases in SKILLS.items() for a in aliases]
TITLE_PATTERNS: list[tuple[str, re.Pattern]] = [(t, _pattern(t)) for t in sorted(TITLES, key=len, reverse=True)]

US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC"
LOCATION_RE = re.compile(r"\b([A-Z][a-zA-Z.'\- ]{2,30}),\s*(" + US_STATES + r")\b(?:\s*\d{5})?")
YEARS_RE = re.compile(r"\b(\d{1,2})\s*\+?\s*(?:years|yrs)\b", re.IGNORECASE)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")


class ResumeError(ValueError):
    pass


# ---------- text extraction ----------
def extract_text(data: bytes, filename: str) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        return _pdf_text(data)
    if name.endswith(".docx") or data[:2] == b"PK":
        return _docx_text(data)
    if name.endswith((".txt", ".md", ".rtf", ".csv")) or not name:
        return _plain_text(data)
    return _plain_text(data)


def _plain_text(data: bytes) -> str:
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "ignore")


def _pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:  # pragma: no cover
        raise ResumeError("PDF support needs the pypdf package (pip install pypdf).") from e
    try:
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages[:30]:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts)
    except Exception as e:  # corrupt / encrypted
        raise ResumeError(f"The PDF could not be read: {e}") from e
    if not text.strip():
        raise ResumeError("No text was found in this PDF. It may be a scanned image; upload a text-based PDF or a Word file.")
    return text


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if n.startswith("word/") and n.endswith(".xml") and ("document" in n or "header" in n or "footer" in n)]
            if "word/document.xml" not in z.namelist():
                raise ResumeError("This is not a Word (.docx) document.")
            out = []
            for n in sorted(names, key=lambda x: (x != "word/document.xml", x)):
                xml = z.read(n).decode("utf-8", "ignore")
                xml = re.sub(r"</w:p>", "\n", xml)
                xml = re.sub(r"<w:tab/>", "\t", xml)
                xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
                out.append(re.sub(r"<[^>]+>", "", xml))
            text = "\n".join(out)
    except zipfile.BadZipFile as e:
        raise ResumeError("The Word file could not be opened. Save it again as .docx and retry.") from e
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    if not text.strip():
        raise ResumeError("No text was found in this document.")
    return text


# ---------- analysis ----------
def normalize(text: str) -> str:
    text = text.replace("•", "\n").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def find_skills(text: str) -> list[tuple[str, int]]:
    """Skills mentioned in the text with how often, most frequent first."""
    counts: Counter[str] = Counter()
    for canon, pat in SKILL_PATTERNS:
        n = len(pat.findall(text))
        if n:
            counts[canon] += n
    return counts.most_common()


def find_titles(text: str, limit: int = 4) -> list[str]:
    """Likely job titles: the earliest title mentions in the resume weigh most."""
    head = text[:1500]
    scores: dict[str, float] = {}
    for title, pat in TITLE_PATTERNS:
        hits = [m.start() for m in pat.finditer(text)]
        if not hits:
            continue
        s = len(hits) + (3 if pat.search(head) else 0) + (2 if hits[0] < 400 else 0)
        # prefer specific titles over the generic ones they contain
        scores[title] = s + len(title) / 100
    ordered = sorted(scores, key=scores.get, reverse=True)
    out: list[str] = []
    for t in ordered:
        if any(t in o or o in t for o in out):
            continue
        out.append(t)
        if len(out) >= limit:
            break
    return [t.title().replace("Sap", "SAP").replace("Sdet", "SDET").replace("Qa", "QA").replace("Dba", "DBA").replace("Etl", "ETL").replace("Bi ", "BI ").replace("Ios", "iOS").replace("It ", "IT ").replace("Hl7", "HL7").replace("Ehr", "EHR").replace("Rpa", "RPA").replace("Crm", "CRM").replace("Erp", "ERP").replace("Ui ", "UI ").replace("Ux", "UX").replace("Soc", "SOC").replace("Ebs", "EBS").replace("Mm ", "MM ").replace("Sd ", "SD ").replace("Pp ", "PP ").replace("Hcm", "HCM").replace("Fico", "FICO").replace("Abap", "ABAP").replace("Aws", "AWS").replace("Iam", "IAM").replace(".Net", ".NET").replace("Api", "API") for t in out]


def find_years(text: str) -> int:
    best = 0
    for m in YEARS_RE.finditer(text[:4000]):
        n = int(m.group(1))
        if 0 < n <= 45:
            best = max(best, n)
    if best:
        return best
    # fall back to the span of years mentioned in the work history
    years = [int(y) for y in re.findall(r"\b(19[89]\d|20[0-4]\d)\b", text)]
    if len(years) >= 2:
        return max(0, min(45, max(years) - min(years)))
    return 0


def find_location(text: str) -> str:
    m = LOCATION_RE.search(text[:2500]) or LOCATION_RE.search(text)
    return f"{m.group(1).strip()}, {m.group(2)}" if m else ""


def find_seniority(titles: Iterable[str], years: int, head: str = "") -> str:
    for source in (" ".join(titles).lower(), head.lower()):
        for key, label in SENIORITY:
            if re.search(r"(?<![a-z])" + re.escape(key.strip()) + r"(?![a-z])", source):
                return label
    if years >= 10:
        return "Senior"
    if years >= 4:
        return "Mid"
    return "Junior" if years else ""


def build_profile(text: str, prefs: dict | None = None) -> dict:
    """Combine what the resume says with the consultant's own preferences."""
    prefs = prefs or {}
    text = normalize(text)
    skills = find_skills(text)
    titles = find_titles(text)
    years = find_years(text)
    loc = find_location(text)
    pref_titles = [t.strip() for t in _listish(prefs.get("titles")) if t.strip()]
    pref_skills = [s.strip() for s in _listish(prefs.get("skills")) if s.strip()]
    all_titles = _dedupe(pref_titles + ([prefs["title"]] if prefs.get("title") else []) + titles)[:6]
    skill_names = _dedupe(pref_skills + [s for s, _ in skills])[:40]
    return {
        "skills": skill_names,
        "skill_counts": dict(skills[:40]),
        "titles": all_titles,
        "years": years,
        "location": (prefs.get("location") or loc or "").strip(),
        "locations": _dedupe([l.strip() for l in _listish(prefs.get("locations")) if l.strip()] + ([prefs["location"]] if prefs.get("location") else []) + ([loc] if loc else [])),
        "seniority": find_seniority(all_titles, years, text[:600]),
        "remote": prefs.get("remote", "any"),
        "job_types": _listish(prefs.get("job_types")),
        "exclude": [k.strip().lower() for k in _listish(prefs.get("exclude")) if k.strip()],
        "keywords": [k.strip() for k in _listish(prefs.get("keywords")) if k.strip()],
        "words": len(text.split()),
    }


def search_queries(profile: dict, default_location: str, limit: int = 8) -> list[dict]:
    """The searches a consultant's profile asks for: top titles × preferred locations."""
    titles = (profile.get("titles") or [])[:3] or [" ".join((profile.get("skills") or ["IT"])[:2])]
    locs = (profile.get("locations") or [])[:2] or [profile.get("location") or default_location]
    if profile.get("remote") == "remote":
        locs = ["Remote"] + [l for l in locs if l.lower() != "remote"]
    out = []
    for t in titles:
        for l in locs:
            out.append({"q": t, "location": l, "remote": profile.get("remote", "any")})
            if len(out) >= limit:
                return out
    return out


def _listish(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [x for x in re.split(r"[,;\n]", v) if x.strip()]
    return [str(x) for x in v]


def _dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for x in items:
        k = x.strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(x.strip())
    return out
