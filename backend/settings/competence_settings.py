"""
Competence metadata loaded from Supabase (single source of truth).
Les données sont récupérées une seule fois au démarrage et mises en cache.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_taxonomy_cache: Optional[dict] = None


def _load_from_supabase() -> dict:
    """Charge les chapitres et compétences depuis Supabase."""
    from auth import get_supabase_client
    client = get_supabase_client()

    try:
        chapters_resp = client.table("chapters").select(
            "id, name, order_index, db_aliases"
        ).order("order_index").execute()
    except Exception as exc:
        # The canonical Admin schema calls this same existing field `aliases`.
        # Only retry the known missing-column error; never hide a network failure.
        if getattr(exc, "code", None) != "42703":
            raise
        chapters_resp = client.table("chapters").select(
            "id, name, order_index, aliases"
        ).order("order_index").execute()
    competences_resp = (
        client.table("competences")
        .select("id, name, chapter_id, max_points, chapters(name)")
        .execute()
    )

    chapters = chapters_resp.data or []
    raw_competences = competences_resp.data or []

    chapter_order = [c["name"] for c in chapters]
    chapter_db_aliases: dict[str, list[str]] = {
        c["name"]: c.get("db_aliases") or c.get("aliases")
        for c in chapters
        if c.get("db_aliases") or c.get("aliases")
    }

    # Dénormalise le nom du chapitre depuis la jointure
    competences = []
    for c in raw_competences:
        chapter_name = (c.get("chapters") or {}).get("name", "")
        competences.append({
            "id": c["id"],
            "name": c["name"],
            "chapter": chapter_name,
            "chapter_id": c["chapter_id"],
            "max_points": c["max_points"],
        })

    return {
        "competences": competences,
        "chapter_order": chapter_order,
        "chapter_db_aliases": chapter_db_aliases,
    }


def _get_taxonomy() -> dict:
    global _taxonomy_cache
    if _taxonomy_cache is None:
        try:
            _taxonomy_cache = _load_from_supabase()
        except Exception as exc:
            logger.error("[taxonomy] Impossible de charger depuis Supabase : %s", exc)
            _taxonomy_cache = {
                "competences": [],
                "chapter_order": [],
                "chapter_db_aliases": {},
            }
    return _taxonomy_cache


# --- API publique (identique à l'ancienne) ---

@property  # type: ignore[misc]
def COMPETENCES(self):  # noqa: N802
    return _get_taxonomy()["competences"]


# Variables de module accessibles directement
def _module_getattr(name: str):  # PEP 562
    data = _get_taxonomy()
    if name == "COMPETENCES":
        return data["competences"]
    if name == "CHAPTER_ORDER":
        return data["chapter_order"]
    if name == "CHAPTER_DB_ALIASES":
        return data["chapter_db_aliases"]
    if name == "DEFAULT_CHAPTER":
        order = data["chapter_order"]
        return order[0] if order else "Suites numériques"
    raise AttributeError(f"module has no attribute {name!r}")


__getattr__ = _module_getattr


def get_competences(
    chapter: str | None = None,
    exclude_chapters: list[str] | None = None,
) -> dict[str, int]:
    """Return {competence_id: max_points}.
    If chapter is set, filter by chapter.
    If exclude_chapters is set, skip competences in those chapters.
    """
    out = {}
    for c in _get_taxonomy()["competences"]:
        if chapter is not None and c["chapter"] != chapter:
            continue
        if exclude_chapters and c["chapter"] in exclude_chapters:
            continue
        out[c["id"]] = c["max_points"]
    return out


def get_chapters_with_competences() -> list[str]:
    """Return list of chapters that have competences defined."""
    seen: dict[str, None] = {}
    for c in _get_taxonomy()["competences"]:
        seen[c["chapter"]] = None
    return list(seen)
