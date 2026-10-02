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


def get(key: str) -> Portal:
    try:
        return REGISTRY[key]
    except KeyError:
        raise PortalError(f"Unknown portal '{key}'. Known: {', '.join(sorted(REGISTRY))}")


def describe_all() -> list[dict]:
    return [p.describe() for p in REGISTRY.values()]


__all__ = ["Job", "LoginError", "Portal", "PortalError", "SearchQuery", "REGISTRY", "register", "get", "describe_all"]
