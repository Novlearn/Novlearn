"""
Chapter placement test: evaluates a student's level in a chapter before normal recommendations.
- 2 exercises per competence (easy → medium if success, else easy again)
- 3rd exercise (hard) only if both easy and medium succeeded
- Scoring: (difficulty_level+1)/10 * max_points per success (≈0–75% per competence)
- ~20–30 questions max (top 10 competences by max_points)
"""
import logging
import random
from typing import Any

from exercise_availability import available_exercises

from settings.competence_settings import (
    CHAPTER_DB_ALIASES,
    get_competences,
    get_chapters_with_competences,
)

logger = logging.getLogger(__name__)
MAX_COMPETENCES_TO_TEST = 10


def _competences_to_test(chapter: str) -> list[tuple[str, int]]:
    """Returns top 10 competences by max_points for the chapter."""
    comps = get_competences(chapter=chapter)
    if not comps:
        return []
    sorted_list = sorted(comps.items(), key=lambda x: x[1])
    return sorted_list[:MAX_COMPETENCES_TO_TEST]


def _merge_sort(lst: list[tuple[str, int]]) -> list[tuple[str, int]]:
    """Merge sort by max_points (ascending)."""
    if len(lst) < 2:
        return lst
    m = len(lst) // 2
    return _merge(_merge_sort(lst[:m]), _merge_sort(lst[m:]))


def _merge(
    a: list[tuple[str, int]], b: list[tuple[str, int]]
) -> list[tuple[str, int]]:
    if not a:
        return b
    if not b:
        return a
    res, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        if a[i][1] <= b[j][1]:
            res.append(a[i])
            i += 1
        else:
            res.append(b[j])
            j += 1
    res.extend(a[i:])
    res.extend(b[j:])
    return res


def _get_first_test_exercise(
    supabase_client: Any,
    user_id: str,
    chapter: str,
    exos_par_comp: dict[str, list[list[int]]],
    liste_competences: list[tuple[str, int]],
) -> dict | None:
    """Returns first test exercise (easy for first competence)."""
    if not liste_competences:
        return None
    competence = liste_competences[0][0]
    ids = exos_par_comp.get(competence, [[], [], []])[0]
    if not ids:
        logger.warning("[ChapterTest] No easy exercise for competence %s", competence)
        return None
    ex_id = random.choice(ids)
    diff_to_level = {"easy": 0, "medium": 1, "hard": 2}
    r = available_exercises(supabase_client, "id, difficulty, competences").eq("id", ex_id).execute()
    if not r.data:
        return None
    row = (r.data or [{}])[0] if r.data else {}
    diff = row.get("difficulty", "easy")
    level = diff_to_level.get(diff, 0)
    # Get competences array from exercise
    exercise_competences = row.get("competences") or []
    if not isinstance(exercise_competences, list):
        exercise_competences = [competence] if competence else []
    return {
        "exercise_id": ex_id,
        "competence_id": competence,  # Keep for backward compatibility
        "competences": exercise_competences,  # Array of competences
        "difficulty_level": level,
        "difficulty": diff,
        "mode": "test",
    }


def _pick_next_exercise(
    competence: str,
    j: int,
    exos_par_comp: dict[str, list[list[int]]],
) -> tuple[int, int | None]:
    """
    Returns (difficulty_level, exercise_id).
    j: 0=first (easy), 1=second (medium), 2=third (hard) attempt for this competence.
    """
    listes = exos_par_comp.get(competence, [[], [], []])
    if j == 0 and listes[0]:
        return 0, random.choice(listes[0])
    if j == 1 and listes[1]:
        return 1, random.choice(listes[1])
    if j == 2 and listes[2]:
        return 2, random.choice(listes[2])
    if j == 1 and listes[0]:
        return 0, random.choice(listes[0])
    for niv, lst in enumerate(listes):
        if lst:
            return niv, random.choice(lst)
    return 0, None


def _apply_scoring(
    competence: str,
    niveau_difficulte: int,
    max_points: int,
    points_eleve: dict[str, int],
) -> None:
    """Add points for a successful test exercise."""
    points_a_attribuer = int(((niveau_difficulte + 1) / 10) * max_points)
    current = points_eleve.get(competence, 0)
    new_points = min(current + points_a_attribuer, max_points)
    points_eleve[competence] = new_points


