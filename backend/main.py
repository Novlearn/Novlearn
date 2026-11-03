"""
API FastAPI pour Novlearn
Backend principal de l'application avec systeme de duels et amis.

Ce module ne contient que l'assemblage : creation de l'app, CORS, cycle de
vie et montage des routers. La logique de chaque domaine vit dans routers/.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import get_supabase_client, verify_token  # noqa: F401  (reexporte pour les tests)
from config import settings
from notifications import setup_scheduler, shutdown_scheduler
from routers import (
    ds,
    duels,
    friends,
    health,
    notifications,
    recommendation,
)

# Configuration du logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
# Reduce noise from HTTP clients and auth (Supabase/httpx, token verification)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("auth").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.scheduler = setup_scheduler(get_supabase_client)
    try:
        yield
    finally:
        shutdown_scheduler()


# Creation de l'application FastAPI
app = FastAPI(
    title="Novlearn API",
    description="API REST pour la plateforme Novlearn avec systeme de duels 1v1",
    version="0.2.0",
    lifespan=lifespan,
)

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(recommendation.router)
app.include_router(friends.router)
app.include_router(duels.router)
app.include_router(ds.router)
app.include_router(notifications.router)


if __name__ == "__main__":
    import uvicorn
    if settings.debug:
        uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
    else:
        uvicorn.run(app, host=settings.host, port=settings.port, reload=False)
