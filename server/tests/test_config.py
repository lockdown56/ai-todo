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
