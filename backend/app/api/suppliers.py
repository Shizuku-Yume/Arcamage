"""Supplier proxy endpoints (OpenAI-compatible)."""

from fastapi import APIRouter

from app.core.api_models import (
    ApiResponse,
    SupplierConnectionRequest,
    SupplierConnectionResult,
    SupplierModelsRequest,
    SupplierModelsResult,
)
from app.core.supplier_proxy import fetch_models

router = APIRouter()


@router.post("/suppliers/test-connection", response_model=ApiResponse[SupplierConnectionResult])
async def test_supplier_connection(payload: SupplierConnectionRequest):
    """Test supplier connection via models endpoint."""

    models = await fetch_models(payload.base_url, payload.api_key)
    result = SupplierConnectionResult(
        success=True,
        message="连接成功",
        models=models,
    )
    return ApiResponse(success=True, data=result)


@router.post("/suppliers/models", response_model=ApiResponse[SupplierModelsResult])
async def get_supplier_models(payload: SupplierModelsRequest):
    """Fetch supplier models list."""

    models = await fetch_models(payload.base_url, payload.api_key)
    return ApiResponse(success=True, data=SupplierModelsResult(models=models))
