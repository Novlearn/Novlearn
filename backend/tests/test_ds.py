"""
Tests pour ds.py (Devoirs Surveillés).

Couvre :
  - initialiser_scores_ds : pas d'insert si liste vide, défaut max_points=10
"""
from unittest.mock import MagicMock, call, patch
import pytest

from ds import initialiser_scores_ds


# ── initialiser_scores_ds ─────────────────────────────────────────────────────

class TestInitialiserScoresDs:

    def test_empty_competences_skips_all_db_calls(self):
        client = MagicMock()
        initialiser_scores_ds(client, "ds-1", [])
        client.table.assert_not_called()

    def test_calls_insert_for_each_competence(self):
        client = MagicMock()

        comp_resp = MagicMock()
        comp_resp.data = [
            {"id": "c1", "max_points": 10},
            {"id": "c2", "max_points": 20},
        ]
        # competences table → select → in_ → execute
        client.table.return_value.select.return_value.in_.return_value.execute.return_value = comp_resp
        # ds_competence_scores table → insert → execute
        client.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[])

        initialiser_scores_ds(client, "ds-1", ["c1", "c2"])

        # insert doit avoir été appelé au moins une fois
        assert client.table.return_value.insert.called

    def test_missing_competence_defaults_max_points_to_ten(self):
        client = MagicMock()
        comp_resp = MagicMock()
        comp_resp.data = []  # DB ne retourne rien
        client.table.return_value.select.return_value.in_.return_value.execute.return_value = comp_resp
        client.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[])

        # Ne doit pas lever d'exception
        initialiser_scores_ds(client, "ds-1", ["comp-inconnue"])
        assert client.table.return_value.insert.called

    def test_insert_rows_have_points_zero(self):
        client = MagicMock()
        inserted_rows = []

        comp_resp = MagicMock()
        comp_resp.data = [{"id": "c1", "max_points": 15}]
        client.table.return_value.select.return_value.in_.return_value.execute.return_value = comp_resp

        def capture_insert(rows):
            inserted_rows.extend(rows)
            m = MagicMock()
            m.execute.return_value = MagicMock(data=[])
            return m

        client.table.return_value.insert.side_effect = capture_insert

        initialiser_scores_ds(client, "ds-42", ["c1"])

        assert len(inserted_rows) == 1
        assert inserted_rows[0]["points"] == 0
        assert inserted_rows[0]["max_points"] == 15
        assert inserted_rows[0]["ds_id"] == "ds-42"
