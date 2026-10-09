"""python -m jobserver  →  start the API (and the scrape schedule)."""
import logging

import uvicorn

from .settings import settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if not settings.api_key:
        logging.getLogger("jobserver").warning("JOBSERVER_API_KEY is not set: only requests from this machine are accepted.")
    uvicorn.run("jobserver.app:app", host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
