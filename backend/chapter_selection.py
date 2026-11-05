"""
Chapter selection for global recommendation (when no chapter is specified).
Uses user's score per chapter and streak to pick the best chapter to train.
"""
import logging
import random
from typing import Any

from exercise_availability import available_exercises

from settings.competence_settings import (
    get_competences,
    get_chapters_with_competences,
    CHAPTER_DB_ALIASES,
)
from streak import compute_streak

logger = logging.getLogger(__name__)


def _get_chapters_with_exercises(supabase_client: Any) -> set[str]:
    """Return set of chapter names that have at least one exercise in DB."""
    r = available_exercises(supabase_client, "chapter").execute()
    chapters = set()
    for row in (r.data or []):
        ch = (row.get("chapter") or "").strip()
        if ch:
            chapters.add(ch)
    # Also add chapters from aliases (e.g. "Suites et limites" -> "Suites numériques")
    reverse_aliases: dict[str, str] = {}
    for canonical, aliases in CHAPTER_DB_ALIASES.items():
        for alias in aliases:
            reverse_aliases[alias] = canonical
    result = set()
    for ch in chapters:
        result.add(reverse_aliases.get(ch, ch))
    return result


def _compute_chapter_scores(
    supabase_client: Any, user_id: str
) -> dict[str, float]:
    """
    Return {chapter: score_0_to_100} for each chapter with competences.
    Score = sum(user_points) / sum(max_points) * 100.
    """
    scores: dict[str, float] = {}
    r = supabase_client.table("user_competence_scores").select(
        "competence_id, points"
    ).eq("user_id", user_id).execute()

    user_points = {row["competence_id"]: row["points"] for row in (r.data or [])}

    for chapter in get_chapters_with_competences():
        comps = get_competences(chapter=chapter)
        if not comps:
            continue
        total_max = sum(comps.values())
        total_user = sum(user_points.get(cid, 0) for cid in comps)
        if total_max > 0:
            scores[chapter] = min(100.0, (total_user / total_max) * 100)
        else:
            scores[chapter] = 0.0

    return scores


def select_chapter_for_recommendation(
    supabase_client: Any, user_id: str
) -> str | None:
    """
    Select which chapter to use for recommendation when user didn't specify one.
    Only considers chapters that have both competences defined AND exercises in DB.
    Returns None if no chapter is available.
    """
    chapters_with_competences = set(get_chapters_with_competences())
    chapters_with_exercises = _get_chapters_with_exercises(supabase_client)
    available = chapters_with_competences & chapters_with_exercises

    if not available:
        logger.warning(
            "[ChapterSelection] No chapter has both competences and exercises"
        )
        return None

    chapter_scores = _compute_chapter_scores(supabase_client, user_id)
    streak = compute_streak(supabase_client, user_id, chapter=None)

    # Filter to only chapters we have
    dico = {ch: chapter_scores.get(ch, 0.0) for ch in available}
    chosen = _choix_de_chapitre(dico, streak)
    logger.info(
        "[ChapterSelection] user=%s streak=%s scores=%s -> chapter=%s",
        user_id[:8],
        streak,
        dico,
        chosen,
    )
    return chosen


def _choix_de_chapitre(
    dico_chapitres_points: dict[str, float], streak: int = 0
) -> str:
    """
    Select chapter based on scores (0-100) and streak.
    - streak < 1: prefer strong chapters (confidence)
    - streak 1-2: prefer medium chapters
    - streak >= 3: prefer weak chapters (challenge)
    """
    if not dico_chapitres_points:
        raise ValueError("dico_chapitres_points cannot be empty")

    l = sorted(dico_chapitres_points.items(), key=lambda item: item[1])
    chapitres_faibles = []
    chapitres_moyens = []
    chapitres_forts = []

    for e in l:
        if e[1] < 30:
            chapitres_faibles.append(e[0])
        elif e[1] < 70:
            chapitres_moyens.append(e[0])
        else:
            chapitres_forts.append(e[0])

    if streak < 1:
        if chapitres_forts:
            return random.choice(chapitres_forts)
        if chapitres_moyens:
            return random.choice(chapitres_moyens)
        return random.choice(chapitres_faibles)
    elif streak < 3:
        if chapitres_moyens:
            return random.choice(chapitres_moyens)
        if chapitres_forts:
            return random.choice(chapitres_forts)
        return random.choice(chapitres_faibles)
    else:
        if chapitres_faibles:
            return random.choice(chapitres_faibles)
        if chapitres_moyens:
            return random.choice(chapitres_moyens)
        return random.choice(chapitres_forts)
