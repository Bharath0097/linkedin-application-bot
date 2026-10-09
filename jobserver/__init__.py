"""StratEdge job-portal server.

A small backend that keeps job-portal logins (Dice, LinkedIn, Indeed, ...) on the
server, scrapes jobs with them on a schedule, parses the resumes consultants upload
in the StratEdge portal, and ranks the scraped jobs for each consultant.

Run it with:  python -m jobserver
"""

__version__ = "1.0.0"
