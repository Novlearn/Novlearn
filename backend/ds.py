"""
Logique métier pour les DS (Devoirs Surveillés).
- CRUD DS
- Recommandation ciblée sur les compétences sélectionnées du DS
- Mise à jour des scores DS (indépendants des scores globaux)
"""
import logging
import random
from datetime import datetime, timezone
from typing import Any

from exercise_availability import available_exercises

from recommandation import (
    _tri_fusion_par_ratio,
    _choisir_difficulte,
    _pick_exercise_id,
)
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
    CONF_EASY_MAX_HIGH,
    CONF_MEDIUM_MAX_HIGH,
    DIFFICULTY_BY_LEVEL,
)

logger = logging.getLogger(__name__)

# Points gagnés par difficulté (correcte)


# ============================================================
# INITIALISATION DES SCORES DS
# ============================================================

def initialiser_scores_ds(
    supabase_client: Any, ds_id: str, competence_ids: list[str]
) -> None:
    """
    Initialise les lignes ds_competence_scores pour un DS nouvellement créé.
    Récupère max_points depuis la table competences.
    """
    if not competence_ids:
        return

    r = (
        supabase_client.table("competences")
        .select("id, max_points")
        .in_("id", competence_ids)
        .execute()
    )
    max_points_map = {row["id"]: row["max_points"] for row in (r.data or [])}

    rows = []
    for cid in competence_ids:
        mp = max_points_map.get(cid, 10)
        rows.append({
            "ds_id": ds_id,
            "competence_id": cid,
            "points": 0,
            "max_points": mp,
        })

    if rows:
        supabase_client.table("ds_competence_scores").insert(rows).execute()
    logger.info("[DS] Scores initialisés pour ds_id=%s (%d compétences)", ds_id, len(rows))


# ============================================================
# RECOMMANDATION DS
# ============================================================

