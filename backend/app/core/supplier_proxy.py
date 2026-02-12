"""Supplier proxy helpers (OpenAI-compatible)."""

from __future__ import annotations

from typing import List
from urllib.parse import urlparse

import httpx

from app.core.api_models import SupplierModel
from app.core.exceptions import (
    NetworkError,
    RateLimitedError,
    TimeoutError,
    UnauthorizedError,
    ValidationError,
)


def _normalize_base_url(base_url: str) -> str:
    if not base_url or not base_url.strip():
        raise ValidationError("API 地址不能为空")

    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.netloc:
        raise ValidationError("API 地址无效")

    host = parsed.hostname or ""
    if host.lower() in {"localhost", "127.0.0.1", "::1"}:
        raise ValidationError("API 地址不能为 localhost")

    return base_url.rstrip("/")


async def fetch_models(base_url: str, api_key: str) -> List[SupplierModel]:
    if not api_key or not api_key.strip():
        raise ValidationError("API Key 不能为空")

    normalized = _normalize_base_url(base_url)
    url = f"{normalized}/v1/models"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
    except httpx.TimeoutException as error:
        raise TimeoutError("Request timed out") from error
    except httpx.RequestError as error:
        raise NetworkError("Network request failed", {"error": str(error)}) from error

    if response.status_code == 401:
        raise UnauthorizedError("Unauthorized")
    if response.status_code == 429:
        raise RateLimitedError("Rate limit exceeded")
    if response.status_code >= 400:
        raise NetworkError(
            f"Upstream error: {response.status_code}",
            {"status_code": response.status_code},
        )

    try:
        payload = response.json()
    except ValueError as error:
        raise ValidationError("响应解析失败", {"error": str(error)}) from error

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []

    models: List[SupplierModel] = []
    for item in data:
        if isinstance(item, dict) and item.get("id"):
            models.append(SupplierModel(id=str(item["id"])))

    return models
