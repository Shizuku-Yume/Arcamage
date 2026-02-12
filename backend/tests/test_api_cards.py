"""Tests for cards API endpoints."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def golden_files_dir():
    """Return golden files directory."""
    return Path(__file__).parent / "fixtures" / "golden_files"


class TestParseEndpoint:
    """Tests for POST /api/cards/parse."""

    def test_parse_v3_png(self, client, golden_files_dir):
        """Parse V3 PNG returns card data."""
        png_data = (golden_files_dir / "v3_card.png").read_bytes()

        response = client.post(
            "/api/cards/parse",
            files={"file": ("test.png", png_data, "image/png")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["card"]["spec"] == "chara_card_v3"
        assert data["data"]["has_image"] is True

    def test_parse_v2_png(self, client, golden_files_dir):
        """Parse V2 PNG migrates to V3."""
        png_data = (golden_files_dir / "v2_card.png").read_bytes()

        response = client.post(
            "/api/cards/parse",
            files={"file": ("test.png", png_data, "image/png")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["source_format"] == "v2"
        assert "migrated" in data["data"]["warnings"][0].lower()

    def test_parse_json_file(self, client, golden_files_dir):
        """Parse JSON file works."""
        json_data = (golden_files_dir / "v3_standard.json").read_text()

        response = client.post(
            "/api/cards/parse",
            files={"file": ("test.json", json_data.encode(), "application/json")},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["has_image"] is False

    def test_parse_plain_image_fails(self, client, golden_files_dir):
        """Plain image without card data returns error."""
        png_data = (golden_files_dir / "plain_image.png").read_bytes()

        response = client.post(
            "/api/cards/parse",
            files={"file": ("test.png", png_data, "image/png")},
        )

        assert response.status_code == 400
        data = response.json()
        assert "PARSE_ERROR" in str(data)

    def test_parse_invalid_json_fails(self, client):
        """Invalid JSON returns error."""
        response = client.post(
            "/api/cards/parse",
            files={"file": ("test.json", b"not valid json {", "application/json")},
        )

        assert response.status_code == 400


class TestInjectEndpoint:
    """Tests for POST /api/cards/inject."""

    def test_inject_card(self, client, golden_files_dir):
        """Inject card into PNG returns valid image."""
        png_data = (golden_files_dir / "plain_image.png").read_bytes()
        card_json = json.dumps({
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Injected",
                "first_mes": "Hello!",
            },
        })

        response = client.post(
            "/api/cards/inject",
            files={"file": ("test.png", png_data, "image/png")},
            data={
                "card_v3_json": card_json,
                "include_v2_compat": "true",
            },
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert b"PNG" in response.content[:10]

        parse_response = client.post(
            "/api/cards/parse",
            files={"file": ("result.png", response.content, "image/png")},
        )
        assert parse_response.status_code == 200
        parse_data = parse_response.json()
        assert parse_data["data"]["card"]["data"]["name"] == "Injected"

    def test_inject_invalid_json_fails(self, client, golden_files_dir):
        """Invalid JSON in card_v3_json fails."""
        png_data = (golden_files_dir / "plain_image.png").read_bytes()

        response = client.post(
            "/api/cards/inject",
            files={"file": ("test.png", png_data, "image/png")},
            data={"card_v3_json": "not valid json"},
        )

        assert response.status_code == 400

    def test_inject_sets_filename(self, client, golden_files_dir):
        """Response has content-disposition with filename."""
        png_data = (golden_files_dir / "plain_image.png").read_bytes()
        card_json = json.dumps({
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {"name": "TestName"},
        })

        response = client.post(
            "/api/cards/inject",
            files={"file": ("test.png", png_data, "image/png")},
            data={"card_v3_json": card_json},
        )

        assert response.status_code == 200
        disposition = response.headers.get("content-disposition", "")
        assert "TestName" in disposition
        assert ".png" in disposition


class TestValidateEndpoint:
    """Tests for POST /api/cards/validate."""

    def test_validate_valid_card(self, client):
        """Valid card passes validation."""
        response = client.post(
            "/api/cards/validate",
            json={
                "spec": "chara_card_v3",
                "spec_version": "3.0",
                "data": {
                    "name": "Valid Card",
                    "first_mes": "Hello!",
                    "description": "A valid card",
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["valid"] is True
        assert len(data["data"]["errors"]) == 0

    def test_validate_missing_name(self, client):
        """Missing name is an error."""
        response = client.post(
            "/api/cards/validate",
            json={
                "spec": "chara_card_v3",
                "spec_version": "3.0",
                "data": {
                    "name": "",
                    "first_mes": "Hello!",
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["valid"] is False
        assert any("name" in e.lower() for e in data["data"]["errors"])

    def test_validate_no_greetings_warning(self, client):
        """No greetings produces warning."""
        response = client.post(
            "/api/cards/validate",
            json={
                "spec": "chara_card_v3",
                "spec_version": "3.0",
                "data": {
                    "name": "Test",
                    "first_mes": "",
                    "alternate_greetings": [],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert any("greeting" in w.lower() for w in data["data"]["warnings"])

    def test_validate_high_token_warning(self, client):
        """High token count produces warning."""
        response = client.post(
            "/api/cards/validate",
            json={
                "spec": "chara_card_v3",
                "spec_version": "3.0",
                "data": {
                    "name": "Test",
                    "description": "A" * 40000,
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert any("token" in w.lower() for w in data["data"]["warnings"] + data["data"]["errors"])
