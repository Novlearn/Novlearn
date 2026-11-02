"""Synthetic selection tests, not a Staging or Engine hosting qualification."""
import httpx
import pytest
from postgrest import SyncPostgrestClient

from helpers import make_supabase
from exercise_availability import available_exercises
from recommandation import _fallback_random_exercise, _get_exercise_result, recommander_exercice
from chapter_selection import _get_chapters_with_exercises
from chapter_placement_test import _get_first_test_exercise, _restore_test_exercise_from_state
from ds import recommander_exercice_ds


def exercise(canonical=False, active=False):
    return {"id": 9, "catalog_id": "canonical" if canonical else None,
            "active_version_id": "published" if active else None,
            "chapter": "Chapter", "difficulty": "easy", "competences": ["comp"]}


@pytest.mark.parametrize("canonical,active,expected", [(False, False, True), (True, False, False), (True, True, True)])
def test_all_server_selectors(monkeypatch, canonical, active, expected):
    monkeypatch.setattr("recommandation.get_competences", lambda **kw: {"comp": 10})
    monkeypatch.setattr("chapter_selection.CHAPTER_DB_ALIASES", {})
    sb = make_supabase(exercises=[exercise(canonical, active)],
                       profiles=([], {"current_streak": 0}),
                       ds_competence_scores=[{"competence_id": "comp", "points": 0, "max_points": 10}],
                       competences=[{"id": "comp", "name": "comp"}])
    paths = [
        lambda: _fallback_random_exercise(sb, None),
        lambda: _get_exercise_result(sb, 9, "comp", 0),
        lambda: recommander_exercice(sb, "synthetic"),
        lambda: recommander_exercice_ds(sb, "synthetic", ["comp"], 0),
        lambda: _get_first_test_exercise(sb, "synthetic", "Chapter", {"comp": [[9], [], []]}, [("comp", 10)]),
        lambda: _restore_test_exercise_from_state(sb, "synthetic", "Chapter", 0, 0,
                                                  {"comp": [[9], [], []]}, [("comp", 10)]),
    ]
    for path in paths:
        result = path()
        assert (result is not None) is expected
        if result:
            assert result["exercise_id"] == 9
    assert bool(_get_chapters_with_exercises(sb)) is expected


def test_real_postgrest_builder_preserves_chapter_difficulty_and_id():
    # Real installed Python builder, intercepted HTTP: no network or credentials.
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(200, json=[])
    with SyncPostgrestClient("http://127.0.0.1:1") as client:
        client.session.close()
        client.session = httpx.Client(base_url="http://127.0.0.1:1", transport=httpx.MockTransport(handle))
        available_exercises(client, "id").eq("chapter", "Chapter").eq("difficulty", "Facile").eq("id", 9).execute()
    params = requests[0].url.params
    assert params["or"] == "(catalog_id.is.null,active_version_id.not.is.null)"
    assert params["chapter"] == "eq.Chapter"
    assert params["difficulty"] == "eq.Facile"
    assert params["id"] == "eq.9"
