"""
Recommandation d'exercices et test de positionnement par chapitre.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from auth import get_supabase_client, verify_token
from chapter_placement_test import (
    fetch_or_start_test,
    get_next_test_exercise,
    is_chapter_test_completed,
)
from chapter_selection import select_chapter_for_recommendation
from recommandation import recommander_exercice
from schemas import ChapterTestNextRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["recommendation"])


@router.get("/recommend-exercise")
async def recommend_exercise(
    user: dict = Depends(verify_token),
    chapter: Optional[str] = None,
):
    """
    Recommande un exercice pour l'utilisateur connecté.
    chapter (query, optionnel) : limiter au chapitre. Si absent, utilise l'algo de sélection.
    Retourne exercise_id, competences (array), difficulty_level, difficulty, mode (test|recommendation).
    Si l'utilisateur n'a pas passé le test de placement du chapitre, retourne un exo de test.
    """
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]

        # When no chapter specified (e.g. page principale /exercices), select one via algo
        effective_chapter = chapter
        if not effective_chapter or not effective_chapter.strip():
            effective_chapter = select_chapter_for_recommendation(supabase, user_id)
            if not effective_chapter:
                logger.warning(
                    "[API] recommend-exercise: no chapter available for user=%s",
                    user_id[:8],
                )
                raise HTTPException(
                    status_code=404,
                    detail="Aucun chapitre avec exercices disponible",
                )

        logger.info(
            "[API] recommend-exercise: request from user=%s chapter=%s (effective=%s)",
            user_id[:8],
            chapter or "all",
            effective_chapter,
        )

        # Try placement test first if not completed for this chapter
        try:
            result = fetch_or_start_test(supabase, user_id, effective_chapter)
            if result:
                result["mode"] = "test"
                logger.info(
                    "[API] recommend-exercise: serving chapter test for user=%s chapter=%s exercise_id=%s",
                    user_id[:8],
                    result.get("chapter", ""),
                    result.get("exercise_id"),
                )
                return JSONResponse(content=result)
        except Exception as test_error:
            logger.warning(
                "[API] recommend-exercise: test system unavailable for user=%s chapter=%s: %s. Falling back to normal recommendation.",
                user_id[:8],
                effective_chapter,
                str(test_error),
            )

        result = recommander_exercice(supabase, user_id, chapter=effective_chapter)
        if not result:
            logger.warning(
                "[API] recommend-exercise: no exercise found for user=%s chapter=%s",
                user_id[:8],
                chapter or "all",
            )
            raise HTTPException(status_code=404, detail="Aucun exercice recommandé")
        result["mode"] = "recommendation"
        logger.info(
            "[API] recommend-exercise: serving recommendation for user=%s chapter=%s exercise_id=%s competences=%s",
            user_id[:8],
            chapter or "all",
            result.get("exercise_id"),
            result.get("competences"),
        )
        # Ensure competences array is included in response
        competences_array = result.get("competences")
        if not competences_array or not isinstance(competences_array, list) or len(competences_array) == 0:
            logger.warning(
                "[API] recommend-exercise: WARNING - competences array is missing or empty for exercise_id=%s",
                result.get("exercise_id"),
            )
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("recommend_exercise error: %s", e)
        raise HTTPException(status_code=500, detail="Erreur lors de la recommandation")


@router.post("/chapter-test/next")
async def chapter_test_next(
    body: ChapterTestNextRequest,
    user: dict = Depends(verify_token),
):
    """
    Returns next exercise for chapter placement test after user completed one.
    Body: { chapter, last_success }.
    Returns next exercise or { completed: true } when test is done.
    """
    try:
        supabase = get_supabase_client()
        user_id = user["user_id"]
        result = get_next_test_exercise(
            supabase, user_id, body.chapter, body.last_success
        )
        if result is None:
            return JSONResponse(
                content={"completed": True, "chapter": body.chapter}
            )
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("chapter_test_next error: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Erreur lors de la récupération du prochain exercice de test",
        )


@router.get("/chapter-test/status")
async def chapter_test_status(
    user: dict = Depends(verify_token),
    chapter: Optional[str] = None,
):
    """
    Returns whether the user has completed the placement test for the chapter.
    """
    try:
        from chapter_placement_test import get_chapter_for_test
        supabase = get_supabase_client()
        user_id = user["user_id"]
        ch = get_chapter_for_test(chapter)
        completed = is_chapter_test_completed(supabase, user_id, ch)
        return JSONResponse(content={"completed": completed, "chapter": ch})
    except Exception as e:
        logger.exception("chapter_test_status error: %s", e)
        raise HTTPException(status_code=500, detail="Erreur lors de la vérification")
