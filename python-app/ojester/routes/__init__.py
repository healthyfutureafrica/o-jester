"""HTTP routes (Flask blueprints)."""

from urllib.parse import urlparse


def safe_next(target: str | None, default: str = "/") -> str:
    """Only allow same-site relative redirects."""
    if not target:
        return default
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/") or target.startswith("//"):
        return default
    return target
