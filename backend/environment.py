"""Check database targeting before constructing privileged clients."""
import base64
import json
from urllib.parse import urlparse

STAGING_REF = "tksvbkvfusrnxulpahky"
PRODUCTION_REF = "abwipnppcrghdhwriyjp"


def validate_database_environment(app_env: str, url: str, key: str) -> None:
    if app_env not in {"development", "test", "staging", "production"}:
        raise ValueError("APP_ENV must explicitly select a supported environment")
    host = urlparse(url).hostname
    expected = PRODUCTION_REF if app_env == "production" else STAGING_REF
    if app_env in {"staging", "production"}:
        if host != f"{expected}.supabase.co" or not key:
            raise ValueError("Database credentials do not match APP_ENV")
    elif host == f"{PRODUCTION_REF}.supabase.co":
        raise ValueError("Development must not use the production database")
    if host in {f"{STAGING_REF}.supabase.co", f"{PRODUCTION_REF}.supabase.co"} and key.startswith("ey"):
        try:
            part = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        except (ValueError, IndexError, UnicodeError) as exc:
            raise ValueError("Invalid database key configuration") from exc
        if claims.get("ref") != expected or claims.get("role") != "service_role":
            raise ValueError("Database key does not match the selected environment")
