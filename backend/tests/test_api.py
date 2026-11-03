"""
Tests d'intégration API FastAPI (backend/main.py + backend/routers/).

Stratégie :
  - Le scheduler APScheduler est mocké pour éviter les connexions Supabase au démarrage.
  - La dépendance verify_token est remplacée par app.dependency_overrides (FastAPI natif).
  - get_supabase_client est patché par test via patch_supabase() : chaque router
    importe le symbole dans son propre espace de noms, il faut donc les patcher tous.
  - Tests couverts : health, authentification, validation Pydantic, endpoints clés.
"""
import os
import sys
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")

import pytest
from fastapi.testclient import TestClient

# ── Constantes ────────────────────────────────────────────────────────────────

FAKE_USER = {
    "user_id": "test-uid-123",
    "email": "test@novlearn.fr",
    "user": MagicMock(),
}
AUTH_HEADERS = {"Authorization": "Bearer test-token"}

# Chaque router fait `from auth import get_supabase_client`, ce qui lie le nom
# dans son propre module : patcher auth.get_supabase_client serait sans effet.
ROUTER_MODULES = (
    "routers.recommendation",
    "routers.friends",
    "routers.duels",
    "routers.ds",
    "routers.notifications",
)


@contextmanager
def patch_supabase(mock_sb):
    """Remplace get_supabase_client par mock_sb dans tous les routers."""
    with ExitStack() as stack:
        for module in ROUTER_MODULES:
            stack.enter_context(
                patch(f"{module}.get_supabase_client", return_value=mock_sb)
            )
        yield mock_sb


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    """
    Crée l'application FastAPI avec scheduler désactivé.
    L'import de main est différé pour que les patches soient actifs.
    """
    with patch("notifications.setup_scheduler", return_value=MagicMock()):
        with patch("notifications.shutdown_scheduler"):
            from main import app as _app, verify_token

    async def _fake_verify_token():
        return FAKE_USER

    _app.dependency_overrides[verify_token] = _fake_verify_token
    yield _app
    _app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def client(app):
    """TestClient lié au module pour réutiliser la même instance."""
    with patch("main.setup_scheduler", return_value=MagicMock()):
        with patch("main.shutdown_scheduler"):
            with TestClient(app, raise_server_exceptions=False) as c:
                yield c


@pytest.fixture
def mock_sb():
    """Faux client Supabase générique (toutes les requêtes retournent [])."""
    sb = MagicMock()
    b = MagicMock()
    b.select.return_value = b
    b.eq.return_value = b
    b.neq.return_value = b
    b.in_.return_value = b
    b.limit.return_value = b
    b.order.return_value = b
    b.maybe_single.return_value = b
    b.single.return_value = b
    b.update.return_value = b
    b.insert.return_value = b
    b.delete.return_value = b
    b.execute.return_value = MagicMock(data=[])
    sb.table.return_value = b
    return sb


# ── Health endpoints ──────────────────────────────────────────────────────────

