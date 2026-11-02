"""
Helpers partagés pour les tests backend.
Séparé de conftest.py pour permettre l'import direct (from helpers import ...).
"""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

# ── PYTHONPATH ────────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Variables d'environnement minimales
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key-xxx")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
os.environ.setdefault("APP_ENV", "test")


class _QB:
    """
    Faux QueryBuilder Supabase implémentant le pattern builder.

    list_data  : données retournées par .execute() (mode liste)
    single_data: données retournées après .maybe_single()/.single()
                 Par défaut : premier élément de list_data, ou None.
    """

    def __init__(self, list_data, single_data=None):
        self._list_data = list_data if isinstance(list_data, list) else []
        self._single_data = single_data
        self._is_single = False
        self._limit = None

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def or_(self, filters):
        # Model the eligibility rule on synthetic rows, before any limit/single.
        assert filters == "catalog_id.is.null,active_version_id.not.is.null"
        def available(row):
            return row.get("catalog_id") is None or row.get("active_version_id") is not None
        self._list_data = [row for row in self._list_data if available(row)]
        if self._single_data and not available(self._single_data):
            self._single_data = None
        return self

    def limit(self, n, *a, **k):
        self._limit = int(n)
        return self

    def maybe_single(self):
        self._is_single = True
        return self

    def single(self):
        self._is_single = True
        return self

    def update(self, *a, **k): return self
    def insert(self, *a, **k): return self
    def delete(self, *a, **k): return self

    def execute(self):
        if self._is_single:
            data = self._single_data
            if data is None and self._list_data:
                data = self._list_data[0]
            return SimpleNamespace(data=data)
        data = self._list_data
        if self._limit is not None:
            data = data[: self._limit]
        return SimpleNamespace(data=data)


def make_supabase(**tables) -> MagicMock:
    """
    Crée un faux client Supabase.

    Paramètres (mot-clé = nom de table) :
        table_name = list_data            → mode liste ET single utilisent les mêmes données
        table_name = (list_data, single)  → données distinctes selon le mode d'accès

    Exemple :
        make_supabase(
            exercise_attempts=[{"exercise_id": 1, "is_correct": True, ...}],
            profiles=([], {"hidden_chapters": [], "current_streak": 3}),
        )
    """
    client = MagicMock()
    client.auth = MagicMock()

    def _table(name):
        cfg = tables.get(name, [])
        if isinstance(cfg, tuple) and len(cfg) == 2:
            list_data, single_data = cfg
        else:
            list_data, single_data = cfg, None
        return _QB(list_data, single_data)

    client.table.side_effect = _table
    return client
