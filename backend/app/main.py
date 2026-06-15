"""Arcamage API - Main FastAPI application."""

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import cards, health, llm_proxy, lorebook, remote_import
from app.core.exceptions import ArcamageException
from app.middleware.exception_handlers import arcamage_exception_handler
from app.settings import get_settings

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
app.include_router(llm_proxy.router, prefix="/api")
app.include_router(remote_import.router, prefix="/api")


@app.get("/api")
async def api_root() -> dict[str, Any]:
    """API root endpoint with API information."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
    }


@app.api_route(
    "/api/{_full_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
async def api_not_found(_full_path: str) -> Response:
    """Return 404 for unknown API paths before the SPA fallback can claim them."""

    return Response(status_code=404)


# Mount static files (frontend build) if available
# This is used in production Docker deployment
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists() and static_dir.is_dir():

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
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
