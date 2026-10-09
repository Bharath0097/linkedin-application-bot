import io
import zipfile

import pytest

from jobserver.resume import ResumeError, build_profile, extract_text, find_skills, find_titles, find_years, search_queries

SAMPLE = """
Priya Raman
Edison, NJ 08817 | priya@example.com | (732) 555-0100

Senior SAP FICO Consultant with 9+ years of experience in S/4HANA implementations.

EXPERIENCE
SAP FICO Consultant, Acme Corp, 2018 - Present
- Led S/4HANA finance rollout, configured FI and CO modules, worked with ABAP developers.
- Integrated with Ariba and Fiori apps; reporting in Power BI and SQL.
Business Analyst, Beta Inc, 2014 - 2018
- Requirements gathering, Agile, Jira.

SKILLS: SAP, S/4HANA, SAP FICO, ABAP, Fiori, Power BI, SQL, Excel, Agile
"""


def make_docx(text: str) -> bytes:
    buf = io.BytesIO()
    paras = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in text.splitlines())
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", f'<w:document xmlns:w="x"><w:body>{paras}</w:body></w:document>')
    return buf.getvalue()


def test_text_and_docx_extraction():
    assert "Priya" in extract_text(SAMPLE.encode(), "resume.txt")
    out = extract_text(make_docx("Hello & welcome\nSecond line"), "resume.docx")
    assert "Hello & welcome" in out and "Second line" in out


def test_bad_docx_raises():
    with pytest.raises(ResumeError):
        extract_text(b"PK\x03\x04notazip", "x.docx")


def test_pdf_without_text_raises():
    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    with pytest.raises(ResumeError):
        extract_text(buf.getvalue(), "scan.pdf")


def test_skills_titles_years_location():
    skills = dict(find_skills(SAMPLE))
    assert skills["SAP FICO"] >= 2 and "SAP S/4HANA" in skills and "Power BI" in skills and "ABAP" in skills
    assert "Go" not in skills  # 'Go' only matches the explicit aliases, not the English word
    titles = find_titles(SAMPLE)
    assert titles[0] == "SAP FICO Consultant"
    assert find_years(SAMPLE) == 9
    prof = build_profile(SAMPLE)
    assert prof["location"] == "Edison, NJ"
    assert prof["seniority"] == "Senior"
    assert prof["titles"][0] == "SAP FICO Consultant"


def test_prefs_override_and_queries():
    prof = build_profile(SAMPLE, {"titles": "SAP S/4HANA Finance Lead, SAP FICO Consultant", "locations": ["Remote", "Somerset, NJ"], "remote": "remote", "exclude": "clearance", "skills": "Vertex"})
    assert prof["titles"][:2] == ["SAP S/4HANA Finance Lead", "SAP FICO Consultant"]
    assert prof["skills"][0] == "Vertex"
    assert prof["exclude"] == ["clearance"]
    qs = search_queries(prof, "United States")
    assert qs[0] == {"q": "SAP S/4HANA Finance Lead", "location": "Remote", "remote": "remote"}
    assert any(q["location"] == "Somerset, NJ" for q in qs)
    assert len(qs) <= 8


def test_empty_profile_has_no_queries():
    assert search_queries(build_profile(""), "United States")[0]["q"] == "IT"
