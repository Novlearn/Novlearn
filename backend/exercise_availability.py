"""Eligibility for legacy student readers, including service-role queries.

Historical rows have no catalog identity. Canonical rows are available only
with an active version (the database trigger requires that version published).
Never infer availability from title, an empty content object or RLS alone.
"""
from typing import Any


AVAILABLE_EXERCISES_FILTER = "catalog_id.is.null,active_version_id.not.is.null"


def available_exercises(client: Any, columns: str) -> Any:
    return client.table("exercises").select(columns).or_(AVAILABLE_EXERCISES_FILTER)
