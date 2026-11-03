import base64
import json
import pytest
from environment import validate_database_environment, STAGING_REF, PRODUCTION_REF


def key(ref, role="service_role"):
    payload = base64.urlsafe_b64encode(json.dumps({"ref": ref, "role": role}).encode()).decode().rstrip("=")
    return f"eyHeader.{payload}.signature"


@pytest.mark.parametrize("environment,ref", [("staging", STAGING_REF), ("production", PRODUCTION_REF)])
def test_matching_database(environment, ref):
    validate_database_environment(environment, f"https://{ref}.supabase.co", key(ref))


@pytest.mark.parametrize("environment,ref", [("staging", PRODUCTION_REF), ("production", STAGING_REF), ("development", PRODUCTION_REF)])
def test_cross_environment_database_is_refused(environment, ref):
    with pytest.raises(ValueError):
        validate_database_environment(environment, f"https://{ref}.supabase.co", key(ref))


def test_cross_environment_service_key_and_anon_key_are_refused():
    for value in (key(PRODUCTION_REF), key(STAGING_REF, "anon")):
        with pytest.raises(ValueError):
            validate_database_environment("staging", f"https://{STAGING_REF}.supabase.co", value)


def test_local_synthetic_database_remains_usable_for_tests():
    validate_database_environment("test", "http://127.0.0.1:1", "synthetic")
