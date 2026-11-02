"""
Algorithme de recommandation d'exercice selon compétences, points et streak (par chapitre ou global).
Bon streak → exos sur compétences moins maîtrisées ; mauvais streak → remise en confiance.
"""
import logging
import random
from typing import Any

from exercise_availability import available_exercises

from settings.competence_settings import get_competences, CHAPTER_DB_ALIASES

logger = logging.getLogger(__name__)
from settings.recommandation_settings import (
    STREAK_VERY_LOW,
    STREAK_LOW,
    STREAK_MID,
    CONF_EASY_MAX_VERY_LOW,
    CONF_MEDIUM_MAX_VERY_LOW,
    CONF_EASY_MAX_LOW,
    CONF_MEDIUM_MAX_LOW,
    CONF_EASY_MAX_MID,
    CONF_MEDIUM_MAX_MID,
    CONF_MEDIUM_MAX_HIGH,
    CONF_EASY_MAX_HIGH,
    CONF_MEDIUM_MAX_HIGH,
    DIFFICULTY_BY_LEVEL,
)
from streak import compute_streak


def _tri_fusion_par_ratio(l: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Tri fusion par valeur du 2e élément (ratio), ordre croissant."""
    if len(l) < 2:
        return l
    m = len(l) // 2
    return _fusion(
        _tri_fusion_par_ratio(l[:m]),
        _tri_fusion_par_ratio(l[m:]),
    )


def _fusion(
    l1: list[tuple[str, float]], l2: list[tuple[str, float]]
) -> list[tuple[str, float]]:
    if not l1:
        return l2
    if not l2:
        return l1
    res, i, j = [], 0, 0
    while i < len(l1) and j < len(l2):
        if l1[i][1] <= l2[j][1]:
            res.append(l1[i])
            i += 1
        else:
            res.append(l2[j])
            j += 1
    res.extend(l1[i:])
    res.extend(l2[j:])
    return res


def _choisir_difficulte(ratio: float, easy_max: float, medium_max: float) -> int:
    """Retourne 0=facile, 1=moyen, 2=difficile selon le ratio de confiance."""
    if ratio < easy_max:
        return 0
    if ratio < medium_max:
        return 1
    return 2


def _pick_exercise_id(ids: list[int]) -> int | None:
    """Index aléatoire dans la liste ; None si vide."""
    if not ids:
        return None
    return random.choice(ids)


def _get_exercise_result(
    supabase_client: Any, eid: int | None, c: str | None, lvl: int | None
) -> dict | None:
    """Get exercise result dict with competences array."""
    if eid is None or c is None:
        return None
    # Get competences array for this exercise
    ex_data = available_exercises(supabase_client, "competences").eq("id", eid).maybe_single().execute()
    if not ex_data.data:
        return None
    exercise_competences = ex_data.data.get("competences") if ex_data.data else []
    if not isinstance(exercise_competences, list):
        exercise_competences = [c] if c else []  # Fallback to single competence
    
    return {
        "exercise_id": eid,
        "competence_id": c,  # Keep for backward compatibility
        "competences": exercise_competences,  # Array of competences
        "difficulty_level": lvl,
        "difficulty": DIFFICULTY_BY_LEVEL[lvl] if lvl is not None else "easy",
    }


def _fallback_random_exercise(
    supabase_client: Any, chapter: str | None = None
) -> dict | None:
    """Un exercice aléatoire avec competences non vide si possible ; optionnellement filtré par chapitre."""
    q = available_exercises(supabase_client, "id, competences, difficulty, chapter")
    if chapter:
        chapters_to_try = CHAPTER_DB_ALIASES.get(chapter, [chapter])
        if len(chapters_to_try) == 1:
            q = q.eq("chapter", chapters_to_try[0])
        else:
            q = q.in_("chapter", chapters_to_try)
    r = q.limit(200).execute()
    data = r.data or []
    # Try to find exercises with competences array (non-empty) first
    data_with_competences = [
        e for e in data 
        if e.get("competences") and isinstance(e.get("competences"), list) and len(e.get("competences", [])) > 0
    ]
    if data_with_competences:
        ex = random.choice(data_with_competences)
        level = 0 if ex.get("difficulty") == "easy" else (1 if ex.get("difficulty") == "medium" else 2)
        competences_array = ex.get("competences") or []
        logger.info(
            "[Recommandation] Fallback: using exercise %s with competences=%s",
            ex["id"],
            competences_array,
        )
        return {
            "exercise_id": ex["id"],
            "competence_id": competences_array[0] if competences_array else None,  # Keep for backward compatibility
            "competences": competences_array,  # Array of competences
            "difficulty_level": level,
            "difficulty": ex.get("difficulty"),
        }
    # If no exercises with competences, log warning and return None
    logger.warning(
        "[Recommandation] Fallback: No exercises with competences found for chapter=%s. Total exercises: %d",
        chapter or "all",
        len(data),
    )
    return None


def recommander_exercice(
    supabase_client: Any, user_id: str, chapter: str | None = None
) -> dict | None:
    """
    Recommande un exercice pour l'utilisateur.
    chapter : si fourni, streak et exos/compétences sont limités à ce chapitre.
    Retourne {"exercise_id", "competence_id", "difficulty_level", "difficulty"} ou None.
    """
    # Chapitres marqués "pas encore vus" par l'utilisateur
    # Si un chapitre est explicitement choisi, on ne filtre pas (choix volontaire de l'élève)
    hidden_chapters: list[str] = []
    profile_current_streak: int | None = None
    if chapter is None:
        try:
            profile_resp = (
                supabase_client.table("profiles")
                .select("hidden_chapters, current_streak")
                .eq("id", user_id)
                .maybe_single()
                .execute()
            )
            if profile_resp.data:
                hidden_chapters = profile_resp.data.get("hidden_chapters") or []
                profile_current_streak = profile_resp.data.get("current_streak")
        except Exception as exc:
            logger.warning("[Recommandation] Impossible de charger le profil: %s", exc)

    # Compétences et max_points (depuis settings, pas la DB)
    competences = get_competences(chapter=chapter, exclude_chapters=hidden_chapters or None)
    if not competences:
        return _fallback_random_exercise(supabase_client, chapter)

    # Points utilisateur (défaut 0)
    r_scores = (
        supabase_client.table("user_competence_scores")
        .select("competence_id, points")
        .eq("user_id", user_id)
        .execute()
    )
    points_eleve = {row["competence_id"]: row["points"] for row in (r_scores.data or [])}
    for cid in competences:
        points_eleve.setdefault(cid, 0)

    # Exercices par compétence et difficulté (optionnellement filtrés par chapitre)
    q_ex = available_exercises(supabase_client, "id, competences, difficulty, chapter")
    if chapter:
        chapters_to_try = CHAPTER_DB_ALIASES.get(chapter, [chapter])
        if len(chapters_to_try) == 1:
            q_ex = q_ex.eq("chapter", chapters_to_try[0])
        else:
            q_ex = q_ex.in_("chapter", chapters_to_try)
    r_ex = q_ex.execute()
    exos_par_comp: dict[str, list[list[int]]] = {
        cid: [[], [], []] for cid in competences
    }
    diff_to_idx = {
        "easy": 0, "medium": 1, "hard": 2,
        "Facile": 0, "Moyen": 1, "Difficile": 2,
    }
    for row in r_ex.data or []:
        # competences is an array, iterate through it
        exercise_competences = row.get("competences") or []
        if not isinstance(exercise_competences, list):
            exercise_competences = []
        for cid in exercise_competences:
            if cid and cid in exos_par_comp:
                idx = diff_to_idx.get(row.get("difficulty"), 0)
                exos_par_comp[cid][idx].append(row["id"])

    # Ne garder que les compétences qui ont au moins un exo
    competences_avec_exos = {
        cid for cid, listes in exos_par_comp.items()
        if any(listes)
    }
    if not competences_avec_exos:
        logger.warning(
            "[Recommandation] No exercises found for any competence. Total exercises queried: %d, exercises with valid competence_id: %d",
            len(r_ex.data or []),
            sum(len(listes[0]) + len(listes[1]) + len(listes[2]) for listes in exos_par_comp.values()),
        )
        return _fallback_random_exercise(supabase_client, chapter)

    max_points = competences
    acquises = []
    non_acquises = []
    for cid in competences_avec_exos:
        pts = points_eleve[cid]
        mx = max_points[cid]
        if mx <= 0:
            continue
        if pts >= mx:
            acquises.append((cid, pts))
        else:
            non_acquises.append((cid, pts / mx))

    non_acquises = _tri_fusion_par_ratio(non_acquises)
    n_non = len(non_acquises)
    if chapter is None and profile_current_streak is not None:
        streak = profile_current_streak
    else:
        streak = compute_streak(supabase_client, user_id, chapter=chapter)

    def choisir(
        cid: str, niveau: int
    ) -> tuple[int | None, str | None, int | None]:
        listes = exos_par_comp.get(cid, [[], [], []])
        ids = listes[niveau] if 0 <= niveau < 3 else listes[0]
        if not ids:
            for niv in (0, 1, 2):
                if listes[niv]:
                    eid = _pick_exercise_id(listes[niv])
                    logger.debug(
                        "[Recommandation] choisir: competence=%s niveau=%d -> exercise_id=%s (fallback from niveau %d)",
                        cid,
                        niveau,
                        eid,
                        niv,
                    )
                    return eid, cid, niv
            logger.warning(
                "[Recommandation] choisir: No exercises found for competence=%s niveau=%d",
                cid,
                niveau,
            )
            return None, None, None
        eid = _pick_exercise_id(ids)
        logger.debug(
            "[Recommandation] choisir: competence=%s niveau=%d -> exercise_id=%s",
            cid,
            niveau,
            eid,
        )
        return eid, cid, niveau

    # Streak très bas : remettre en confiance
    if streak < STREAK_VERY_LOW:
        if acquises:
            cid = random.choice(acquises)[0]
            rnd = random.random()
            niv = _choisir_difficulte(rnd, CONF_EASY_MAX_VERY_LOW, CONF_MEDIUM_MAX_VERY_LOW)
            eid, c, lvl = choisir(cid, niv)
            result = _get_exercise_result(supabase_client, eid, c, lvl)
            if result:
                return result
            elif eid is not None:
                logger.warning(
                    "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                    eid,
                    cid,
                )
        else:
            if n_non:
                cid, ratio = non_acquises[n_non - 1]
                niv = _choisir_difficulte(
                    ratio, CONF_EASY_MAX_VERY_LOW, CONF_MEDIUM_MAX_VERY_LOW
                )
                eid, c, lvl = choisir(cid, niv)
                result = _get_exercise_result(supabase_client, eid, c, lvl)
                if result:
                    return result
                elif eid is not None:
                    logger.warning(
                        "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                        eid,
                        cid,
                    )

    # Streak bas : confiance légère
    elif streak < STREAK_LOW:
        if not non_acquises:
            if acquises:
                cid = random.choice(acquises)[0]
                rnd = random.random()
                niv = _choisir_difficulte(rnd, CONF_EASY_MAX_LOW, CONF_MEDIUM_MAX_LOW)
                eid, c, lvl = choisir(cid, niv)
                result = _get_exercise_result(supabase_client, eid, c, lvl)
                if result:
                    return result
                elif eid is not None:
                    logger.warning(
                        "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                        eid,
                        cid,
                    )
        else:
            cid, ratio = non_acquises[n_non - 1]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_LOW, CONF_MEDIUM_MAX_LOW)
            eid, c, lvl = choisir(cid, niv)
            result = _get_exercise_result(supabase_client, eid, c, lvl)
            if result:
                return result
            elif eid is not None:
                logger.warning(
                    "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                    eid,
                    cid,
                )

    # Progression moyenne
    elif streak < STREAK_MID:
        if not non_acquises:
            if acquises:
                cid = random.choice(acquises)[0]
                rnd = random.random()
                niv = _choisir_difficulte(rnd, CONF_EASY_MAX_MID, CONF_MEDIUM_MAX_MID)
                eid, c, lvl = choisir(cid, niv)
                result = _get_exercise_result(supabase_client, eid, c, lvl)
                if result:
                    return result
                elif eid is not None:
                    logger.warning(
                        "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                        eid,
                        cid,
                    )
        else:
            cid, ratio = non_acquises[n_non // 2]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_LOW, CONF_MEDIUM_MAX_LOW)
            eid, c, lvl = choisir(cid, niv)
            result = _get_exercise_result(supabase_client, eid, c, lvl)
            if result:
                return result
            elif eid is not None:
                logger.warning(
                    "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                    eid,
                    cid,
                )

    # Défi : compétence la plus faible (ou acquises en moyen/difficile)
    else:
        if not non_acquises:
            if acquises:
                cid = random.choice(acquises)[0]
                rnd = random.random()
                niv = 1 if rnd < CONF_MEDIUM_MAX_HIGH else 2
                eid, c, lvl = choisir(cid, niv)
                result = _get_exercise_result(supabase_client, eid, c, lvl)
                if result:
                    # Override difficulty if needed
                    if lvl is not None and lvl >= 1:
                        result["difficulty"] = DIFFICULTY_BY_LEVEL[lvl] if lvl == 1 else "hard"
                    return result
        else:
            cid, ratio = non_acquises[0]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_HIGH, CONF_MEDIUM_MAX_HIGH)
            eid, c, lvl = choisir(cid, niv)
            result = _get_exercise_result(supabase_client, eid, c, lvl)
            if result:
                return result
            elif eid is not None:
                logger.warning(
                    "[Recommandation] Exercise %s found but competence_id is None for competence %s",
                    eid,
                    cid,
                )

    return _fallback_random_exercise(supabase_client, chapter)
