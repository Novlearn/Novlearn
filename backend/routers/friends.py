"""
Gestion des amis : code d'invitation, demandes, liste, suppression.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from auth import get_supabase_client, verify_token
from schemas import AddFriendByCodeRequest, FriendCodeResponse
from utils import generate_unique_code

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/friends", tags=["friends"])


@router.get("/code")
async def get_friend_code(user: dict = Depends(verify_token)):
    """Get or generate friend code for current user"""
    try:
        logger.info(f"get_friend_code called for user: {user.get('user_id')}")
        supabase = get_supabase_client()
        user_id = user["user_id"]
        
        # Check if user already has a code
        logger.info(f"Checking for existing friend code for user: {user_id}")
        result = supabase.table("friend_codes").select("*").eq("user_id", user_id).execute()
        logger.info(f"Friend codes query result: {len(result.data) if result.data else 0} codes found")
        
        if result.data and len(result.data) > 0:
            code = result.data[0]["code"]
            logger.info(f"Using existing code: {code}")
        else:
            # Generate new code (should be handled by trigger, but fallback)
            code = generate_unique_code()
            logger.info(f"Generating new code: {code}")
            insert_result = supabase.table("friend_codes").insert({
                "user_id": user_id,
                "code": code
            }).execute()
            logger.info(f"Code inserted: {insert_result.data is not None if insert_result.data else False}")
        
        invite_link = f"https://novlearn.fr/invite/{code}"
        logger.info(f"Returning code and invite link for user: {user_id}")
        
        return FriendCodeResponse(code=code, invite_link=invite_link)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting friend code: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add-by-code")
async def add_friend_by_code(request: AddFriendByCodeRequest, user: dict = Depends(verify_token)):
    """Add friend using their invite code"""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        
        # Find user by code
        code_result = supabase.table("friend_codes").select("user_id").eq("code", request.code).execute()
        
        if not code_result.data or len(code_result.data) == 0:
            raise HTTPException(status_code=404, detail="Code d'ami invalide")
        
        friend_id = code_result.data[0]["user_id"]
        
        # Check if trying to add themselves
        if friend_id == user_id:
            raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous ajouter vous-même")
        
        # Check if already friends
        user1 = min(user_id, friend_id)
        user2 = max(user_id, friend_id)
        
        existing = supabase.table("friends").select("*").eq("user1_id", user1).eq("user2_id", user2).execute()
        
        if existing.data and len(existing.data) > 0:
            raise HTTPException(status_code=400, detail="Vous êtes déjà amis")
        
        # Check for existing request
        existing_request = supabase.table("friend_requests").select("*")\
            .eq("from_user_id", user_id)\
            .eq("to_user_id", friend_id)\
            .eq("status", "pending")\
            .execute()
        
        if existing_request.data and len(existing_request.data) > 0:
            raise HTTPException(status_code=400, detail="Demande d'ami déjà envoyée")
        
        # Create friend request
        supabase.table("friend_requests").insert({
            "from_user_id": user_id,
            "to_user_id": friend_id,
            "status": "pending"
        }).execute()
        
        return {"message": "Demande d'ami envoyée avec succès"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding friend: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def get_friends(user: dict = Depends(verify_token)):
    """Get list of friends for current user"""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        logger.info("[API /api/friends] user_id=%s", user_id[:8] if user_id else None)

        # Get friendships where user is either user1 or user2
        friends_data = []
        friend_ids = []

        # Query as user1 - get user2_ids
        result1 = supabase.table("friends")\
            .select("user2_id")\
            .eq("user1_id", user_id)\
            .eq("status", "accepted")\
            .execute()
        logger.info("[API /api/friends] as user1: rows=%s", len(result1.data or []))

        for friend in result1.data or []:
            friend_ids.append(friend["user2_id"])

        # Query as user2 - get user1_ids
        result2 = supabase.table("friends")\
            .select("user1_id")\
            .eq("user2_id", user_id)\
            .eq("status", "accepted")\
            .execute()
        logger.info("[API /api/friends] as user2: rows=%s", len(result2.data or []))

        for friend in result2.data or []:
            friend_ids.append(friend["user1_id"])

        logger.info("[API /api/friends] friend_ids count=%s ids=%s", len(friend_ids), friend_ids[:5] if friend_ids else [])
        
        # Get profiles for all friend IDs — public fields only (no email, no birth_date)
        if friend_ids:
            profiles_result = supabase.table("profiles")\
                .select("id, first_name, last_name, created_at, avatar_id, avatar_color")\
                .in_("id", friend_ids)\
                .execute()
            
            # Create a map of user_id -> profile
            profiles_map = {p["id"]: p for p in (profiles_result.data or [])}

            # Compute exercises completed (distinct exercise_id) for all friends
            attempts_result = supabase.table("exercise_attempts")\
                .select("user_id, exercise_id")\
                .in_("user_id", friend_ids)\
                .execute()

            exercises_completed_map: dict[str, set] = {}
            for row in (attempts_result.data or []):
                uid = row.get("user_id")
                eid = row.get("exercise_id")
                if not uid or eid is None:
                    continue
                exercises_completed_map.setdefault(uid, set()).add(eid)
            
            # Build friends data
            for friend_id in friend_ids:
                profile = profiles_map.get(friend_id, {})
                first_name = profile.get("first_name", "")
                last_name = profile.get("last_name", "")
                name = f"{first_name}.{last_name[0].upper()}" if last_name else (first_name or "Utilisateur")
                created_at = profile.get("created_at")
                exercises_completed = len(exercises_completed_map.get(friend_id, set()))
                
                friends_data.append({
                    "id": friend_id,
                    "first_name": first_name,
                    "last_name": last_name,
                    "name": name,
                    "created_at": created_at,
                    "exercises_completed": exercises_completed,
                    "avatar_id": profile.get("avatar_id", "fox"),
                    "avatar_color": profile.get("avatar_color", "#6366f1"),
                })

        logger.info("[API /api/friends] response friends count=%s", len(friends_data))
        return {"friends": friends_data}

    except Exception as e:
        logger.error(f"Error getting friends: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{friend_id}")
async def remove_friend(friend_id: str, user: dict = Depends(verify_token)):
    """Remove a friend (delete the friendship)."""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        if friend_id == user_id:
            raise HTTPException(status_code=400, detail="Cannot remove yourself")
        user1 = min(user_id, friend_id)
        user2 = max(user_id, friend_id)
        supabase.table("friends").delete().eq("user1_id", user1).eq("user2_id", user2).execute()
        return {"message": "Friend removed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing friend: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/requests")
async def get_friend_requests(user: dict = Depends(verify_token)):
    """Get pending friend requests for current user"""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        
        # Get requests where user is the recipient
        result = supabase.table("friend_requests")\
            .select("id, from_user_id, created_at")\
            .eq("to_user_id", user_id)\
            .eq("status", "pending")\
            .execute()
        
        requests_data = []
        from_user_ids = []
        
        # Collect request IDs and from_user_ids
        for req in result.data or []:
            from_user_ids.append(req["from_user_id"])
        
        # Get profiles for all from_user_ids
        if from_user_ids:
            profiles_result = supabase.table("profiles")\
                .select("id, first_name, last_name, email")\
                .in_("id", from_user_ids)\
                .execute()
            
            # Create a map of user_id -> profile
            profiles_map = {p["id"]: p for p in (profiles_result.data or [])}
            
            # Build requests data
            for req in result.data or []:
                from_user_id = req["from_user_id"]
                profile = profiles_map.get(from_user_id, {})
                email = profile.get("email", "")
                first_name = profile.get("first_name", "")
                last_name = profile.get("last_name", "")
                from_user_name = f"{first_name}.{last_name[0].upper()}" if last_name else first_name
                
                requests_data.append({
                    "id": req.get("id"),
                    "from_user_id": from_user_id,
                    "from_user_name": from_user_name,
                    "created_at": req.get("created_at")
                })
        
        return {"requests": requests_data}
    
    except Exception as e:
        logger.error(f"Error getting friend requests: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/requests/{request_id}/accept")
async def accept_friend_request(request_id: int, user: dict = Depends(verify_token)):
    """Accept a friend request"""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        
        # Update request status (trigger will handle creating friendship)
        result = supabase.table("friend_requests")\
            .update({"status": "accepted", "updated_at": datetime.utcnow().isoformat()})\
            .eq("id", request_id)\
            .eq("to_user_id", user_id)\
            .execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Demande d'ami introuvable")
        
        return {"message": "Demande d'ami acceptée"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error accepting friend request: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/requests/{request_id}/decline")
async def decline_friend_request(request_id: int, user: dict = Depends(verify_token)):
    """Decline a friend request"""
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        
        result = supabase.table("friend_requests")\
            .update({"status": "declined", "updated_at": datetime.utcnow().isoformat()})\
            .eq("id", request_id)\
            .eq("to_user_id", user_id)\
            .execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="Demande d'ami introuvable")
        
        return {"message": "Demande d'ami refusée"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error declining friend request: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
