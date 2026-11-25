"""Eligibility for student readers using the server's validated DB environment."""
from typing import Any
import os

from config import settings


LEGACY_PRODUCTION_FILTER = "catalog_id.is.null,active_version_id.not.is.null,legacy_version_id.not.is.null"


def available_exercises(client: Any, columns: str) -> Any:
    if settings.app_env in {"development", "test", "staging"}:
        return (
            client.table("exercises")
            .select(f"{columns},playable:exercise_versions!exercise_versions_exercise_id_fkey!inner()")
            .filter("catalog_id", "not.is", "null")
            .filter("admin_archived_at", "is", "null")
            .in_("playable.editorial_status", ["ready", "published"])
        )
    query = client.table("exercises").select(columns)
    if os.getenv("PRODUCTION_CATALOG_SYNC_ENFORCED") == "true":
        return query.filter("active_version_id", "not.is", "null").filter("admin_archived_at", "is", "null")
    # Keep the historical Production catalogue until the separately controlled
    # catalog_id correspondence/backfill is complete.
    return query.or_(LEGACY_PRODUCTION_FILTER).filter("admin_archived_at", "is", "null")
