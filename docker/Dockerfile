# syntax=docker/dockerfile:1.7
# Arcamage Multi-stage Dockerfile
# Stage 1: Frontend build
# Stage 2: Backend + Frontend static serving

# ============================================
# Stage 1: Build frontend assets
# ============================================
FROM node:22-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy package files first for layer caching
COPY frontend/package.json frontend/package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

# Copy frontend source
COPY frontend/ ./

# Build production assets
RUN npm run build

# ============================================
# Stage 2: Python backend with static files
# ============================================
FROM python:3.12-slim AS production

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ARCAMAGE_LOG_LEVEL=INFO \
    ARCAMAGE_LOG_REDACT=true

WORKDIR /app

# Install system dependencies (for Pillow with full image format support)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    libpng16-16 \
    libwebp7 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Copy backend source
COPY backend/app ./app

# Copy frontend build output from Stage 1
COPY --from=frontend-builder /build/frontend/dist ./static

# Create non-root user for security
RUN groupadd --system --gid 10001 arcamage \
    && useradd --system --uid 10001 --gid arcamage --create-home --home-dir /home/arcamage arcamage \
    && chown -R arcamage:arcamage /app

USER arcamage

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=5)" || exit 1

# Run uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
