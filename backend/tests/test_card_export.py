"""Tests for card_export module."""

import json
import hashlib

import pytest

from app.core.card_export import (
    CardExportError,
    export_to_png,
    generate_export_filename,
    verify_export,
)
from app.core.card_import import import_from_png
from app.core.card_models import CharacterCardData, CharacterCardV3
from app.core.png_chunks import extract_idat_chunks, get_card_data


class TestExportToPng:
    """Tests for PNG export."""

    def test_exports_v3_card(self, minimal_png_bytes):
        """V3 card is correctly embedded."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test Export",
                first_mes="Hello!",
            )
        )

        result = export_to_png(minimal_png_bytes, card)

        chunk_data = get_card_data(result)
        assert chunk_data is not None
        chunk_type, json_str = chunk_data
        assert chunk_type == "ccv3"

        parsed = json.loads(json_str)
        assert parsed["spec"] == "chara_card_v3"
        assert parsed["data"]["name"] == "Test Export"

    def test_preserves_idat_integrity(self, golden_files_dir):
        """IDAT chunks are preserved exactly."""
        png_data = (golden_files_dir / "plain_image.png").read_bytes()
        original_idat = extract_idat_chunks(png_data)
        original_hash = hashlib.md5(b"".join(original_idat)).hexdigest()

        card = CharacterCardV3(
            data=CharacterCardData(name="Test", first_mes="Hello")
        )
        result = export_to_png(png_data, card)

        result_idat = extract_idat_chunks(result)
        result_hash = hashlib.md5(b"".join(result_idat)).hexdigest()

        assert original_hash == result_hash, "IDAT integrity violated"

    def test_includes_v2_compat_by_default(self, minimal_png_bytes):
        """V2 chara chunk is included by default."""
        card = CharacterCardV3(
            data=CharacterCardData(name="Test")
        )

        result = export_to_png(minimal_png_bytes, card, include_v2_compat=True)

        from app.core.png_chunks import read_text_chunks
        chunks = read_text_chunks(result)
        assert chunks is not None
        assert "ccv3" in chunks
        assert "chara" in chunks

    def test_excludes_v2_when_disabled(self, minimal_png_bytes):
        """V2 chara chunk can be excluded."""
        card = CharacterCardV3(
            data=CharacterCardData(name="Test")
        )

        result = export_to_png(minimal_png_bytes, card, include_v2_compat=False)

        from app.core.png_chunks import read_text_chunks
        chunks = read_text_chunks(result)
        assert chunks is not None
        assert "ccv3" in chunks
        assert "chara" not in chunks

    def test_base64_no_newlines(self, minimal_png_bytes):
        """Base64 encoded data has no newlines."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                description="A" * 1000,
            )
        )

        result = export_to_png(minimal_png_bytes, card)

        from app.core.png_chunks import read_png_chunks
        chunks = read_png_chunks(result)
        for chunk_type, chunk_data in chunks:
            if chunk_type == "tEXt" and chunk_data.startswith(b"ccv3"):
                raw_base64 = chunk_data.split(b"\x00", 1)[1]
                assert b"\n" not in raw_base64, "Base64 contains newlines"
                break


class TestVerifyExport:
    """Tests for export verification."""

    def test_verify_successful(self, minimal_png_bytes):
        """Verification passes for valid export."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Verify Test",
                first_mes="Hello there!",
                description="A test character",
            )
        )

        result = export_to_png(minimal_png_bytes, card)
        ok, error = verify_export(result, card)

        assert ok is True
        assert error is None

    def test_verify_fails_on_corrupted(self, minimal_png_bytes):
        """Verification fails on corrupted export."""
        card = CharacterCardV3(
            data=CharacterCardData(name="Test")
        )

        corrupted = minimal_png_bytes[:50]
        ok, error = verify_export(corrupted, card)

        assert ok is False
        assert error is not None


class TestGenerateExportFilename:
    """Tests for filename generation."""

    def test_includes_character_name(self):
        """Filename includes character name."""
        card = CharacterCardV3(
            data=CharacterCardData(name="Alice")
        )

        filename = generate_export_filename(card)
        assert filename.startswith("Alice_")
        assert filename.endswith(".png")

    def test_sanitizes_special_characters(self):
        """Special characters are sanitized."""
        card = CharacterCardV3(
            data=CharacterCardData(name="Test<>:Card")
        )

        filename = generate_export_filename(card)
        assert "<" not in filename
        assert ">" not in filename
        assert ":" not in filename

    def test_truncates_long_names(self):
        """Long names are truncated."""
        card = CharacterCardV3(
            data=CharacterCardData(name="A" * 100)
        )

        filename = generate_export_filename(card)
        assert len(filename) < 100

    def test_handles_empty_name(self):
        """Empty name defaults to 'character'."""
        card = CharacterCardV3(
            data=CharacterCardData(name="")
        )

        filename = generate_export_filename(card)
        assert filename.startswith("character_")


class TestRoundTrip:
    """End-to-end import/export tests."""

    def test_full_roundtrip(self, golden_files_dir):
        """Card survives full import → export → import cycle."""
        original_png = (golden_files_dir / "v3_card.png").read_bytes()

        card1, fmt1, _ = import_from_png(original_png)

        plain_png = (golden_files_dir / "plain_image.png").read_bytes()
        exported = export_to_png(plain_png, card1, update_modification_date=False)

        card2, fmt2, _ = import_from_png(exported)

        assert card1.data.name == card2.data.name
        assert card1.data.first_mes == card2.data.first_mes
        assert card1.data.description == card2.data.description
        assert card1.data.tags == card2.data.tags

    def test_html_preserved_in_first_mes(self, golden_files_dir):
        """HTML in first_mes is preserved byte-for-byte."""
        html_greeting = '<div class="test"><b>Hello</b> <i>World</i></div>'
        card = CharacterCardV3(
            data=CharacterCardData(
                name="HTML Test",
                first_mes=html_greeting,
            )
        )

        plain_png = (golden_files_dir / "plain_image.png").read_bytes()
        exported = export_to_png(plain_png, card)

        reimported, _, _ = import_from_png(exported)
        assert reimported.data.first_mes == html_greeting
