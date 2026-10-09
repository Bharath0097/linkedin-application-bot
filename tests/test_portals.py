import json

from jobserver import portals
from jobserver.portals.base import SearchQuery

Q = SearchQuery(q="SAP FICO Consultant", location="Edison, NJ", remote="remote", posted_days=7, page=2)


def test_registry_has_dice_and_friends():
    keys = {p["key"] for p in portals.describe_all()}
    assert {"dice", "linkedin", "indeed", "monster"} <= keys
    assert portals.get("dice").name == "Dice"


def test_search_urls():
    assert portals.get("dice").search_url(Q) == "https://www.dice.com/jobs?q=SAP+FICO+Consultant&location=Edison%2C+NJ&radius=30&radiusUnit=mi&page=2&pageSize=20&filters.postedDate=SEVEN&language=en&filters.workplaceTypes=Remote"
    li = portals.get("linkedin").search_url(Q)
    assert "keywords=SAP+FICO+Consultant" in li and "f_TPR=r604800" in li and "start=25" in li and "f_WT=2" in li
    ind = portals.get("indeed").search_url(Q)
    assert "q=SAP+FICO+Consultant" in ind and "fromage=7" in ind and "start=10" in ind and "DSQF7" in ind
    assert "where=Edison%2C+NJ" in portals.get("monster").search_url(Q)


DICE_HTML = """
<div data-testid="job-search-serp-card">
  <a data-testid="job-search-job-detail-link" href="https://www.dice.com/job-detail/3f2c1a9e-7b1d-4e0a-9c2b-aaaa11112222">SAP FICO Consultant</a>
  <a href="/company-profile/abc">Acme Staffing</a>
  <span data-testid="job-search-job-location">Edison, NJ</span>
  <span data-testid="job-search-employment-type">Contract</span>
  <span data-testid="job-search-posted">Posted 2 days ago</span>
  <p>Remote friendly. $85 - $95/hour. S/4HANA finance.</p>
</div>
<div data-testid="job-search-serp-card">
  <a href="https://www.dice.com/job-detail/3f2c1a9e-7b1d-4e0a-9c2b-aaaa11112222">SAP FICO Consultant</a>
</div>
"""


def test_dice_parse_listing():
    jobs = portals.get("dice").parse_listing(DICE_HTML, "SAP FICO")
    assert len(jobs) == 1
    j = jobs[0]
    assert j.external_id == "3f2c1a9e-7b1d-4e0a-9c2b-aaaa11112222" and j.title == "SAP FICO Consultant" and j.company == "Acme Staffing"
    assert j.location == "Edison, NJ" and j.job_type == "Contract" and j.remote == "Remote" and "$85" in j.salary and j.posted == "Posted 2 days ago"


LINKEDIN_GUEST = """
<li><div class="base-card" data-entity-urn="urn:li:jobPosting:3987654321">
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/sap-fico-consultant-at-acme-3987654321?refId=x">SAP FICO Consultant</a>
  <div class="base-search-card__info"><h3 class="base-search-card__title">SAP FICO Consultant</h3><h4 class="base-search-card__subtitle">Acme Corp</h4>
  <div class="base-search-card__metadata"><span class="job-search-card__location">Somerset, NJ</span><time class="job-search-card__listdate" datetime="2026-09-30">1 day ago</time></div></div>
</div></li>
<li><div class="base-card" data-entity-urn="urn:li:jobPosting:111"><h3 class="base-search-card__title"></h3></div></li>
"""

LINKEDIN_LOGGED = """
<ul><li data-occludable-job-id="4001" class="jobs-search-results__list-item"><div class="job-card-container">
  <a class="job-card-container__link" href="/jobs/view/4001/?trk=x"><strong>Data Engineer</strong></a>
  <div class="artdeco-entity-lockup__subtitle">Globex</div><div class="artdeco-entity-lockup__caption">New York, NY (Hybrid)</div></div></li></ul>
"""


def test_linkedin_parse_guest_and_logged_in():
    li = portals.get("linkedin")
    jobs = li.parse_listing(LINKEDIN_GUEST, "SAP")
    assert len(jobs) == 1 and jobs[0].external_id == "3987654321" and jobs[0].company == "Acme Corp" and jobs[0].location == "Somerset, NJ" and jobs[0].posted == "2026-09-30"
    assert jobs[0].url.startswith("https://www.linkedin.com/jobs/view/sap-fico-consultant-at-acme-3987654321")
    jobs = li.parse_listing(LINKEDIN_LOGGED, "data")
    assert len(jobs) == 1 and jobs[0].external_id == "4001" and jobs[0].title == "Data Engineer" and jobs[0].remote == "Hybrid"
    assert li.parse_description('<div class="show-more-less-html__markup"><p>We need <b>SAP</b> skills.</p></div>') == "We need SAP skills."


def test_indeed_parse_mosaic_and_html():
    data = {"metaData": {"mosaicProviderJobCardsModel": {"results": [
        {"jobkey": "abc123def456", "title": "QA Automation Engineer", "company": "Initech", "formattedLocation": "Remote in Austin, TX", "snippet": "<b>Selenium</b> and Java",
         "formattedRelativeTime": "3 days ago", "jobTypes": ["Full-time"], "salarySnippet": {"text": "$90,000 - $110,000 a year"}, "remoteWorkModel": {"text": "Remote"}}]}}}
    html = '<script>window.mosaic.providerData["mosaic-provider-jobcards"]=' + json.dumps(data) + ';</script>'
    jobs = portals.get("indeed").parse_listing(html, "qa")
    assert len(jobs) == 1 and jobs[0].external_id == "abc123def456" and jobs[0].salary == "$90,000 - $110,000 a year" and jobs[0].remote == "Remote" and jobs[0].job_type == "Full-time"
    assert "Selenium and Java" in jobs[0].description
    html2 = '<div class="job_seen_beacon"><h2 class="jobTitle"><a class="jcs-JobTitle" data-jk="feedbeef1234" href="/rc/clk?jk=feedbeef1234">Network Engineer</a></h2><span data-testid="company-name">Umbrella</span><div data-testid="text-location">Newark, NJ</div></div>'
    jobs = portals.get("indeed").parse_listing(html2, "net")
    assert len(jobs) == 1 and jobs[0].external_id == "feedbeef1234" and jobs[0].company == "Umbrella" and jobs[0].location == "Newark, NJ"


def test_monster_parse():
    html = '<article><a data-testid="jobTitle" href="https://www.monster.com/job-openings/servicenow-developer-edison-nj--1a2b3c4d-5e6f-7a8b-9c0d-112233445566">ServiceNow Developer</a><span data-testid="company">Hooli</span><span data-testid="jobDetailLocation">Edison, NJ</span></article>'
    jobs = portals.get("monster").parse_listing(html, "snow")
    assert len(jobs) == 1 and jobs[0].external_id == "1a2b3c4d-5e6f-7a8b-9c0d-112233445566" and jobs[0].company == "Hooli"
