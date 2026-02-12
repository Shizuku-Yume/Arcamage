"""Tests for card_models.py - Pydantic model validation and field passthrough."""

import pytest

from app.core.card_models import (
    Asset,
    CharacterCardData,
    CharacterCardV3,
    Lorebook,
    LorebookEntry,
)


class TestLorebookEntry:
    """Test LorebookEntry model."""

    def test_minimal_entry(self):
        """Create entry with only required fields."""
        entry = LorebookEntry(keys=["test"], content="Test content")
        assert entry.keys == ["test"]
        assert entry.content == "Test content"
        assert entry.enabled is True
        assert entry.use_regex is False

    def test_constant_entry_empty_keys(self):
        """Constant entry can have empty keys."""
        entry = LorebookEntry(keys=[], content="Always active", constant=True)
        assert entry.keys == []
        assert entry.constant is True

    def test_unknown_fields_passthrough(self):
        """Unknown fields should be preserved (extra='allow')."""
        entry = LorebookEntry(
            keys=["test"],
            content="Test",
            custom_field="custom_value",
            another_unknown=123,
        )
        assert entry.model_extra["custom_field"] == "custom_value"
        assert entry.model_extra["another_unknown"] == 123


class TestLorebook:
    """Test Lorebook model."""

    def test_empty_lorebook(self):
        """Create empty lorebook."""
        book = Lorebook()
        assert book.name == ""
        assert book.entries == []

    def test_lorebook_with_entries(self):
        """Create lorebook with entries."""
        entry = LorebookEntry(keys=["key1"], content="content1")
        book = Lorebook(name="Test Book", entries=[entry])
        assert book.name == "Test Book"
        assert len(book.entries) == 1

    def test_unknown_fields_passthrough(self):
        """Unknown fields should be preserved."""
        book = Lorebook(
            name="Test",
            custom_extension="value",
        )
        assert book.model_extra["custom_extension"] == "value"


class TestCharacterCardV3:
    """Test CharacterCardV3 model."""

    def test_minimal_card(self):
        """Create card with only required fields."""
        card = CharacterCardV3(data=CharacterCardData(name="Test Character"))
        assert card.spec == "chara_card_v3"
        assert card.spec_version == "3.0"
        assert card.data.name == "Test Character"

    def test_full_card(self):
        """Create card with all fields."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test Character",
                description="A test character",
                first_mes="Hello!",
                personality="Friendly",
                scenario="Testing",
                tags=["test", "demo"],
                alternate_greetings=["Hi!", "Hey there!"],
                group_only_greetings=["Group hello!"],
            )
        )
        assert card.data.description == "A test character"
        assert len(card.data.alternate_greetings) == 2

    def test_unknown_fields_passthrough_data(self):
        """Unknown fields in data should be preserved."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                sillytavern_custom_field="preserved",
            )
        )
        assert card.data.model_extra["sillytavern_custom_field"] == "preserved"

    def test_unknown_fields_passthrough_root(self):
        """Unknown fields in root should be preserved."""
        card = CharacterCardV3(
            data=CharacterCardData(name="Test"),
            custom_root_field="preserved",
        )
        assert card.model_extra["custom_root_field"] == "preserved"

    def test_roundtrip_preserves_unknown_fields(self):
        """Export and re-import should preserve unknown fields."""
        original_dict = {
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Test",
                "description": "",
                "unknown_data_field": "data_value",
            },
            "unknown_root_field": "root_value",
        }

        card = CharacterCardV3.model_validate(original_dict)
        exported = card.model_dump()

        assert exported["unknown_root_field"] == "root_value"
        assert exported["data"]["unknown_data_field"] == "data_value"

    def test_html_content_preserved(self):
        """HTML in first_mes should be byte-level preserved."""
        html_content = '<div class="greeting"><b>Hello</b> <i>World</i>!</div>'
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                first_mes=html_content,
            )
        )
        assert card.data.first_mes == html_content
        exported = card.model_dump()
        assert exported["data"]["first_mes"] == html_content


class TestAsset:
    """Test Asset model."""

    def test_asset_creation(self):
        """Create asset."""
        asset = Asset(type="icon", uri="ccdefault:", name="main", ext="png")
        assert asset.type == "icon"
        assert asset.name == "main"

    def test_unknown_fields_passthrough(self):
        """Unknown fields should be preserved."""
        asset = Asset(
            type="icon",
            uri="ccdefault:",
            name="main",
            ext="png",
            custom_field="value",
        )
        assert asset.model_extra["custom_field"] == "value"
