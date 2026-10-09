"""Entry point for cPanel / Phusion Passenger ("Setup Python App").

Passenger speaks WSGI; the job server is an ASGI (FastAPI) app, so it is wrapped with
a2wsgi. Put the repository in the app folder, point "Application startup file" at
this file and "Application entry point" at `application`, add the JOBSERVER_* values
as environment variables in the same screen, then set jobs_url in the website's
api/config.php to the app's URL (e.g. https://jobs.yourdomain.com).

Limits on shared hosting: no Firefox/Chrome, so Dice/Indeed/Monster logins and
browser searches are unavailable there; resume matching, the LinkedIn public search,
keyword grabs on LinkedIn and everything the portal shows still work. Passenger may
stop idle processes, so the automatic schedule only runs while the app is awake; use
"Collect jobs now" or a cPanel cron job that requests /health to keep it warm.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from a2wsgi import ASGIMiddleware  # noqa: E402

from jobserver.app import app  # noqa: E402

application = ASGIMiddleware(app)