def is_chapter_test_completed(
    supabase_client: Any, user_id: str, chapter: str
) -> bool:
    """Check if user has completed the placement test for this chapter."""
    try:
        r = (
            supabase_client.table("user_chapter_test_completed")
            .select("chapter")
            .eq("user_id", user_id)
            .eq("chapter", chapter)
            .execute()
        )
        completed = bool(r.data and len(r.data) > 0)
        logger.debug(
            "[ChapterTest] is_chapter_test_completed: user=%s chapter=%s completed=%s (found %d records)",
            user_id[:8],
            chapter,
            completed,
            len(r.data) if r.data else 0,
        )
        return completed
    except Exception as e:
        # If table doesn't exist or any error, consider test as not completed
        logger.warning(
            "[ChapterTest] is_chapter_test_completed: table not found or error for user=%s chapter=%s: %s. Treating as not completed.",
            user_id[:8],
            chapter,
            str(e),
        )
        return False


def get_chapter_for_test(chapter: str | None) -> str:
    """Return chapter to use for test (default first chapter if none)."""
    if chapter and chapter.strip():
        return chapter.strip()
    chapters = get_chapters_with_competences()
    return chapters[0] if chapters else "Suites numériques"


def _restore_test_exercise_from_state(
    supabase_client: Any,
    user_id: str,
    chapter: str,
    competence_index: int,
    exercise_index: int,
    exos_par_comp: dict[str, list[list[int]]],
    liste_competences: list[tuple[str, int]],
) -> dict | None:
    """Restore exercise from saved test state."""
    if competence_index >= len(liste_competences):
        return None
    
    competence = liste_competences[competence_index][0]
    level, ex_id = _pick_next_exercise(competence, exercise_index, exos_par_comp)
    
    if ex_id is None:
        logger.warning(
            "[ChapterTest] No exercise found for restored state: competence_index=%s exercise_index=%s",
            competence_index,
            exercise_index,
        )
        return None
    
    r = available_exercises(supabase_client, "id, difficulty, competences").eq("id", ex_id).execute()
    if not r.data:
        return None
    row = (r.data or [{}])[0] if r.data else {}
    diff = row.get("difficulty", "easy")
    
    exercise_competences = row.get("competences") or []
    if not isinstance(exercise_competences, list):
        exercise_competences = [competence] if competence else []
    
    return {
        "exercise_id": ex_id,
        "competence_id": competence,
        "competences": exercise_competences,
        "difficulty_level": level,
        "difficulty": diff,
        "mode": "test",
        "chapter": chapter,
        "test_competence_index": competence_index,
        "test_exercise_index": exercise_index,
    }


