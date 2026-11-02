from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import base64
import json
import pytest
from fastapi import HTTPException
from starlette.requests import Request

@pytest.mark.asyncio
async def test_http_only_cookie_still_requires_supabase_verification():
    from auth import verify_token
    from config import settings
    ref = settings.supabase_url.split('//')[1].split('.')[0]
    value = 'base64-' + base64.urlsafe_b64encode(json.dumps({'access_token': 'cookie-token'}).encode()).decode().rstrip('=')
    request = Request({'type': 'http', 'headers': [(b'cookie', f'sb-{ref}-auth-token={value}'.encode())]})
    client = MagicMock()
    client.auth.get_user.return_value = SimpleNamespace(user=SimpleNamespace(id='owner', email='synthetic@test.invalid'))
    with patch('auth._get_supabase_client', return_value=client):
        result = await verify_token(authorization=None, request=request)
    assert result['user_id'] == 'owner'
    client.auth.get_user.assert_called_once_with('cookie-token')

@pytest.mark.asyncio
async def test_ds_uses_the_server_receipt_instead_of_browser_points():
    from routers.ds import ds_submit
    from schemas import SubmitDSAnswerRequest
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = SimpleNamespace(data={'id': 'ds'})
    client.rpc.return_value.execute.return_value = SimpleNamespace(data={'message': 'Réponse enregistrée'})
    body = SubmitDSAnswerRequest(exercise_id='999', competence_ids=['forged'], is_correct=True, difficulty='Difficile', engine_session_id='10000000-0000-4000-8000-000000000001')
    with patch('routers.ds.get_supabase_client', return_value=client), patch('routers.ds.soumettre_reponse_ds') as legacy:
        await ds_submit('ds', body, {'user_id': 'owner'})
    legacy.assert_not_called()
    client.rpc.assert_called_once_with('engine_apply_ds_result', {'p_id': str(body.engine_session_id), 'p_owner': 'owner', 'p_ds': 'ds'})

def test_taxonomy_accepts_the_existing_admin_alias_column():
    from settings.competence_settings import _load_from_supabase
    from postgrest.exceptions import APIError
    client = MagicMock()
    chapters = client.table.return_value.select.return_value.order.return_value.execute
    chapters.side_effect = [APIError({'code': '42703', 'message': 'missing db_aliases'}), SimpleNamespace(data=[{'name': 'Chapter', 'aliases': ['Alias']}])]
    client.table.return_value.select.return_value.execute.return_value = SimpleNamespace(data=[])
    with patch('auth.get_supabase_client', return_value=client):
        result = _load_from_supabase()
    assert result['chapter_db_aliases'] == {'Chapter': ['Alias']}
