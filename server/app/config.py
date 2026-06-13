from functools import lru_cache
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://todolist:change-me@127.0.0.1:5432/todolist"
    app_timezone: str = "Asia/Shanghai"
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    environment: str = "development"
    auth_username: str = "admin"
    auth_password: str = "change-me"
    auth_display_name: str = "默认用户"
    auth_jwt_secret: str = "development-only-change-this-secret"
    auth_token_ttl_seconds: int = 7 * 24 * 60 * 60

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def validate_auth_settings(self) -> "Settings":
        if self.auth_token_ttl_seconds <= 0:
            raise ValueError("AUTH_TOKEN_TTL_SECONDS 必须大于 0")
        if self.environment.lower() == "production":
            if not self.auth_password or self.auth_password == "change-me":
                raise ValueError("生产环境必须配置安全的 AUTH_PASSWORD")
            if (
                len(self.auth_jwt_secret) < 32
                or self.auth_jwt_secret == "development-only-change-this-secret"
            ):
                raise ValueError("生产环境 AUTH_JWT_SECRET 至少需要 32 个字符")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
