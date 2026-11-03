"""
Lobby des duels 1v1 : creation, acceptation, refus, historique.

L'etat de la partie elle-meme vit dans le duel-server Colyseus.
"""
import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_supabase_client, verify_token
from notifications import email_duel_challenge, send_email, send_push_to_user
from schemas import CreateDuelRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/duels", tags=["duels"])


@router.post("/create")
async def create_duel(request: CreateDuelRequest, user: dict = Depends(verify_token)):
    """Create a duel challenge"""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        
        # Check if users are friends
        user1 = min(user_id, request.friend_id)
        user2 = max(user_id, request.friend_id)
        
        friendship = supabase.table("friends")\
            .select("*")\
            .eq("user1_id", user1)\
            .eq("user2_id", user2)\
            .eq("status", "accepted")\
            .execute()
        
        if not friendship.data:
            raise HTTPException(status_code=400, detail="Vous devez être amis pour lancer un duel")
        
        # Create duel (exercise will be chosen randomly when the duel is accepted)
        duel_data = {
            "player1_id": user_id,
            "player2_id": request.friend_id,
            "status": "waiting",
            "player1_score": 0,
            "player2_score": 0
        }
        
        result = supabase.table("duels").insert(duel_data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Erreur lors de la création du duel")

        # Récupérer le prénom du challenger pour les notifications
        challenger_profile = (
            supabase.table("profiles")
            .select("first_name, email, notif_email_duels")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        challenger_name = (
            challenger_profile.data.get("first_name") or "Un adversaire"
            if challenger_profile.data
            else "Un adversaire"
        )

        # Notification push à l'adversaire (si activée)
        send_push_to_user(
            supabase,
            request.friend_id,
            "Défi reçu ! ⚔️",
            f"{challenger_name} t'a lancé un défi. Relève-le !",
            "/duel",
        )

        # Notification email à l'adversaire (si activée)
        try:
            opponent_profile = (
                supabase.table("profiles")
                .select("email, notif_email_duels")
                .eq("id", request.friend_id)
                .maybe_single()
                .execute()
            )
            if (
                opponent_profile.data
                and opponent_profile.data.get("notif_email_duels")
                and opponent_profile.data.get("email")
            ):
                subject, html = email_duel_challenge(challenger_name)
                send_email(opponent_profile.data["email"], subject, html)
        except Exception as notif_err:
            logger.warning("[API] Erreur notification email duel: %s", notif_err)

        return {"message": "Duel créé avec succès", "duel_id": result.data[0]["id"], "duel": result.data[0]}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating duel: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{duel_id}/accept")
async def accept_duel(duel_id: int, user: dict = Depends(verify_token)):
    """
    Accept a duel challenge.
    Marks the duel as 'active' in DB so player1 gets the Supabase Realtime notification
    and navigates to /duel/active/[id]. Both players then connect to the Colyseus room.
    """
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]

        duel = supabase.table("duels").select("id, player1_id, player2_id, status").eq("id", duel_id).execute()
        if not duel.data:
            raise HTTPException(status_code=404, detail="Duel introuvable")

        duel_data = duel.data[0]
        if duel_data["player2_id"] != user_id:
            raise HTTPException(status_code=403, detail="Vous n'êtes pas autorisé à accepter ce duel")

        player1_id = duel_data["player1_id"]
        now_iso = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()

        # Close any stale active duels involving either player (exclude this duel).
        # This prevents the redirect from picking an old duel instead of the new one.
        for pid in {player1_id, user_id}:
            supabase.table("duels").update({
                "status": "finished",
                "finished_at": now_iso,
            }).eq("status", "active").neq("id", duel_id).or_(
                f"player1_id.eq.{pid},player2_id.eq.{pid}"
            ).execute()

        result = supabase.table("duels").update({
            "status": "active",
            "started_at": now_iso,
        }).eq("id", duel_id).execute()

        logger.info("[API] duel accepted duel_id=%s player2=%s", duel_id, user_id[:8])
        return {"message": "Duel accepté", "duel": result.data[0]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error accepting duel: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{duel_id}/decline")
async def decline_duel(duel_id: int, user: dict = Depends(verify_token)):
    """Decline a duel challenge."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]

        duel = supabase.table("duels").select("id, player2_id").eq("id", duel_id).execute()
        if not duel.data:
            raise HTTPException(status_code=404, detail="Duel introuvable")
        if duel.data[0]["player2_id"] != user_id:
            raise HTTPException(status_code=403, detail="Vous n'êtes pas autorisé à refuser ce duel")

        supabase.table("duels").delete().eq("id", duel_id).execute()
        return {"message": "Duel refusé"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error declining duel: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pending")
async def get_pending_duels(user: dict = Depends(verify_token)):
    """Get pending duel requests for current user."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]

        result = supabase.table("duels")\
            .select("id, player1_id, created_at")\
            .eq("player2_id", user_id)\
            .eq("status", "waiting")\
            .execute()

        player1_ids = [d["player1_id"] for d in result.data or [] if d.get("player1_id")]
        profiles_map = {}
        if player1_ids:
            pr = supabase.table("profiles").select("id, first_name, last_name, email, avatar_id, avatar_color").in_("id", player1_ids).execute()
            profiles_map = {p["id"]: p for p in (pr.data or [])}

        duels_data = []
        for duel in result.data or []:
            p = profiles_map.get(duel.get("player1_id"), {})
            name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or p.get("email", "").split("@")[0] or ""
            duels_data.append({
                "id": duel["id"],
                "from_user_id": duel.get("player1_id"),
                "from_user_name": name,
                "from_user_avatar_id": p.get("avatar_id"),
                "from_user_avatar_color": p.get("avatar_color"),
                "exercise_title": "Exercice",
                "created_at": duel.get("created_at"),
            })

        return {"duels": duels_data}

    except Exception as e:
        logger.error(f"Error getting pending duels: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active")
async def get_active_duels(user: dict = Depends(verify_token)):
    """
    Active duels for the current user (lobby redirect check only).
    The real game state lives in the Colyseus room.
    """
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]

        result = supabase.table("duels")\
            .select("id, player1_id, player2_id, status, created_at")\
            .or_(f"player1_id.eq.{user_id},player2_id.eq.{user_id}")\
            .eq("status", "active")\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()

        return {"duels": result.data or []}

    except Exception as e:
        logger.error(f"Error getting active duels: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_duel_history(user: dict = Depends(verify_token)):
    """Finished duels history for current user. Declared before /{duel_id} to avoid route conflict."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]

        result = (
            supabase.table("duels")
            .select("id, player1_id, player2_id, player1_score, player2_score, winner_id, created_at, finished_at")
            .eq("status", "finished")
            .or_(f"player1_id.eq.{user_id},player2_id.eq.{user_id}")
            .order("finished_at", desc=True)
            .limit(50)
            .execute()
        )

        duels = result.data or []
        opponent_ids: List[str] = []
        for d in duels:
            opp = d["player2_id"] if d.get("player1_id") == user_id else d.get("player1_id")
            if opp:
                opponent_ids.append(opp)

        profiles_map = {}
        if opponent_ids:
            pr = supabase.table("profiles").select("id, first_name, last_name, email").in_("id", opponent_ids).execute()
            profiles_map = {p["id"]: p for p in (pr.data or [])}

        history_items = []
        for d in duels:
            is_p1 = d.get("player1_id") == user_id
            opponent_id = d.get("player2_id") if is_p1 else d.get("player1_id")
            my_score = (d.get("player1_score") or 0) if is_p1 else (d.get("player2_score") or 0)
            opponent_score = (d.get("player2_score") or 0) if is_p1 else (d.get("player1_score") or 0)

            p = profiles_map.get(opponent_id or "", {})
            name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or p.get("email", "").split("@")[0] or "Adversaire"

            result_label = "draw"
            if d.get("winner_id") == user_id:
                result_label = "win"
            elif d.get("winner_id") and d.get("winner_id") != user_id:
                result_label = "loss"

            history_items.append({
                "id": d.get("id"),
                "opponent_id": opponent_id,
                "opponent_name": name,
                "my_score": my_score,
                "opponent_score": opponent_score,
                "result": result_label,
                "created_at": d.get("created_at"),
                "finished_at": d.get("finished_at"),
            })

        return {"history": history_items}

    except Exception as e:
        logger.error(f"Error getting duel history: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
