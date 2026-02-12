"""Arcamage API - Main FastAPI application."""

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.settings import get_settings
from app.api import health
from app.api import cards
from app.api import lorebook
from app.api import remote_import
from app.api import suppliers
from app.api import proxy
from app.core.exceptions import ArcamageException
from app.middleware.exception_handlers import arcamage_exception_handler

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Arcamage - Character card parsing and editing",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Exception handlers
app.add_exception_handler(ArcamageException, arcamage_exception_handler)

# CORS middleware - configurable via environment
cors_origins = os.getenv("ARCAMAGE_CORS_ORIGINS", "*")
allow_origins = cors_origins.split(",") if cors_origins != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(cards.router, prefix="/api")
app.include_router(lorebook.router, prefix="/api")
app.include_router(remote_import.router, prefix="/api")
app.include_router(suppliers.router, prefix="/api")
app.include_router(proxy.router, prefix="/api")


@app.get("/api")
async def api_root():
    """API root endpoint with API information."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
    }


# Mount static files (frontend build) if available
# This is used in production Docker deployment
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists() and static_dir.is_dir():

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        """SPA fallback route - serves index.html for all non-API routes.

        This enables client-side routing in the SPA frontend.
        Deep links like /cards/edit/123 will return index.html,
        allowing the frontend router to handle the path.
        """
        if full_path.startswith("api/"):
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Not found")

        static_file = static_dir / full_path
        if static_file.exists() and static_file.is_file():
            return FileResponse(static_file)

        return FileResponse(static_dir / "index.html")
