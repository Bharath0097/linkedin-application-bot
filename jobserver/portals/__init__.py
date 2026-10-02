"""Registry of job portals the server knows how to talk to."""
from __future__ import annotations

from .base import Job, LoginError, Portal, PortalError, SearchQuery
from .dice import Dice
from .indeed import Indeed
from .linkedin import LinkedIn
from .monster import Monster

REGISTRY: dict[str, Portal] = {}


def register(p: Portal) -> Portal:
    REGISTRY[p.key] = p
    return p


for _p in (Dice(), LinkedIn(), Indeed(), Monster()):
    register(_p)


def _load_extra() -> None:
    """JOBSERVER_EXTRA_PORTALS=package.module:ClassName,other.module:Other adds adapters without editing this file."""
    import importlib
    import os

    for spec in os.environ.get("JOBSERVER_EXTRA_PORTALS", "").split(","):
        spec = spec.strip()
        if not spec:
            continue
        mod, _, cls = spec.partition(":")
        register(getattr(importlib.import_module(mod), cls or "Portal")())


_load_extra()


def get(key: str) -> Portal:
    try:
        return REGISTRY[key]
    except KeyError:
        raise PortalError(f"Unknown portal '{key}'. Known: {', '.join(sorted(REGISTRY))}")


def describe_all() -> list[dict]:
    return [p.describe() for p in REGISTRY.values()]


__all__ = ["Job", "LoginError", "Portal", "PortalError", "SearchQuery", "REGISTRY", "register", "get", "describe_all"]
