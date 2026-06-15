"""Controlled LLM proxy endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.core.api_models import ApiResponse, LlmModelsRequest, LlmProxyRequest, SupplierModelsResult
from app.core.llm_proxy import (
    fetch_llm_models,
    map_upstream_error_code,
    parse_upstream_error,
    request_llm_proxy,
    stream_llm_proxy,
)

router = APIRouter(prefix="/llm", tags=["llm"])


@router.post("/proxy")
async def proxy_llm(payload: LlmProxyRequest) -> Response:
    """Proxy a controlled LLM HTTP request."""

    if payload.stream:
        return StreamingResponse(
            stream_llm_proxy(payload),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    response = await request_llm_proxy(payload)
    media_type = response.headers.get("content-type", "application/json")
    if response.status_code >= 400:
        return JSONResponse(
            status_code=response.status_code,
            content={
                "error": {
                    "message": parse_upstream_error(response),
                    "code": map_upstream_error_code(response.status_code),
                }
            },
        )

    if "application/json" in media_type:
        try:
            return JSONResponse(status_code=response.status_code, content=response.json())
        except json.JSONDecodeError:
            pass

    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=media_type,
    )


@router.post("/models", response_model=ApiResponse[SupplierModelsResult])
async def get_llm_models(payload: LlmModelsRequest) -> ApiResponse[SupplierModelsResult]:
    """Fetch model IDs through the controlled LLM proxy."""

    models = await fetch_llm_models(payload)
    return ApiResponse(success=True, data=SupplierModelsResult(models=models))
