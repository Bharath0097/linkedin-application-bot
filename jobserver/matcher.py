"""Rank scraped jobs for one consultant.

The score (0-100) rewards skills the job asks for that the resume has, a title close
to what the consultant does, a location they want, recency and the consultant's own
keywords; it penalizes excluded words. Reasons are returned so the portal can show why.
"""
from __future__ import annotations

import re
import time

from .resume import find_skills

STOP = {"the", "and", "or", "of", "a", "an", "to", "for", "with", "in", "on", "at", "sr", "sr.", "senior", "jr", "junior", "lead", "ii", "iii", "iv", "i", "-", "/", "&"}
REMOTE_RE = re.compile(r"\b(remote|work from home|wfh|telecommute)\b", re.IGNORECASE)
HYBRID_RE = re.compile(r"\bhybrid\b", re.IGNORECASE)


def tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9+#.]+", (s or "").lower()) if t and t not in STOP}


def title_similarity(job_title: str, wanted: list[str]) -> tuple[float, str]:
    jt = tokens(job_title)
    if not jt:
        return 0.0, ""
    best, best_t = 0.0, ""
    for w in wanted:
        wt = tokens(w)
        if not wt:
            continue
        inter = len(jt & wt)
        if not inter:
            continue
        score = inter / len(wt) * 0.7 + inter / len(jt) * 0.3
        if w.lower() in job_title.lower():
            score = max(score, 0.95)
        if score > best:
            best, best_t = score, w
    return best, best_t


def location_match(job_loc: str, job_remote: str, profile: dict) -> tuple[float, str]:
    want_remote = profile.get("remote", "any")
    jl = (job_loc or "").lower()
    is_remote = bool(REMOTE_RE.search(job_remote or "")) or bool(REMOTE_RE.search(jl))
    is_hybrid = bool(HYBRID_RE.search(job_remote or "")) or bool(HYBRID_RE.search(jl))
    if want_remote == "remote":
        if is_remote:
            return 1.0, "Remote"
    if want_remote == "onsite" and is_remote and not is_hybrid:
        return 0.2, ""
    locs = [l.lower() for l in (profile.get("locations") or []) if l] or [(profile.get("location") or "").lower()]
    for l in locs:
        if not l:
            continue
        city = l.split(",")[0].strip()
        state = l.split(",")[1].strip() if "," in l else ""
        if city and city in jl:
            return 1.0, f"In {l.title()}"
        if state and re.search(r"\b" + re.escape(state) + r"\b", jl):
            return 0.7, f"In {state.upper()}"
    if is_remote:
        return 0.8 if want_remote != "onsite" else 0.2, "Remote"
    if is_hybrid:
        return 0.5, "Hybrid"
    if not jl or "united states" in jl:
        return 0.4, ""
    return 0.15, ""


def recency(job: dict) -> float:
    t = job.get("first_seen") or 0
    if not t:
        return 0.5
    days = max(0.0, (time.time() * 1000 - t) / 86400000)
    return 1.0 if days < 2 else 0.8 if days < 7 else 0.5 if days < 21 else 0.2


def score_job(job: dict, profile: dict) -> tuple[int, list[str]]:
    reasons: list[str] = []
    text = f"{job.get('title', '')}\n{job.get('description', '')}"
    low = text.lower()
    for bad in profile.get("exclude") or []:
        if bad and bad in low:
            return 0, [f"Excluded: contains '{bad}'"]
    have = {s.lower() for s in profile.get("skills") or []}
    job_skills = [s for s, _ in find_skills(text)] or job.get("skills") or []
    hit = [s for s in job_skills if s.lower() in have]
    skill_part = 0.0
    if job_skills:
        skill_part = min(1.0, len(hit) / max(3, min(len(job_skills), 8)))
        if len(hit) >= 1:
            reasons.append("Skills: " + ", ".join(hit[:6]))
    t_sim, t_name = title_similarity(job.get("title", ""), profile.get("titles") or [])
    if t_sim >= 0.5 and t_name:
        reasons.append(f"Title matches {t_name}")
    loc_part, loc_reason = location_match(job.get("location", ""), job.get("remote", ""), profile)
    if loc_reason:
        reasons.append(loc_reason)
    kw_part = 0.0
    kws = [k.lower() for k in (profile.get("keywords") or []) if k]
    if kws:
        found = [k for k in kws if k in low]
        kw_part = len(found) / len(kws)
        if found:
            reasons.append("Keywords: " + ", ".join(found[:4]))
    jt_part = 0.5
    wanted_types = [t.lower() for t in profile.get("job_types") or []]
    if wanted_types:
        jt = (job.get("job_type") or "").lower()
        jt_part = 1.0 if any(w in jt for w in wanted_types) else (0.5 if not jt else 0.1)
    rec = recency(job)
    score = 100 * (0.40 * skill_part + 0.28 * t_sim + 0.15 * loc_part + 0.07 * rec + 0.05 * kw_part + 0.05 * jt_part)
    if not hit and t_sim < 0.3:
        score *= 0.5
    return int(round(max(0, min(100, score)))), reasons


def rank(jobs: list[dict], profile: dict, min_score: int = 0) -> list[tuple[dict, int, list[str]]]:
    out = []
    for job in jobs:
        s, r = score_job(job, profile)
        if s >= min_score:
            out.append((job, s, r))
    out.sort(key=lambda x: (-x[1], -(x[0].get("first_seen") or 0)))
    return out
