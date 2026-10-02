# StratEdge portals + job-portal server

This repository now holds two things that work together:

| Folder | What it is |
| --- | --- |
| `website/` | The StratEdge IT Consulting website and its portals (PHP backend, React front end). Consultants, employees, clients, HR, accounting and admins each have their own login and portal. |
| `jobserver/` | A Python service that keeps the company's **Dice, LinkedIn, Indeed and Monster** logins on the server, scrapes jobs with them on a schedule, parses the resumes consultants upload in the portal and ranks the jobs for each consultant. |
| `linkedin.py`, `config.py`, `utils.py` | The original LinkedIn Easy Apply bot (unchanged; see [the original README](#original-linkedin-easy-apply-bot)). |

## How it fits together

```
 Consultant ──▶ website (consultant login) ──▶ Resume & preferences ──┐
                                                                       │ api/index.php proxies (jobs_* routes, X-Api-Key)
 Admin / HR ──▶ website (admin login) ──▶ Job portals page ────────────┤
                                                                       ▼
                                                        jobserver (python -m jobserver, :8765)
                                                        ├─ portal accounts (encrypted)  ─▶ Selenium login to Dice / LinkedIn / Indeed / Monster
                                                        ├─ scrape runs (every N minutes or on demand)
                                                        ├─ resume parser (PDF, Word, text → skills, titles, location, years)
                                                        └─ matcher (score 0–100 per consultant per job)
```

1. A consultant registers through **Log in › Consultant**, fills in the profile and uploads a resume under **Resume & preferences**.
2. The job server reads the resume, builds a search profile (titles × locations) and, on every run, searches each enabled portal for it.
3. Jobs are scored against the resume and the consultant's preferences and shown under **Matched jobs** (save, mark applied, dismiss).
4. Staff manage the portal logins, start runs, read logs and see every consultant's matches under **Admin › Job portals** (also in the HR portal).

### Job grabber (Admin › Job portals › Job grabber)

- **Log in through each portal from the admin page.** Each portal card has a *Log in to Dice / LinkedIn / Indeed / Monster* button. The browser runs on the server; if the site emails a verification code, the card asks for it and you type it right there. The session is saved and reused by every later collection. *Log out* clears it.
- **Grab jobs by keyword.** Type job titles or keywords, a location, how recent, work mode and which portals, then *Grab jobs*. Results appear on the page as the portals answer, are stored, and are matched to every consultant's resume.
- **Publish to Careers.** Any grabbed or collected job can be posted to the website's Careers page with one click (and removed again). Published jobs show their source in Admin › Website › Job openings.
- Extra boards can be added without editing the registry: `JOBSERVER_EXTRA_PORTALS=package.module:ClassName` (see `tests/fakeboard.py` for the minimal shape).

### Careers page: share a particular job

Every open role on `#/careers` has its own page (`#/careers/<id>`) and a **Share** button: copy the link, share to LinkedIn, WhatsApp, X, Facebook or email, or use the device's share sheet on phones. The shared link opens the job with its Apply button. Staff get the same Share button in Admin › Website › Job openings.

### Separate logins

The Log in page has three tabs: Consultant, Employee and Client (`#/login?as=consultant`, `?as=employee`, `?as=client`). The server enforces it: an account that belongs to the consultant portal is refused on the employee login (HTTP 403, `wrong_portal`) and pointed to the right one. StratEdge staff (admin, HR, accounting) can sign in from any tab.

- **Consultant portal**: matched jobs, resume & preferences, attendance, timesheets, earnings, time off, documents, e-signatures.
- **Employee portal** (StratEdge staff): attendance, timesheets, tasks, onboarding, documents and the recruiting workspace (consultants, RTRs, submissions, daily reports). Consultants never see the recruiting workspace.
- Admin › Team lets you move a person between portals. Accounts created before this version are consultants; switch your internal staff to *Employee portal*.

## Running the job server

```bash
pip install -r requirements.txt
cp .env.example .env          # set JOBSERVER_API_KEY to a long random string
python -m jobserver           # listens on 127.0.0.1:8765
```

Then in `website/api/config.php` set `'jobs_url' => 'http://127.0.0.1:8765'` and `'jobs_key'` to the same value as `JOBSERVER_API_KEY`. Leave `jobs_url` empty to hide the job features. A systemd unit is in `deploy/jobserver.service`.

The server needs Firefox or Chrome plus its driver for the signed-in portals (`JOBSERVER_BROWSER`, `JOBSERVER_HEADLESS`). LinkedIn's public job search runs without a browser or account, so matching works even before any login is added. Dice and LinkedIn see more with a company account. Portals that ask for a verification code on a new machine need one manual sign-in in a browser on the server; the saved session is reused afterwards (`data/jobserver/sessions`).

Settings (environment or `.env`): `JOBSERVER_API_KEY`, `JOBSERVER_HOST`, `JOBSERVER_PORT`, `JOBSERVER_DATA`, `JOBSERVER_BROWSER`, `JOBSERVER_HEADLESS`, `JOBSERVER_FIREFOX_PROFILE`, `JOBSERVER_SCRAPE_EVERY_MIN` (0 = manual only), `JOBSERVER_MAX_PAGES`, `JOBSERVER_MAX_QUERIES`, `JOBSERVER_PAGE_DELAY`, `JOBSERVER_JOB_MAX_AGE_DAYS`, `JOBSERVER_MIN_SCORE`, `JOBSERVER_DEFAULT_LOCATION`, `JOBSERVER_SECRET` (Fernet key; generated into `data/jobserver/secret.key` when unset).

### API (used by the PHP backend)

All routes need the `X-Api-Key` header (requests from the same machine are allowed when no key is configured).

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /overview` | status, counts, last and next run |
| `GET /portals`, `POST /portals/accounts`, `PATCH /portals/accounts/{id}`, `DELETE …`, `POST /portals/accounts/{id}/test` | portal logins (passwords encrypted at rest, never returned) and a live login test |
| `GET /portals/status`, `POST /portals/accounts/{id}/login`, `GET …/login`, `POST …/login/code`, `POST …/logout` | interactive login from the Job grabber, with the verification-code step |
| `POST /grab`, `GET /runs/{id}/jobs`, `PATCH /jobs/{id}` | grab jobs by keyword now, list what a run found, mark a job as published |
| `GET /runs`, `POST /runs`, `GET /runs/{id}` | scrape runs and their logs |
| `GET /jobs`, `GET /jobs/{id}` | every job collected |
| `PUT /consultants/{uid}`, `POST /consultants/{uid}/resume`, `GET /consultants/{uid}`, `POST /consultants/{uid}/rematch` | a consultant's preferences, resume and parsed profile |
| `GET /consultants/{uid}/matches`, `POST /consultants/{uid}/matches/{job}` | ranked jobs and their state (new, saved, applied, dismissed) |

### Adding another job board

Create `jobserver/portals/<name>.py` with a `Portal` subclass (`search_url`, `parse_listing`, and `login`/`search` for the browser), and register it in `jobserver/portals/__init__.py`. The parsers are pure functions, so they can be tested with saved HTML like the ones in `tests/test_portals.py`.

## Running the website

See `website/README.txt`. In short: upload everything in `website/` except `_source/` to a PHP 7.4+ host with SQLite, make `storage/` writable, and the first account created becomes the administrator. To change the front end, edit `website/_source/src/*.js` and run `python3 website/_source/build.py`.

## Tests

```bash
python -m pytest tests
```

The suite covers the resume parser, the matcher, each portal's URL builder and HTML parser, the HTTP API (with an in-memory fake portal, no browser needed) and, when `php` is installed, an end-to-end run of the PHP portal against the job server: separate logins, resume upload, preferences and the staff endpoints.

---

## Original LinkedIn Easy Apply bot

![linkedineasyapplygif](https://user-images.githubusercontent.com/34207598/128695728-6efcb457-0f75-42e2-987a-f7a0c239a235.gif)

A python bot to apply all Linkedin Easy Apply jobs based on your preferences.

- Install dependencies with `pip3 install -r requirements.yaml`
- Either create a Firefox profile and put its path on line 8 of `config.py` or enter your LinkedIn credentials on lines 11 and 12 of `config.py`.
- Modify `config.py` according to your demands, then run `python3 linkedin.py`.
- Applied jobs are written to a `.txt` file under `/data`.

Features: filter jobs by Easy Apply, location, keyword, experience, position, job type and date posted; apply to single-page and multi-page offers; print the links for the jobs the bot couldn't apply to; works with Firefox and Chrome; optional follow/unfollow of companies.

Tests for the bot are in the `tests` folder of the original project (`setupTests.py`, `seleniumTest.py`, `linkedinTest.py`).

Original author: Amin Boulouma (amin@boulouma.com). [Donate & support](https://commerce.coinbase.com/checkout/576ee011-ba40-47d5-9672-ef7ad29b1e6c).
