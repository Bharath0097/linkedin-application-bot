"""Secrets at rest and request authentication.

Portal passwords are encrypted with a Fernet key that lives in the data folder
(data/jobserver/secret.key). Keep that file out of backups you share.
"""
import os
import pathlib
import secrets
import threading

from cryptography.fernet import Fernet, InvalidToken

from .settings import settings

_lock = threading.Lock()
_fernet: Fernet | None = None


def _key_file() -> pathlib.Path:
    return settings.data_dir / "secret.key"


def fernet() -> Fernet:
    global _fernet
    with _lock:
        if _fernet is None:
            env = os.environ.get("JOBSERVER_SECRET", "").strip()
            if env:
                key = env.encode()
            else:
                f = _key_file()
                if f.is_file():
                    key = f.read_bytes().strip()
                else:
                    settings.ensure_dirs()
                    key = Fernet.generate_key()
                    f.write_bytes(key)
                    try:
                        os.chmod(f, 0o600)
                    except OSError:
                        pass
            _fernet = Fernet(key)
        return _fernet


def encrypt(plain: str) -> str:
    return fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    try:
        return fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        raise ValueError("Stored password cannot be decrypted; the secret key changed. Re-enter the password.")


def api_key_ok(presented: str | None, client_host: str | None) -> bool:
    """A request is allowed with the configured key, or from the same machine when no key is set."""
    expected = settings.api_key
    if expected:
        return bool(presented) and secrets.compare_digest(presented, expected)
    return client_host in ("127.0.0.1", "::1", "localhost", "testclient", None)
