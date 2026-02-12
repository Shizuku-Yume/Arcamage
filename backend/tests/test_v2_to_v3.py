"""Tests for v2_to_v3 migration module."""

import pytest

from app.core.v2_to_v3 import migrate_v2_to_v3, is_v2_format, migrate_lorebook


class TestIsV2Format:
    """Tests for V2 format detection."""

    def test_detects_v3_by_spec(self):
        """V3 cards have spec field."""
        data = {"spec": "chara_card_v3", "spec_version": "3.0", "data": {"name": "Test"}}
        assert not is_v2_format(data)

    def test_detects_v2_flat_structure(self):
        """V2 cards have flat structure with name."""
        data = {"name": "Test", "description": "A test"}
        assert is_v2_format(data)

    def test_detects_v2_with_data_wrapper(self):
        """Some V2 exports have data wrapper but no spec."""
        data = {"data": {"name": "Test"}}
        assert is_v2_format(data)


class TestMigrateV2ToV3:
    """Tests for V2 to V3 migration."""

    def test_migrates_basic_fields(self, v2_standard_json):
        """Basic fields are correctly migrated."""
        result = migrate_v2_to_v3(v2_standard_json)

        assert result.spec == "chara_card_v3"
        assert result.spec_version == "3.0"
        assert result.data.name == "TestChar V2"
        assert result.data.description == "A test character in V2 format."
        assert result.data.personality == "Friendly and helpful"
        assert result.data.first_mes == "Hello! I'm a V2 format character. Nice to meet you!"

    def test_migrates_tags(self, v2_standard_json):
        """Tags are preserved."""
        result = migrate_v2_to_v3(v2_standard_json)
        assert result.data.tags == ["v2", "test"]

    def test_migrates_alternate_greetings(self, v2_standard_json):
        """Alternate greetings are preserved."""
        result = migrate_v2_to_v3(v2_standard_json)
        assert len(result.data.alternate_greetings) == 1
        assert "Greetings!" in result.data.alternate_greetings[0]

    def test_adds_v3_defaults(self, v2_standard_json):
        """V3-only fields get default values."""
        result = migrate_v2_to_v3(v2_standard_json)
        assert result.data.group_only_greetings == []
        assert result.data.nickname is None

    def test_preserves_unknown_fields(self):
        """Unknown fields are preserved via extra='allow'."""
        data = {
            "name": "Test",
            "custom_field": "should be preserved",
            "another_unknown": 123,
        }
        result = migrate_v2_to_v3(data)

        result_dict = result.model_dump(mode="json")
        assert result_dict["data"].get("custom_field") == "should be preserved"
        assert result_dict["data"].get("another_unknown") == 123


class TestMigrateLorebook:
    """Tests for lorebook migration."""

    def test_migrates_entries(self):
        """Lorebook entries are correctly migrated."""
        v2_book = {
            "name": "Test Book",
            "entries": [
                {
                    "keys": ["test", "keyword"],
                    "content": "Test content",
                    "enabled": True,
                    "constant": True,
                }
            ],
        }
        result = migrate_lorebook(v2_book)

        assert result is not None
        assert result.name == "Test Book"
        assert len(result.entries) == 1
        assert result.entries[0].keys == ["test", "keyword"]
        assert result.entries[0].constant is True

    def test_handles_empty_keys_with_constant(self):
        """Constant entries can have empty keys."""
        v2_book = {
            "entries": [
                {
                    "keys": [],
                    "content": "Always active",
                    "constant": True,
                }
            ],
        }
        result = migrate_lorebook(v2_book)

        assert result is not None
        assert len(result.entries) == 1
        assert result.entries[0].keys == []
        assert result.entries[0].constant is True

    def test_returns_none_for_empty_book(self):
        """Returns None for None input."""
        assert migrate_lorebook(None) is None

    def test_preserves_unknown_entry_fields(self):
        """Unknown fields in entries are preserved."""
        v2_book = {
            "entries": [
                {
                    "keys": ["test"],
                    "content": "Test",
                    "custom_entry_field": "preserved",
                }
            ],
            "custom_book_field": "also preserved",
        }
        result = migrate_lorebook(v2_book)

        assert result is not None
        result_dict = result.model_dump(mode="json")
        assert result_dict.get("custom_book_field") == "also preserved"
        assert result_dict["entries"][0].get("custom_entry_field") == "preserved"

    def test_handles_legacy_object_format_entries(self):
        """Legacy object format entries are converted to array."""
        v2_book = {
            "name": "Legacy Book",
            "entries": {
                "0": {
                    "keys": ["first"],
                    "content": "First entry content",
                    "enabled": True,
                },
                "1": {
                    "keys": ["second"],
                    "content": "Second entry content",
                    "enabled": True,
                    "constant": True,
                },
            },
        }
        result = migrate_lorebook(v2_book)

        assert result is not None
        assert result.name == "Legacy Book"
        assert len(result.entries) == 2

        contents = {e.content for e in result.entries}
        assert "First entry content" in contents
        assert "Second entry content" in contents
