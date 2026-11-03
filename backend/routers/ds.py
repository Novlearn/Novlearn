"""
Devoirs surveilles : creation, suivi, recommandation et soumission.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from auth import get_supabase_client, verify_token
from ds import (
    initialiser_scores_ds,
    recommander_exercice_ds,
    soumettre_reponse_ds,
)
from schemas import CreateDSRequest, SubmitDSAnswerRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ds", tags=["ds"])


@router.post("")
async def create_ds(
    body: CreateDSRequest,
    user: dict = Depends(verify_token),
):
    """Crée un nouveau DS et initialise les scores par compétence."""
    user_id = user["user_id"]
    supabase = get_supabase_client()

    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Le titre est obligatoire")
    if not body.competence_ids:
        raise HTTPException(status_code=400, detail="Sélectionnez au moins une compétence")

    try:
        deadline_dt = datetime.fromisoformat(body.deadline.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Format de deadline invalide (ISO 8601 attendu)")

    if deadline_dt <= datetime.now(deadline_dt.tzinfo):
        raise HTTPException(status_code=400, detail="La deadline doit être dans le futur")

    r = supabase.table("ds").insert({
        "user_id": user_id,
        "title": body.title.strip(),
        "deadline": body.deadline,
        "competence_ids": body.competence_ids,
        "current_streak": 0,
    }).execute()

    if not r.data:
        raise HTTPException(status_code=500, detail="Erreur lors de la création du DS")

    ds = r.data[0]
    initialiser_scores_ds(supabase, ds["id"], body.competence_ids)

    logger.info("[DS] Créé par user=%s ds_id=%s titre='%s'", user_id, ds["id"], body.title)
    return ds


@router.get("")
async def list_ds(
    user: dict = Depends(verify_token),
):
    """Liste tous les DS de l'utilisateur avec leur statut (active/expired)."""
    user_id = user["user_id"]
    supabase = get_supabase_client()

    r = (
        supabase.table("ds")
        .select("id, title, deadline, competence_ids, current_streak, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    now = datetime.now(timezone.utc)
    ds_list = []
    for ds in (r.data or []):
        try:
            deadline_dt = datetime.fromisoformat(ds["deadline"].replace("Z", "+00:00"))
            status = "active" if deadline_dt > now else "expired"
        except Exception:
            status = "expired"
        ds_list.append({**ds, "status": status})

    return {"ds": ds_list}


@router.get("/{ds_id}")
async def get_ds(
    ds_id: str,
    user: dict = Depends(verify_token),
):
    """Détail d'un DS : infos + scores par compétence."""
    user_id = user["user_id"]
    supabase = get_supabase_client()

    r = (
        supabase.table("ds")
        .select("id, title, deadline, competence_ids, current_streak, created_at")
        .eq("id", ds_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="DS introuvable")

    ds = r.data
    now = datetime.now(timezone.utc)
    try:
        deadline_dt = datetime.fromisoformat(ds["deadline"].replace("Z", "+00:00"))
        status = "active" if deadline_dt > now else "expired"
    except Exception:
        status = "expired"

    r_scores = (
        supabase.table("ds_competence_scores")
        .select("competence_id, points, max_points, updated_at")
        .eq("ds_id", ds_id)
        .execute()
    )

    return {
        **ds,
        "status": status,
        "scores": r_scores.data or [],
    }


@router.get("/{ds_id}/recommend")
async def ds_recommend(
    ds_id: str,
    user: dict = Depends(verify_token),
):
    """Recommande un exercice dans le contexte du DS."""
    user_id = user["user_id"]
    supabase = get_supabase_client()

    r = (
        supabase.table("ds")
        .select("id, competence_ids, current_streak, deadline")
        .eq("id", ds_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="DS introuvable")

    ds = r.data
    result = recommander_exercice_ds(
        supabase,
        ds_id=ds_id,
        competence_ids=ds["competence_ids"],
        current_streak=ds["current_streak"],
    )
    if not result:
        raise HTTPException(status_code=404, detail="Aucun exercice disponible pour ce DS")

    logger.info(
        "[DS] Recommandation ds_id=%s user=%s → exo=%s",
        ds_id,
        user_id,
        result.get("exercise_id"),
    )
    return result


@router.delete("/{ds_id}")
async def delete_ds(ds_id: str, user: dict = Depends(verify_token)):
    """Supprime un DS appartenant à l'utilisateur connecté."""
    user_id = user["user_id"]
    supabase = get_supabase_client()

    r = (
        supabase.table("ds")
        .select("id")
        .eq("id", ds_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="DS introuvable")

    supabase.table("ds_competence_scores").delete().eq("ds_id", ds_id).execute()
    supabase.table("ds").delete().eq("id", ds_id).eq("user_id", user_id).execute()
    return {"message": "DS supprimé"}


@router.post("/{ds_id}/submit")
async def ds_submit(
    ds_id: str,
    body: SubmitDSAnswerRequest,
    user: dict = Depends(verify_token),
):
    """Soumet une réponse dans le contexte du DS et met à jour les scores."""
    user_id = user["user_id"]
    supabase = get_supabase_client()

    r = (
        supabase.table("ds")
        .select("id")
        .eq("id", ds_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="DS introuvable")

    soumettre_reponse_ds(
        supabase,
        ds_id=ds_id,
        competence_ids=body.competence_ids,
        is_correct=body.is_correct,
        difficulty=body.difficulty,
    )
    return {"message": "Réponse enregistrée"}