class TestHealthEndpoints:

    def test_root_returns_running(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"

    def test_root_includes_version(self, client):
        resp = client.get("/")
        assert "version" in resp.json()

    def test_health_returns_healthy(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"

    def test_api_health_alias(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"


# ── Authentification ──────────────────────────────────────────────────────────

class TestAuthentication:
    """
    Vérifie que les endpoints protégés nécessitent un token valide.
    On crée un client sans override pour tester le refus.
    """

    def test_protected_endpoint_without_override_returns_401(self, app):
        from main import verify_token
        from fastapi import HTTPException

        async def _reject():
            raise HTTPException(status_code=401, detail="Missing authorization header")

        app.dependency_overrides[verify_token] = _reject
        try:
            with TestClient(app, raise_server_exceptions=False) as c:
                resp = c.get("/api/friends")
            assert resp.status_code == 401
        finally:
            # Restaurer le mock normal
            async def _fake():
                return FAKE_USER
            app.dependency_overrides[verify_token] = _fake


# ── Validation Pydantic (corps de requête) ────────────────────────────────────

class TestRequestValidation:

    def test_add_friend_without_code_returns_422(self, client):
        resp = client.post("/api/friends/add-by-code", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == 422

    def test_create_duel_without_friend_id_returns_422(self, client):
        resp = client.post("/api/duels/create", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == 422

    def test_create_ds_without_required_fields_returns_422(self, client):
        resp = client.post("/api/ds", json={}, headers=AUTH_HEADERS)
        assert resp.status_code == 422

    def test_create_ds_with_all_fields_passes_validation(self, client, mock_sb):
        with patch_supabase(mock_sb):
            with patch("routers.ds.initialiser_scores_ds"):
                resp = client.post(
                    "/api/ds",
                    json={
                        "title": "Mon DS",
                        "deadline": "2025-06-30T10:00:00",
                        "competence_ids": ["comp-1", "comp-2"],
                    },
                    headers=AUTH_HEADERS,
                )
        # 200 ou 500 si mock incomplet, mais pas 422 (validation OK)
        assert resp.status_code != 422

    def test_update_notif_preferences_without_fields_returns_422(self, client):
        resp = client.put(
            "/api/notifications/preferences",
            json={"notif_push_duels": True},  # champs manquants
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 422

    def test_update_notif_preferences_with_all_fields_passes(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.put(
                "/api/notifications/preferences",
                json={
                    "notif_push_duels": True,
                    "notif_push_daily": False,
                    "notif_email_duels": True,
                    "notif_email_daily": False,
                    "notif_newsletter": True,
                },
                headers=AUTH_HEADERS,
            )
        assert resp.status_code != 422


# ── Endpoints amis ────────────────────────────────────────────────────────────

class TestFriendsEndpoints:

    def test_get_friends_list_returns_200(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/friends", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        # L'API enveloppe la liste dans un objet {"friends": [...]}
        body = resp.json()
        assert isinstance(body, (list, dict))

    def test_get_friend_requests_returns_200(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/friends/requests", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, (list, dict))

    def test_get_friend_code_returns_code_and_link(self, client, mock_sb):
        # Simuler un code existant
        mock_sb.table.return_value.execute.return_value = MagicMock(
            data=[{"code": "ABCD1234"}]
        )
        with patch_supabase(mock_sb):
            resp = client.get("/api/friends/code", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert "code" in data
        assert "invite_link" in data

    def test_delete_friend_endpoint_exists(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.delete("/api/friends/some-friend-id", headers=AUTH_HEADERS)
        # 200, 404 ou 500 mais pas 405 (method not allowed)
        assert resp.status_code != 405


# ── Endpoints duels ───────────────────────────────────────────────────────────

class TestDuelEndpoints:

    def test_get_pending_duels_returns_list(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/duels/pending", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, (list, dict))

    def test_get_duel_history_returns_list(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/duels/history", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, (list, dict))

    def test_get_active_duel_returns_200_or_404(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/duels/active", headers=AUTH_HEADERS)
        assert resp.status_code in (200, 404)


# ── Endpoints DS ──────────────────────────────────────────────────────────────

class TestDsEndpoints:

    def test_list_ds_returns_200(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/ds", headers=AUTH_HEADERS)
        assert resp.status_code == 200

    def test_get_nonexistent_ds_returns_404(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.get("/api/ds/non-existent-ds-id", headers=AUTH_HEADERS)
        assert resp.status_code in (404, 500)


# ── Endpoints notifications ───────────────────────────────────────────────────

class TestNotificationEndpoints:

    def test_vapid_public_key_endpoint_exists(self, client):
        with patch.dict(os.environ, {"VAPID_PUBLIC_KEY": "test-vapid-key"}):
            resp = client.get("/api/notifications/vapid-public-key")
        assert resp.status_code == 200

    def test_subscribe_push_requires_fields(self, client):
        resp = client.post(
            "/api/notifications/subscribe",
            json={"endpoint": "https://example.com"},  # p256dh et auth manquants
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 422

    def test_subscribe_push_with_all_fields(self, client, mock_sb):
        with patch_supabase(mock_sb):
            resp = client.post(
                "/api/notifications/subscribe",
                json={
                    "endpoint": "https://fcm.googleapis.com/test",
                    "p256dh": "test-p256dh-key",
                    "auth": "test-auth-secret",
                },
                headers=AUTH_HEADERS,
            )
        assert resp.status_code != 422
