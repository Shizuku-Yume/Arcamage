"""Health check endpoints."""

from fastapi import APIRouter

from app.settings import get_settings

router = APIRouter()
settings = get_settings()


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@router.get("/version")
async def version():
    """Version information endpoint."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
    }
