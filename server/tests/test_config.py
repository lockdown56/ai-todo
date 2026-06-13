import pytest
from pydantic import ValidationError

from app.config import Settings


def test_comma_separated_cors_origins(monkeypatch):
    monkeypatch.setenv(
        "CORS_ORIGINS",
        (
            "http://localhost:1420,http://127.0.0.1:1420,"
            "tauri://localhost,http://tauri.localhost,https://tauri.localhost"
        ),
    )
    settings = Settings()
    assert settings.cors_origins == [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]


def test_production_requires_secure_auth_settings():
    with pytest.raises(ValidationError):
        Settings(environment="production")

    settings = Settings(
        environment="production",
        auth_password="a-secure-password",
        auth_jwt_secret="a-secure-random-secret-with-more-than-32-characters",
    )
    assert settings.auth_username == "admin"
