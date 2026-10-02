"""Configuration, read from environment variables (or a .env file next to the repo)."""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    f = ROOT / ".env"
    if not f.is_file():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def _bool(v: str, default: bool) -> bool:
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


class Settings:
    def __init__(self) -> None:
        env = os.environ
        self.data_dir = pathlib.Path(env.get("JOBSERVER_DATA", str(ROOT / "data" / "jobserver")))
        self.db_path = pathlib.Path(env.get("JOBSERVER_DB", str(self.data_dir / "jobserver.sqlite")))
        self.resume_dir = self.data_dir / "resumes"
        self.session_dir = self.data_dir / "sessions"
        # The StratEdge PHP backend sends this in an X-Api-Key header. Empty = only loopback clients are accepted.
        self.api_key = env.get("JOBSERVER_API_KEY", "")
        self.host = env.get("JOBSERVER_HOST", "127.0.0.1")
        self.port = int(env.get("JOBSERVER_PORT", "8765"))
        self.browser = env.get("JOBSERVER_BROWSER", "firefox").lower()
        self.headless = _bool(env.get("JOBSERVER_HEADLESS"), True)
        self.firefox_profile = env.get("JOBSERVER_FIREFOX_PROFILE", "")
        # Scrape automatically every N minutes (0 turns the schedule off; runs can still be started from the portal).
        self.scrape_every_min = int(env.get("JOBSERVER_SCRAPE_EVERY_MIN", "180"))
        self.max_pages = int(env.get("JOBSERVER_MAX_PAGES", "2"))
        self.max_queries_per_run = int(env.get("JOBSERVER_MAX_QUERIES", "24"))
        self.page_delay = float(env.get("JOBSERVER_PAGE_DELAY", "2.5"))
        self.job_max_age_days = int(env.get("JOBSERVER_JOB_MAX_AGE_DAYS", "45"))
        # Portals that need no account are used even when no account is configured (LinkedIn guest search).
        self.default_location = env.get("JOBSERVER_DEFAULT_LOCATION", "United States")
        self.min_score = int(env.get("JOBSERVER_MIN_SCORE", "25"))

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.resume_dir, self.session_dir, self.db_path.parent):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
