import time

from jobserver.matcher import location_match, rank, score_job, title_similarity

PROFILE = {"skills": ["SAP FICO", "SAP S/4HANA", "ABAP", "Power BI", "SQL"], "titles": ["SAP FICO Consultant", "Business Analyst"], "location": "Edison, NJ",
           "locations": ["Edison, NJ"], "remote": "any", "exclude": ["clearance"], "keywords": ["implementation"], "job_types": []}
NOW = int(time.time() * 1000)


def job(**k):
    base = {"id": 1, "title": "", "company": "", "location": "", "remote": "", "job_type": "", "description": "", "first_seen": NOW}
    base.update(k)
    return base


def test_good_match_scores_high_and_explains():
    s, reasons = score_job(job(title="Senior SAP FICO Consultant", location="Edison, NJ", description="S/4HANA implementation, FI/CO configuration, ABAP debugging, Power BI reports"), PROFILE)
    assert s >= 75
    assert any(r.startswith("Skills:") for r in reasons) and "Title matches SAP FICO Consultant" in reasons and "In Edison, Nj" in reasons


def test_unrelated_job_scores_low():
    s, _ = score_job(job(title="Registered Nurse", location="Dallas, TX", description="Patient care in the ICU"), PROFILE)
    assert s < 20


def test_excluded_word_zeroes():
    s, reasons = score_job(job(title="SAP FICO Consultant", description="Active security clearance required"), PROFILE)
    assert s == 0 and reasons == ["Excluded: contains 'clearance'"]


def test_remote_preference():
    p = dict(PROFILE, remote="remote")
    assert location_match("Remote", "", p) == (1.0, "Remote")
    assert location_match("Austin, TX", "", p)[0] < 0.5
    onsite = dict(PROFILE, remote="onsite")
    assert location_match("Remote (US)", "Remote", onsite)[0] == 0.2


def test_title_similarity():
    s, name = title_similarity("Sr. SAP FICO Consultant", ["SAP FICO Consultant"])
    assert s >= 0.9 and name == "SAP FICO Consultant"
    assert title_similarity("Truck Driver", ["SAP FICO Consultant"])[0] == 0.0


def test_rank_orders_and_filters():
    jobs = [job(id=1, title="Truck Driver"), job(id=2, title="SAP FICO Consultant", description="S/4HANA ABAP"), job(id=3, title="Business Analyst", description="SQL Power BI")]
    out = rank(jobs, PROFILE, min_score=15)
    assert [j["id"] for j, _, _ in out] == [2, 3]
