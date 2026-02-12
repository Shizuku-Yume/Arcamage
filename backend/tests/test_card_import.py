"""Tests for card_import module."""

import json

import pytest

from app.core.card_import import (
    CardImportError,
    detect_file_type,
    import_card,
    import_from_json,
    import_from_png,
)


class TestDetectFileType:
    """Tests for file type detection."""

    def test_detects_png(self, minimal_png_bytes):
        """PNG files are correctly detected."""
        assert detect_file_type(minimal_png_bytes) == "png"

    def test_detects_json_object(self):
        """JSON objects are detected."""
        data = b'{"name": "test"}'
        assert detect_file_type(data) == "json"

    def test_detects_json_array(self):
        """JSON arrays are detected."""
        data = b'[1, 2, 3]'
        assert detect_file_type(data) == "json"

    def test_detects_json_with_whitespace(self):
        """JSON with leading whitespace is detected."""
        data = b'   \n  {"name": "test"}'
        assert detect_file_type(data) == "json"

    def test_detects_jpeg(self):
        """JPEG files are detected as image."""
        data = b"\xff\xd8\xff\xe0\x00\x10JFIF"
        assert detect_file_type(data) == "image"

    def test_detects_webp(self):
        """WebP files are detected as image."""
        data = b"RIFF\x00\x00\x00\x00WEBP"
        assert detect_file_type(data) == "image"

    def test_detects_gif(self):
        """GIF files are detected as image."""
        data = b"GIF89a\x01\x00\x01\x00"
        assert detect_file_type(data) == "image"


class TestImportFromJson:
    """Tests for JSON import."""

    def test_imports_v3_json(self, v3_standard_json):
        """V3 JSON is imported correctly."""
        card, fmt = import_from_json(v3_standard_json)

        assert fmt == "v3"
        assert card.spec == "chara_card_v3"
        assert card.data.name == "TestChar"

    def test_imports_v2_json(self, v2_standard_json):
        """V2 JSON is migrated to V3."""
        card, fmt = import_from_json(v2_standard_json)

        assert fmt == "v2"
        assert card.spec == "chara_card_v3"
        assert card.data.name == "TestChar V2"

    def test_imports_json_string(self, v3_standard_json):
        """JSON string input works."""
        json_str = json.dumps(v3_standard_json)
        card, fmt = import_from_json(json_str)

        assert fmt == "v3"
        assert card.data.name == "TestChar"

    def test_imports_json_bytes(self, v3_standard_json):
        """JSON bytes input works."""
        json_bytes = json.dumps(v3_standard_json).encode("utf-8")
        card, fmt = import_from_json(json_bytes)

        assert fmt == "v3"
        assert card.data.name == "TestChar"

    def test_raises_on_invalid_json(self):
        """Invalid JSON raises error."""
        with pytest.raises(CardImportError) as exc_info:
            import_from_json("not valid json {")

        assert "Invalid JSON" in str(exc_info.value)

    def test_raises_on_missing_fields(self):
        """Missing required fields raises error."""
        with pytest.raises(CardImportError):
            import_from_json({"random": "data"})

    def test_preserves_unknown_fields(self):
        """Unknown fields are preserved."""
        data = {
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Test",
                "unknown_field": "should be kept",
            },
        }
        card, _ = import_from_json(data)

        result_dict = card.model_dump(mode="json")
        assert result_dict["data"].get("unknown_field") == "should be kept"


class TestImportFromPng:
    """Tests for PNG import."""

    def test_imports_v3_png(self, golden_files_dir):
        """V3 PNG with ccv3 chunk is imported."""
        png_data = (golden_files_dir / "v3_card.png").read_bytes()
        card, fmt, has_image = import_from_png(png_data)

        assert has_image is True
        assert card.spec == "chara_card_v3"
        assert card.data.name == "TestChar"

    def test_imports_v2_png(self, golden_files_dir):
        """V2 PNG with chara chunk is migrated to V3."""
        png_data = (golden_files_dir / "v2_card.png").read_bytes()
        card, fmt, has_image = import_from_png(png_data)

        assert has_image is True
        assert card.spec == "chara_card_v3"

    def test_dual_chunk_prefers_ccv3(self, golden_files_dir):
        """When both ccv3 and chara exist, ccv3 is preferred."""
        png_data = (golden_files_dir / "dual_chunk.png").read_bytes()
        card, fmt, has_image = import_from_png(png_data)

        assert card.spec == "chara_card_v3"

    def test_raises_on_plain_image(self, golden_files_dir):
        """Plain image without card data raises error."""
        png_data = (golden_files_dir / "plain_image.png").read_bytes()

        with pytest.raises(CardImportError) as exc_info:
            import_from_png(png_data)

        assert "no character card data" in str(exc_info.value).lower()

    def test_raises_on_invalid_png(self):
        """Invalid PNG data raises error."""
        with pytest.raises(CardImportError) as exc_info:
            import_from_png(b"not a png")

        assert "Invalid PNG" in str(exc_info.value) or "no character card" in str(exc_info.value).lower()


class TestImportCard:
    """Tests for unified import function."""

    def test_imports_png(self, golden_files_dir):
        """PNG files are imported."""
        png_data = (golden_files_dir / "v3_card.png").read_bytes()
        card, fmt, has_image = import_card(png_data)

        assert has_image is True
        assert card.data.name == "TestChar"

    def test_imports_json(self, v3_standard_json):
        """JSON data is imported."""
        json_bytes = json.dumps(v3_standard_json).encode()
        card, fmt, has_image = import_card(json_bytes)

        assert has_image is False
        assert card.data.name == "TestChar"
