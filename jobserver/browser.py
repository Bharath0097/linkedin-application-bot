"""Selenium browser sessions for the portal adapters.

One browser per portal account per run. Cookies are saved after a successful login so
the next run usually skips the login form (data/jobserver/sessions/<account>.json).
"""
from __future__ import annotations

import json
import pathlib
import time
from typing import Any

from .settings import settings


class BrowserError(RuntimeError):
    pass


def make_driver() -> Any:
    try:
        from selenium import webdriver
    except ImportError as e:  # pragma: no cover
        raise BrowserError("Selenium is not installed (pip install selenium).") from e
    browser = settings.browser
    if browser == "chrome":
        from selenium.webdriver.chrome.options import Options
        o = Options()
        if settings.headless:
            o.add_argument("--headless=new")
        for a in ("--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1400,1000", "--disable-blink-features=AutomationControlled", "--lang=en-US"):
            o.add_argument(a)
        o.add_experimental_option("excludeSwitches", ["enable-automation"])
        try:
            drv = webdriver.Chrome(options=o)
        except Exception:
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            drv = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=o)
    else:
        from selenium.webdriver.firefox.options import Options
        o = Options()
        if settings.headless:
            o.add_argument("-headless")
        o.set_preference("dom.webdriver.enabled", False)
        o.set_preference("intl.accept_languages", "en-US, en")
        if settings.firefox_profile:
            o.add_argument("-profile")
            o.add_argument(settings.firefox_profile)
        try:
            drv = webdriver.Firefox(options=o)
        except Exception:
            from selenium.webdriver.firefox.service import Service
            from webdriver_manager.firefox import GeckoDriverManager
            drv = webdriver.Firefox(service=Service(GeckoDriverManager().install()), options=o)
    drv.set_page_load_timeout(60)
    try:
        drv.set_window_size(1400, 1000)
    except Exception:
        pass
    return drv


def _session_file(key: str) -> pathlib.Path:
    settings.ensure_dirs()
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in key)
    return settings.session_dir / f"{safe}.json"


def save_cookies(driver: Any, key: str) -> None:
    try:
        _session_file(key).write_text(json.dumps(driver.get_cookies()), encoding="utf-8")
    except Exception:
        pass


def load_cookies(driver: Any, key: str, domain_url: str) -> bool:
    f = _session_file(key)
    if not f.is_file():
        return False
    try:
        cookies = json.loads(f.read_text(encoding="utf-8"))
    except ValueError:
        return False
    driver.get(domain_url)
    ok = False
    for c in cookies:
        c = {k: v for k, v in c.items() if k in ("name", "value", "domain", "path", "secure", "expiry", "httpOnly")}
        if "expiry" in c and c["expiry"] and c["expiry"] < time.time():
            continue
        try:
            driver.add_cookie(c)
            ok = True
        except Exception:
            continue
    return ok


def clear_cookies(key: str) -> None:
    f = _session_file(key)
    if f.is_file():
        f.unlink()


def page_text(driver: Any) -> str:
    try:
        return driver.find_element("tag name", "body").text
    except Exception:
        return ""


def wait_for(driver: Any, css: str, timeout: float = 15) -> Any:
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    return WebDriverWait(driver, timeout).until(EC.presence_of_element_located((By.CSS_SELECTOR, css)))


def try_find(driver: Any, css_list: list[str]) -> Any:
    from selenium.webdriver.common.by import By

    for css in css_list:
        try:
            els = driver.find_elements(By.CSS_SELECTOR, css)
            if els:
                return els[0]
        except Exception:
            continue
    return None
