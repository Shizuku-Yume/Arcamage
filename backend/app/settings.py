"""Application settings and configuration."""

import os
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="ARCAMAGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    app_name: str = "Arcamage"
    app_version: str = "0.1.0"
    debug: bool = False

    # File upload limits
    max_upload_mb: int = 20

    # HTTP client settings
    http_timeout: int = 30

    # Trusted proxies for X-Forwarded-For handling
    trusted_proxies: List[str] = []  # e.g., ["127.0.0.1", "10.0.0.1"]

    # Logging
    log_level: str = "INFO"
    log_redact: bool = True

    @property
    def max_upload_bytes(self) -> int:
        """Maximum upload size in bytes."""
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