def fetch_or_start_test(
    supabase_client: Any,
    user_id: str,
    chapter: str | None,
) -> dict | None:
    """
    Returns first exercise for chapter placement test, or None if test not needed.
    If test already completed, returns None (caller should use normal recommendation).
    If test is in progress, restores the exercise from saved state.
    """
    ch = get_chapter_for_test(chapter)
    test_completed = is_chapter_test_completed(supabase_client, user_id, ch)
    logger.info(
        "[ChapterTest] fetch_or_start_test: user=%s chapter=%s (normalized=%s) test_completed=%s",
        user_id[:8],
        chapter or "all",
        ch,
        test_completed,
    )
    if test_completed:
        logger.info(
            "[ChapterTest] Test already completed for user=%s chapter=%s, skipping test",
            user_id[:8],
            ch,
        )
        return None

    # Check if test is already in progress
    r_state = (
        supabase_client.table("user_chapter_test_state")
        .select("competence_index, exercise_index, last_success")
        .eq("user_id", user_id)
        .eq("chapter", ch)
        .execute()
    )
    
    liste_competences = _competences_to_test(ch)
    if not liste_competences:
        logger.warning("[ChapterTest] No competences for chapter %s", ch)
        return None

    competences = get_competences(chapter=ch)
    chapters_to_try = CHAPTER_DB_ALIASES.get(ch, [ch])
    q_ex = available_exercises(supabase_client, "id, competences, difficulty, chapter")
    if len(chapters_to_try) == 1:
        q_ex = q_ex.eq("chapter", chapters_to_try[0])
    else:
        q_ex = q_ex.in_("chapter", chapters_to_try)
    r_ex = q_ex.execute()
    exos_par_comp: dict[str, list[list[int]]] = {
        cid: [[], [], []] for cid in competences
    }
    diff_to_idx = {"easy": 0, "medium": 1, "hard": 2}
    for row in r_ex.data or []:
        # competences is an array, iterate through it
        exercise_competences = row.get("competences") or []
        if not isinstance(exercise_competences, list):
            exercise_competences = []
        for cid in exercise_competences:
            if cid and cid in exos_par_comp:
                idx = diff_to_idx.get(row.get("difficulty"), 0)
                exos_par_comp[cid][idx].append(row["id"])

    # If state exists, restore from it
    if r_state.data and len(r_state.data) > 0:
        state_row = r_state.data[0]
        i = int(state_row.get("competence_index", 0))
        j = int(state_row.get("exercise_index", 0))
        
        logger.info(
            "[ChapterTest] Restoring test state for user=%s chapter=%s competence_index=%s exercise_index=%s",
            user_id[:8],
            ch,
            i,
            j,
        )
        
        result = _restore_test_exercise_from_state(
            supabase_client, user_id, ch, i, j, exos_par_comp, liste_competences
        )
        
        if result:
            logger.info(
                "[ChapterTest] Restored test exercise for user=%s chapter=%s exercise_id=%s",
                user_id[:8],
                ch,
                result.get("exercise_id"),
            )
            return result
        else:
            # If restoration failed, start fresh
            logger.warning(
                "[ChapterTest] Failed to restore test state, starting fresh for user=%s chapter=%s",
                user_id[:8],
                ch,
            )

    # No existing state or restoration failed - start new test
    result = _get_first_test_exercise(
        supabase_client, user_id, ch, exos_par_comp, liste_competences
    )
    if result:
        result["chapter"] = ch
        result["test_competence_index"] = 0
        result["test_exercise_index"] = 0
        result["mode"] = "test"  # Explicitly set mode to test
        # Initialize state
        supabase_client.table("user_chapter_test_state").upsert(
            {
                "user_id": user_id,
                "chapter": ch,
                "competence_index": 0,
                "exercise_index": 0,
                "last_success": None,
            },
            on_conflict="user_id,chapter",
        ).execute()
        logger.info(
            "[ChapterTest] Started new test for user=%s chapter=%s competences=%s exercise_id=%s",
            user_id[:8],
            ch,
            result.get("competences"),
            result.get("exercise_id"),
        )
    else:
        logger.info(
            "[ChapterTest] No test exercise found for user=%s chapter=%s",
            user_id[:8],
            ch,
        )
    return result