def recommander_exercice_ds(
    supabase_client: Any,
    ds_id: str,
    competence_ids: list[str],
    current_streak: int,
) -> dict | None:
    """
    Recommande un exercice dans le contexte du DS.
    - Filtre uniquement les exercices couvrant au moins une compétence du DS
    - Utilise ds_competence_scores pour les ratios (pas user_competence_scores)
    - Le streak est directement passé (stocké dans ds.current_streak)
    """
    if not competence_ids:
        logger.warning("[DS] recommander_exercice_ds: aucune compétence dans le DS %s", ds_id)
        return None

    def _normalize_competence_id(value: Any) -> str | None:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    def _extract_exercise_competences(row: dict[str, Any]) -> list[str]:
        out: list[str] = []
        raw = row.get("competences")
        if isinstance(raw, list):
            for item in raw:
                cid = _normalize_competence_id(item)
                if cid:
                    out.append(cid)
        elif isinstance(raw, str):
            cid = _normalize_competence_id(raw)
            if cid:
                out.append(cid)

        legacy = _normalize_competence_id(row.get("competence_id"))
        if legacy:
            out.append(legacy)

        # Conserver l'ordre tout en supprimant les doublons.
        return list(dict.fromkeys(out))

    normalized_competence_ids = [
        cid for cid in (_normalize_competence_id(c) for c in competence_ids) if cid
    ]
    if not normalized_competence_ids:
        logger.warning("[DS] recommander_exercice_ds: compétences invalides pour le DS %s", ds_id)
        return None

    # Scores DS pour ce DS
    r_scores = (
        supabase_client.table("ds_competence_scores")
        .select("competence_id, points, max_points")
        .eq("ds_id", ds_id)
        .execute()
    )
    scores_ds = {
        row["competence_id"]: (row["points"], row["max_points"])
        for row in (r_scores.data or [])
    }
    # Si des compétences n'ont pas encore de score (ne devrait pas arriver), défaut 0/10
    for cid in normalized_competence_ids:
        if cid not in scores_ds:
            scores_ds[cid] = (0, 10)

    # Mapping nom d'affichage → id de compétence
    # Les exercices stockent les noms d'affichage ("Calculer des termes") et non les IDs.
    r_names = (
        supabase_client.table("competences")
        .select("id, name")
        .in_("id", normalized_competence_ids)
        .execute()
    )
    name_to_id: dict[str, str] = {row["name"]: row["id"] for row in (r_names.data or [])}
    print(f"[DS DEBUG] name_to_id ({len(name_to_id)} entrées): {name_to_id}", flush=True)

    # Exercices couvrant au moins une compétence du DS
    # On charge tous les exercices et on filtre en Python (pas de filtre array overlap natif)
    r_ex = (
        available_exercises(supabase_client, "id, competences, difficulty")
        .execute()
    )
    competence_ids_set = set(normalized_competence_ids)

    exos_par_comp: dict[str, list[list[int]]] = {
        cid: [[], [], []] for cid in normalized_competence_ids
    }
    diff_to_idx = {
        "easy": 0, "medium": 1, "hard": 2,
        "Facile": 0, "Moyen": 1, "Difficile": 2,
    }

    for row in r_ex.data or []:
        exercise_competences = _extract_exercise_competences(row)
        if not exercise_competences:
            continue
        # Résoudre nom d'affichage → id, puis intersect avec les compétences du DS
        matching: list[str] = []
        for display_or_id in exercise_competences:
            resolved = name_to_id.get(display_or_id, display_or_id)
            if resolved in competence_ids_set:
                matching.append(resolved)
        if not matching:
            continue
        idx = diff_to_idx.get(row.get("difficulty"), 0)
        for cid in matching:
            exos_par_comp[cid][idx].append(row["id"])

    # Compétences avec au moins un exercice
    competences_avec_exos = {
        cid for cid, listes in exos_par_comp.items() if any(listes)
    }
    total_exos = sum(len(lst) for listes in exos_par_comp.values() for lst in listes)
    print(f"[DS DEBUG] total_exos={total_exos}, competences_avec_exos={list(competences_avec_exos)}", flush=True)
    print(f"[DS DEBUG] exos_par_comp={exos_par_comp}", flush=True)
    if not competences_avec_exos:
        print(f"[DS DEBUG] ECHEC - name_to_id={name_to_id}, competence_ids_set={competence_ids_set}", flush=True)
        logger.warning("[DS] Aucun exercice trouvé pour le DS %s", ds_id)
        return None

    # Calcul acquises / non-acquises
    acquises = []
    non_acquises = []
    for cid in competences_avec_exos:
        pts, mx = scores_ds[cid]
        if mx <= 0:
            continue
        if pts >= mx:
            acquises.append((cid, pts))
        else:
            non_acquises.append((cid, pts / mx))

    non_acquises = _tri_fusion_par_ratio(non_acquises)
    n_non = len(non_acquises)
    streak = current_streak

    def choisir(cid: str, niveau: int) -> tuple[int | None, str | None, int | None]:
        listes = exos_par_comp.get(cid, [[], [], []])
        ids = listes[niveau] if 0 <= niveau < 3 else listes[0]
        if not ids:
            for niv in (0, 1, 2):
                if listes[niv]:
                    return _pick_exercise_id(listes[niv]), cid, niv
            return None, None, None
        return _pick_exercise_id(ids), cid, niveau

    def build_result(eid: int | None, cid: str | None, lvl: int | None) -> dict | None:
        if eid is None or cid is None:
            return None
        # Récupère le tableau complet des compétences de l'exercice
        ex_data = (
            available_exercises(supabase_client, "competences")
            .eq("id", eid)
            .maybe_single()
            .execute()
        )
        if not ex_data.data:
            return None
        raw_competences = _extract_exercise_competences(ex_data.data)
        # Convertir noms d'affichage → ids, puis filtrer aux compétences du DS
        ex_competences_ids = [name_to_id.get(c, c) for c in raw_competences]
        ex_competences_ids = [c for c in ex_competences_ids if c in competence_ids_set]
        if not ex_competences_ids:
            ex_competences_ids = [cid]
        return {
            "exercise_id": eid,
            "competence_id": cid,
            "competences": ex_competences_ids,
            "difficulty_level": lvl,
            "difficulty": DIFFICULTY_BY_LEVEL[lvl] if lvl is not None else "easy",
        }

    # Même logique de sélection que recommandation.py
    if streak < STREAK_VERY_LOW:
        if acquises:
            cid = random.choice(acquises)[0]
            rnd = random.random()
            niv = _choisir_difficulte(rnd, CONF_EASY_MAX_VERY_LOW, CONF_MEDIUM_MAX_VERY_LOW)
            r = build_result(*choisir(cid, niv))
            if r:
                return r
        elif n_non:
            cid, ratio = non_acquises[n_non - 1]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_VERY_LOW, CONF_MEDIUM_MAX_VERY_LOW)
            r = build_result(*choisir(cid, niv))
            if r:
                return r

    elif streak < STREAK_LOW:
        if not non_acquises and acquises:
            cid = random.choice(acquises)[0]
            rnd = random.random()
            niv = _choisir_difficulte(rnd, CONF_EASY_MAX_LOW, CONF_MEDIUM_MAX_LOW)
            r = build_result(*choisir(cid, niv))
            if r:
                return r
        elif n_non:
            cid, ratio = non_acquises[n_non - 1]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_LOW, CONF_MEDIUM_MAX_LOW)
            r = build_result(*choisir(cid, niv))
            if r:
                return r

    elif streak < STREAK_MID:
        if not non_acquises and acquises:
            cid = random.choice(acquises)[0]
            rnd = random.random()
            niv = _choisir_difficulte(rnd, CONF_EASY_MAX_MID, CONF_MEDIUM_MAX_MID)
            r = build_result(*choisir(cid, niv))
            if r:
                return r
        elif n_non:
            cid, ratio = non_acquises[n_non // 2]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_LOW, CONF_MEDIUM_MAX_LOW)
            r = build_result(*choisir(cid, niv))
            if r:
                return r

    else:
        if not non_acquises and acquises:
            cid = random.choice(acquises)[0]
            rnd = random.random()
            niv = 1 if rnd < CONF_MEDIUM_MAX_HIGH else 2
            r = build_result(*choisir(cid, niv))
            if r:
                return r
        elif n_non:
            cid, ratio = non_acquises[0]
            niv = _choisir_difficulte(ratio, CONF_EASY_MAX_HIGH, CONF_MEDIUM_MAX_HIGH)
            r = build_result(*choisir(cid, niv))
            if r:
                return r

    # Fallback : exercice aléatoire parmi les compétences du DS
    logger.info("[DS] Fallback aléatoire pour DS %s", ds_id)
    all_ids = []
    for listes in exos_par_comp.values():
        for lst in listes:
            all_ids.extend(lst)
    if all_ids:
        eid = random.choice(all_ids)
        # Trouver la compétence associée
        for cid, listes in exos_par_comp.items():
            for lvl_idx, lst in enumerate(listes):
                if eid in lst:
                    return build_result(eid, cid, lvl_idx)
    return None


# ============================================================
# SOUMISSION D'UNE RÉPONSE DS
# ============================================================
