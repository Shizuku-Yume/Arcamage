"""Proxy chat endpoints (OpenAI-compatible)."""

from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.core.api_models import SupplierChatRequest
from app.core.exceptions import ValidationError
from app.core.supplier_proxy import _normalize_base_url

router = APIRouter()


def _format_error_event(code: str, message: str) -> bytes:
    payload = json.dumps({"code": code, "message": message}, ensure_ascii=False)
    return f"event: error\ndata: {payload}\n\n".encode("utf-8")


def _map_error_code(status_code: int) -> str:
    if status_code == 401:
        return "UNAUTHORIZED"
    if status_code == 429:
        return "RATE_LIMITED"
    if status_code == 400:
        return "VALIDATION_ERROR"
    return "UPSTREAM_ERROR"


async def _stream_chat(
    payload: SupplierChatRequest,
    base_url: str,
) -> AsyncGenerator[bytes, None]:
    url = f"{base_url}/v1/chat/completions"
    body = {
        "model": payload.model,
        "messages": payload.messages,
        "stream": True,
    }
    if payload.temperature is not None:
        body["temperature"] = payload.temperature
    if payload.tools is not None:
        body["tools"] = payload.tools
    if payload.tool_choice is not None:
        body["tool_choice"] = payload.tool_choice

    headers = {
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {payload.api_key}",
    }

    timeout = httpx.Timeout(60.0, connect=10.0, read=60.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code >= 400:
                    code = _map_error_code(response.status_code)
                    message = f"Upstream error ({response.status_code})"

                    raw = await response.aread()
                    if raw:
                        try:
                            parsed = json.loads(raw.decode("utf-8"))
                            if isinstance(parsed, dict):
                                message = parsed.get("error", {}).get(
                                    "message", parsed.get("message", message)
                                )
                        except ValueError:
                            text = raw.decode("utf-8", errors="ignore").strip()
                            if text:
                                message = text

                    yield _format_error_event(code, message)
                    return

                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
    except httpx.TimeoutException:
        yield _format_error_event("TIMEOUT", "Request timed out")
    except httpx.RequestError:
        yield _format_error_event("NETWORK_ERROR", "Network request failed")


async def _request_chat(payload: SupplierChatRequest, base_url: str) -> JSONResponse:
    url = f"{base_url}/v1/chat/completions"
    body = {
        "model": payload.model,
        "messages": payload.messages,
        "stream": False,
    }
    if payload.temperature is not None:
        body["temperature"] = payload.temperature
    if payload.tools is not None:
        body["tools"] = payload.tools
    if payload.tool_choice is not None:
        body["tool_choice"] = payload.tool_choice

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {payload.api_key}",
    }

    timeout = httpx.Timeout(60.0, connect=10.0, read=60.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=body)

    if response.status_code >= 400:
        code = _map_error_code(response.status_code)
        message = f"Upstream error ({response.status_code})"
        raw = response.text
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    message = parsed.get("error", {}).get("message", parsed.get("message", message))
            except ValueError:
                message = raw.strip() or message
        return JSONResponse(
            status_code=response.status_code,
            content={"error": {"message": message, "code": code}},
        )

    try:
        content = response.json()
    except ValueError:
        content = {"message": response.text}
    return JSONResponse(status_code=response.status_code, content=content)


@router.post("/proxy/chat")
async def proxy_chat(payload: SupplierChatRequest) -> Response:
    """Proxy chat completions via backend to avoid CORS."""

    if not payload.api_key or not payload.api_key.strip():
        raise ValidationError("API Key 不能为空")

    normalized = _normalize_base_url(payload.base_url)
    if payload.stream:
        return StreamingResponse(
            _stream_chat(payload, normalized),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    return await _request_chat(payload, normalized)
