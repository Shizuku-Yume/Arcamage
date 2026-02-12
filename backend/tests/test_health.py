"""Tests for health check endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


def test_health_check(client):
    """Test health check endpoint returns healthy status."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_version_endpoint(client):
    """Test version endpoint returns app info."""
    response = client.get("/api/version")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Arcamage"
    assert "version" in data


def test_root_endpoint(client):
    """Test root endpoint returns API info."""
    response = client.get("/api")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Arcamage"
    assert data["docs"] == "/docs"
