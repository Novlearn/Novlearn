"""
Preferences de notification et souscriptions push.
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from auth import get_supabase_client, verify_token
from schemas import (
    NotificationPreferencesRequest,
    PushSubscribeRequest,
    PushUnsubscribeRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Retourne la clé publique VAPID pour les souscriptions push côté frontend."""
    key = os.getenv("VAPID_PUBLIC_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="Notifications push non configurées")
    return {"publicKey": key}


@router.get("/preferences")
async def get_notification_preferences(user: dict = Depends(verify_token)):
    """Retourne les préférences de notifications de l'utilisateur connecté."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        result = (
            supabase.table("profiles")
            .select("notif_push_duels, notif_push_daily, notif_email_duels, notif_email_daily, notif_newsletter")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Profil introuvable")
        return result.data
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_notification_preferences error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la récupération des préférences")


@router.put("/preferences")
async def update_notification_preferences(
    body: NotificationPreferencesRequest,
    user: dict = Depends(verify_token),
):
    """Met à jour les préférences de notifications de l'utilisateur connecté."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        supabase.table("profiles").update({
            "notif_push_duels": body.notif_push_duels,
            "notif_push_daily": body.notif_push_daily,
            "notif_email_duels": body.notif_email_duels,
            "notif_email_daily": body.notif_email_daily,
            "notif_newsletter": body.notif_newsletter,
        }).eq("id", user_id).execute()
        return {"message": "Préférences mises à jour"}
    except Exception as exc:
        logger.error("update_notification_preferences error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour des préférences")


@router.post("/subscribe")
async def subscribe_push(
    body: PushSubscribeRequest,
    user: dict = Depends(verify_token),
):
    """Enregistre une souscription Web Push pour l'utilisateur connecté."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        supabase.table("push_subscriptions").upsert({
            "user_id": user_id,
            "endpoint": body.endpoint,
            "p256dh": body.p256dh,
            "auth": body.auth,
        }, on_conflict="user_id,endpoint").execute()
        return {"message": "Souscription enregistrée"}
    except Exception as exc:
        logger.error("subscribe_push error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'enregistrement de la souscription")


@router.delete("/subscribe")
async def unsubscribe_push(
    body: PushUnsubscribeRequest,
    user: dict = Depends(verify_token),
):
    """Supprime une souscription Web Push pour l'utilisateur connecté."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        supabase.table("push_subscriptions").delete()\
            .eq("user_id", user_id)\
            .eq("endpoint", body.endpoint)\
            .execute()
        return {"message": "Souscription supprimée"}
    except Exception as exc:
        logger.error("unsubscribe_push error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de la souscription")
