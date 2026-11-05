"""
Configuration settings for Novlearn backend
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# Get the directory where this config.py file is located
BACKEND_DIR = Path(__file__).parent.resolve()
ENV_FILE = BACKEND_DIR / ".env"

# Load .env file from backend directory
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
    print(f"[Config] Loaded .env from: {ENV_FILE}")
else:
    # Try loading from current directory as fallback
    load_dotenv()
    print(f"[Config] .env not found at {ENV_FILE}, trying current directory")


def _get_cors_origins() -> list[str]:
    """
    Parse CORS origins from environment variable or return default values.
    Supports both comma-separated string and JSON array formats.
    """
    cors_env = os.getenv("CORS_ORIGINS", "")
    if cors_env:
        # Handle comma-separated format from deployment
        if not cors_env.startswith("["):
            return [origin.strip() for origin in cors_env.split(",") if origin.strip()]
        # Handle JSON format (if provided)
        import json
        try:
            return json.loads(cors_env)
        except json.JSONDecodeError:
            pass
    
    # Default values for local development
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://novlearn.fr",
        "https://www.novlearn.fr",
    ]


class Settings(BaseSettings):
    # API Settings
    app_env: str = os.getenv("APP_ENV", "development")
    debug: bool = os.getenv("DEBUG", "False") == "True"
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8010"))
    
    # Supabase Settings
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    
    model_config = SettingsConfigDict(env_file=str(ENV_FILE) if ENV_FILE.exists() else ".env", extra="ignore")


settings = Settings()
from environment import validate_database_environment
validate_database_environment(settings.app_env, settings.supabase_url, settings.supabase_service_key)

# Log configuration status
print(f"[Config] SUPABASE_URL: {'SET' if settings.supabase_url else 'NOT SET'}")
print(f"[Config] SUPABASE_SERVICE_KEY: {'SET' if settings.supabase_service_key else 'NOT SET'}")
if not settings.supabase_url or not settings.supabase_service_key:
    print(f"[Config] WARNING: Supabase credentials missing! Check {ENV_FILE}")

# Add cors_origins as a property outside BaseSettings to avoid parsing issues
# Use object.__setattr__ to bypass Pydantic's field validation
object.__setattr__(settings, "cors_origins", _get_cors_origins())
