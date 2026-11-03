"""
Endpoints de sante de l'API.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/")
async def root():
    """Endpoint racine de l'API"""
    return JSONResponse(
        content={
            "message": "Novlearn API with Duels System",
            "version": "0.2.0",
            "status": "running"
        }
    )


@router.get("/health")
async def health_check():
    """Endpoint de vérification de santé de l'API"""
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "Novlearn API"
        }
    )


@router.get("/api/health")
async def api_health_check():
    """Endpoint de vérification de santé de l'API (alias)"""
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "Novlearn API"
        }
    )
