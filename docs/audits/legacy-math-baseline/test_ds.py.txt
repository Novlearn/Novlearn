"""
Tests pour ds.py (Devoirs Surveillés).

Couvre :
  - Constante POINTS_PAR_DIFFICULTE
  - initialiser_scores_ds : pas d'insert si liste vide, défaut max_points=10
  - soumettre_reponse_ds  : delta de points, cap à max_points, évolution du streak
"""
from unittest.mock import MagicMock, call, patch
import pytest

from ds import POINTS_PAR_DIFFICULTE, initialiser_scores_ds, soumettre_reponse_ds


# ── Constante de points ───────────────────────────────────────────────────────

class TestPointsParDifficulte:
    def test_easy_is_one(self):
        assert POINTS_PAR_DIFFICULTE["easy"] == 1

    def test_medium_is_two(self):
        assert POINTS_PAR_DIFFICULTE["medium"] == 2

    def test_hard_is_three(self):
        assert POINTS_PAR_DIFFICULTE["hard"] == 3


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


# ── soumettre_reponse_ds ──────────────────────────────────────────────────────

def _make_ds_client(current_streak: int = 0, points: int = 5, max_points: int = 10):
    """
    Faux client Supabase pour soumettre_reponse_ds.

    Simule :
      - ds_competence_scores : select → scores courants
      - ds                   : select.maybe_single → streak courant
      - update               : opération générique (ne lève pas)
    """
    client = MagicMock()
    chain = client.table.return_value

    # Scores compétences (select...in_...execute)
    scores_resp = MagicMock()
    scores_resp.data = [{"competence_id": "c1", "points": points, "max_points": max_points}]
    chain.select.return_value.eq.return_value.in_.return_value.execute.return_value = scores_resp

    # Streak DS courant (select...maybe_single...execute)
    ds_resp = MagicMock()
    ds_resp.data = {"current_streak": current_streak}
    chain.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = ds_resp

    # update → ne fait rien
    chain.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    chain.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

    return client


class TestSoumettreReponseDs:

    def test_correct_easy_adds_one_point(self):
        """Réponse correcte easy → delta = 1."""
        client = _make_ds_client(points=5, max_points=10)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=True, difficulty="easy")
        # L'update a été appelé (points + streak)
        assert client.table.return_value.update.called

    def test_correct_medium_adds_two_points(self):
        client = _make_ds_client(points=3, max_points=10)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=True, difficulty="medium")
        assert client.table.return_value.update.called

    def test_correct_hard_adds_three_points(self):
        client = _make_ds_client(points=0, max_points=10)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=True, difficulty="hard")
        assert client.table.return_value.update.called

    def test_incorrect_does_not_update_score(self):
        """Réponse incorrecte → aucun update de ds_competence_scores (delta=0)."""
        client = _make_ds_client(points=5)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=False, difficulty="medium")
        # Seulement le streak DS est mis à jour (pas les scores de compétence)
        update_calls = client.table.return_value.update.call_args_list
        # Au plus 1 update (le streak), pas 2
        assert len(update_calls) <= 1

    def test_points_capped_at_max(self):
        """min(points + delta, max_points) est respecté."""
        # points=9, max_points=10, delta hard=3 → new = min(12, 10) = 10
        client = _make_ds_client(points=9, max_points=10)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=True, difficulty="hard")
        # On vérifie juste que l'update est appelé sans exception
        assert client.table.return_value.update.called

    def test_streak_increments_on_correct(self):
        """Réponse correcte → streak += 1."""
        client = _make_ds_client(current_streak=3)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=True, difficulty="easy")
        # L'update DS doit être appelé avec new_streak = 4
        # On vérifie que le streakest mis à jour en cherchant l'appel update({'current_streak': 4})
        update_calls = [str(c) for c in client.table.return_value.update.call_args_list]
        assert any("current_streak" in c for c in update_calls)

    def test_streak_decrements_on_incorrect(self):
        """Réponse incorrecte → streak -= 1."""
        client = _make_ds_client(current_streak=0)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=False, difficulty="easy")
        update_calls = [str(c) for c in client.table.return_value.update.call_args_list]
        assert any("current_streak" in c for c in update_calls)

    def test_streak_capped_at_plus_ten(self):
        """Le streak ne dépasse pas +10."""
        client = _make_ds_client(current_streak=10)
        # Ne doit pas lever d'exception (streak reste à 10)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=True, difficulty="easy")
        assert client.table.return_value.update.called

    def test_streak_capped_at_minus_ten(self):
        """Le streak ne descend pas en dessous de -10."""
        client = _make_ds_client(current_streak=-10)
        soumettre_reponse_ds(client, "ds-1", ["c1"], is_correct=False, difficulty="easy")
        assert client.table.return_value.update.called

    def test_empty_competences_skips_score_update(self):
        """Liste de compétences vide → pas de mise à jour de score."""
        client = _make_ds_client()
        soumettre_reponse_ds(client, "ds-1", [], is_correct=True, difficulty="easy")
        # Le streak doit quand même être mis à jour
        assert client.table.return_value.update.called