def get_next_test_exercise(
    supabase_client: Any,
    user_id: str,
    chapter: str,
    last_success: bool,
) -> dict | None:
    """
    Returns next test exercise after user completed the previous one.
    If test is complete, marks it and returns None (caller gets completed=True).
    """
    ch = get_chapter_for_test(chapter)
    if is_chapter_test_completed(supabase_client, user_id, ch):
        return None

    # Load state
    r_state = (
        supabase_client.table("user_chapter_test_state")
        .select("competence_index, exercise_index, last_success")
        .eq("user_id", user_id)
        .eq("chapter", ch)
        .execute()
    )
    row = (r_state.data or [{}])[0] if r_state.data else {}
    i = int(row.get("competence_index", 0))
    j = int(row.get("exercise_index", 0))

    competences = get_competences(chapter=ch)
    liste_competences = _competences_to_test(ch)
    if not liste_competences:
        return None

    chapters_to_try = CHAPTER_DB_ALIASES.get(ch, [ch])
    q_ex = available_exercises(supabase_client, "id, competences, difficulty, chapter")
    if len(chapters_to_try) == 1:
        q_ex = q_ex.eq("chapter", chapters_to_try[0])
    else:
        q_ex = q_ex.in_("chapter", chapters_to_try)
    r_ex = q_ex.execute()
    exos_par_comp: dict[str, list[list[int]]] = {
        cid: [[], [], []] for cid in competences
    }
    diff_to_idx = {"easy": 0, "medium": 1, "hard": 2}
    for r in r_ex.data or []:
        # competences is an array, iterate through it
        exercise_competences = r.get("competences") or []
        if not isinstance(exercise_competences, list):
            exercise_competences = []
        for cid in exercise_competences:
            if cid and cid in exos_par_comp:
                idx = diff_to_idx.get(r.get("difficulty"), 0)
                exos_par_comp[cid][idx].append(r["id"])

    r_scores = (
        supabase_client.table("user_competence_scores")
        .select("competence_id, points")
        .eq("user_id", user_id)
        .execute()
    )
    points_eleve = {r["competence_id"]: r["points"] for r in (r_scores.data or [])}
    for cid in competences:
        points_eleve.setdefault(cid, 0)

    p = len(liste_competences)
    if i >= p:
        _mark_test_completed(supabase_client, user_id, ch)
        return None

    competence = liste_competences[i][0]
    max_points = competences.get(competence, 10)

    # Apply scoring for previous success before advancing
    if j == 0 and last_success:
        _apply_scoring(competence, 0, max_points, points_eleve)
        _upsert_score(supabase_client, user_id, competence, points_eleve[competence])
    elif j == 1 and last_success:
        _apply_scoring(competence, 1, max_points, points_eleve)
        _upsert_score(supabase_client, user_id, competence, points_eleve[competence])
    elif j == 2 and last_success:
        _apply_scoring(competence, 2, max_points, points_eleve)
        _upsert_score(supabase_client, user_id, competence, points_eleve[competence])

    # Advance state
    if j == 0:
        j_next = 1
        i_next = i
    elif j == 1:
        if last_success:
            j_next = 2
            i_next = i
        else:
            j_next = 0
            i_next = i + 1
    else:
        j_next = 0
        i_next = i + 1

    if i_next >= p:
        _mark_test_completed(supabase_client, user_id, ch)
        logger.info("[ChapterTest] Completed for user=%s chapter=%s", user_id[:8], ch)
        return None

    competence_next = liste_competences[i_next][0]
    level, ex_id = _pick_next_exercise(competence_next, j_next, exos_par_comp)
    if ex_id is None:
        logger.warning(
            "[ChapterTest] No exercise for competence=%s j=%s", competence_next, j_next
        )
        i_next += 1
        if i_next >= p:
            _mark_test_completed(supabase_client, user_id, ch)
            return None
        competence_next = liste_competences[i_next][0]
        level, ex_id = _pick_next_exercise(competence_next, 0, exos_par_comp)
        if ex_id is None:
            return None

    supabase_client.table("user_chapter_test_state").upsert(
        {
            "user_id": user_id,
            "chapter": ch,
            "competence_index": i_next,
            "exercise_index": j_next,
            "last_success": last_success,
        },
        on_conflict="user_id,chapter",
    ).execute()

    r = available_exercises(supabase_client, "difficulty").eq("id", ex_id).execute()
    if not r.data:
        return None
    diff = (r.data or [{}])[0].get("difficulty", "easy") if r.data else "easy"

    logger.info(
        "[ChapterTest] Next exercise user=%s chapter=%s competence=%s j=%s success=%s",
        user_id[:8],
        ch,
        competence_next,
        j_next,
        last_success,
    )

    # Get competences array from exercise
    ex_data = available_exercises(supabase_client, "competences").eq("id", ex_id).maybe_single().execute()
    if not ex_data.data:
        return None
    exercise_competences = ex_data.data.get("competences") if ex_data.data else []
    if not isinstance(exercise_competences, list):
        exercise_competences = [competence_next] if competence_next else []
    
    return {
        "exercise_id": ex_id,
        "competence_id": competence_next,  # Keep for backward compatibility
        "competences": exercise_competences,  # Array of competences
        "difficulty_level": level,
        "difficulty": diff,
        "mode": "test",
        "chapter": ch,
        "test_competence_index": i_next,
        "test_exercise_index": j_next,
    }


def _mark_test_completed(supabase_client: Any, user_id: str, chapter: str) -> None:
    supabase_client.table("user_chapter_test_completed").upsert(
        {"user_id": user_id, "chapter": chapter},
        on_conflict="user_id,chapter",
    ).execute()
    supabase_client.table("user_chapter_test_state").delete().eq(
        "user_id", user_id
    ).eq("chapter", chapter).execute()


def _upsert_score(
    supabase_client: Any, user_id: str, competence_id: str, points: int
) -> None:
    from datetime import datetime, timezone
    r = (
        supabase_client.table("user_competence_scores")
        .select("streak")
        .eq("user_id", user_id)
        .eq("competence_id", competence_id)
        .execute()
    )
    streak = 0
    if r.data and len(r.data) > 0:
        streak = int(r.data[0].get("streak", 0) or 0)
    supabase_client.table("user_competence_scores").upsert(
        {
            "user_id": user_id,
            "competence_id": competence_id,
            "points": points,
            "streak": streak,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id,competence_id",
    ).execute()
