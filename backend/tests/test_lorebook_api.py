"""Tests for lorebook API endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.card_models import CharacterCardV3, CharacterCardData, Lorebook, LorebookEntry


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def sample_card():
    """Create sample card without lorebook."""
    return CharacterCardV3(
        data=CharacterCardData(name="Test Character")
    )


@pytest.fixture
def sample_card_with_lorebook():
    """Create sample card with lorebook."""
    return CharacterCardV3(
        data=CharacterCardData(
            name="Test Character",
            character_book=Lorebook(
                name="Test Book",
                entries=[
                    LorebookEntry(
                        keys=["keyword1"],
                        content="Content 1",
                        id=1,
                        enabled=True,
                    ),
                    LorebookEntry(
                        keys=["keyword2"],
                        content="Content 2",
                        id=2,
                        enabled=True,
                    ),
                ],
            ),
        )
    )


@pytest.fixture
def sample_lorebook():
    """Create sample lorebook for import."""
    return Lorebook(
        name="Import Book",
        entries=[
            LorebookEntry(
                keys=["new_key"],
                content="New content",
                id=100,
                enabled=True,
            ),
        ],
    )


class TestLorebookExport:
    """Test lorebook export endpoint."""

    def test_export_from_card_with_lorebook(self, client, sample_card_with_lorebook):
        """Export lorebook from card that has one."""
        response = client.post(
            "/api/lorebook/export",
            json={"card": sample_card_with_lorebook.model_dump()},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["entry_count"] == 2
        assert data["data"]["lorebook"]["name"] == "Test Book"
        assert len(data["data"]["lorebook"]["entries"]) == 2

    def test_export_from_card_without_lorebook(self, client, sample_card):
        """Export from card without lorebook returns empty lorebook."""
        response = client.post(
            "/api/lorebook/export",
            json={"card": sample_card.model_dump()},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["entry_count"] == 0
        assert data["data"]["lorebook"]["entries"] == []

    def test_export_preserves_constant_entries(self, client):
        """Constant entries with empty keys are preserved."""
        card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                character_book=Lorebook(
                    name="Book",
                    entries=[
                        LorebookEntry(
                            keys=[],
                            content="Always active",
                            constant=True,
                            id=1,
                        ),
                    ],
                ),
            )
        )
        response = client.post(
            "/api/lorebook/export",
            json={"card": card.model_dump()},
        )
        assert response.status_code == 200
        data = response.json()
        entry = data["data"]["lorebook"]["entries"][0]
        assert entry["keys"] == []
        assert entry["constant"] is True
        assert entry["content"] == "Always active"


class TestLorebookImport:
    """Test lorebook import endpoint."""

    def test_import_replace_mode(self, client, sample_card, sample_lorebook):
        """Replace mode overwrites existing lorebook."""
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card.model_dump(),
                "lorebook": sample_lorebook.model_dump(),
                "merge_mode": "replace",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["entries_added"] == 1
        card_book = data["data"]["card"]["data"]["character_book"]
        assert card_book["name"] == "Import Book"
        assert len(card_book["entries"]) == 1

    def test_import_replace_overwrites_existing(self, client, sample_card_with_lorebook, sample_lorebook):
        """Replace mode replaces existing lorebook entirely."""
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card_with_lorebook.model_dump(),
                "lorebook": sample_lorebook.model_dump(),
                "merge_mode": "replace",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["entries_added"] == 1
        card_book = data["data"]["card"]["data"]["character_book"]
        assert len(card_book["entries"]) == 1
        assert card_book["entries"][0]["id"] == 100

    def test_import_merge_mode(self, client, sample_card_with_lorebook, sample_lorebook):
        """Merge mode appends new entries."""
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card_with_lorebook.model_dump(),
                "lorebook": sample_lorebook.model_dump(),
                "merge_mode": "merge",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["entries_added"] == 1
        card_book = data["data"]["card"]["data"]["character_book"]
        assert len(card_book["entries"]) == 3

    def test_import_merge_skips_duplicate_ids(self, client, sample_card_with_lorebook):
        """Merge mode skips entries with duplicate IDs."""
        duplicate_lorebook = Lorebook(
            name="Duplicate",
            entries=[
                LorebookEntry(
                    keys=["dup"],
                    content="Duplicate",
                    id=1,
                ),
            ],
        )
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card_with_lorebook.model_dump(),
                "lorebook": duplicate_lorebook.model_dump(),
                "merge_mode": "merge",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["entries_added"] == 0
        assert len(data["data"]["card"]["data"]["character_book"]["entries"]) == 2

    def test_import_skip_mode_no_existing(self, client, sample_card, sample_lorebook):
        """Skip mode imports when no existing lorebook."""
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card.model_dump(),
                "lorebook": sample_lorebook.model_dump(),
                "merge_mode": "skip",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["entries_added"] == 1

    def test_import_skip_mode_with_existing(self, client, sample_card_with_lorebook, sample_lorebook):
        """Skip mode keeps existing lorebook."""
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card_with_lorebook.model_dump(),
                "lorebook": sample_lorebook.model_dump(),
                "merge_mode": "skip",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["entries_added"] == 0
        assert len(data["data"]["card"]["data"]["character_book"]["entries"]) == 2

    def test_import_invalid_merge_mode(self, client, sample_card, sample_lorebook):
        """Invalid merge mode returns error."""
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": sample_card.model_dump(),
                "lorebook": sample_lorebook.model_dump(),
                "merge_mode": "invalid",
            },
        )
        assert response.status_code == 400

    def test_import_preserves_unknown_fields(self, client):
        """Unknown fields in entries are preserved."""
        card = CharacterCardV3(data=CharacterCardData(name="Test"))
        lorebook_dict = {
            "name": "Book",
            "entries": [
                {
                    "keys": ["test"],
                    "content": "Content",
                    "custom_field": "preserved_value",
                    "enabled": True,
                    "insertion_order": 0,
                    "use_regex": False,
                }
            ],
            "extensions": {},
        }
        response = client.post(
            "/api/lorebook/import",
            json={
                "card": card.model_dump(),
                "lorebook": lorebook_dict,
                "merge_mode": "replace",
            },
        )
        assert response.status_code == 200
        data = response.json()
        entry = data["data"]["card"]["data"]["character_book"]["entries"][0]
        assert entry.get("custom_field") == "preserved_value"


class TestConstantEntries:
    """Test constant=true with empty keys preservation."""

    def test_roundtrip_constant_entry(self, client):
        """Constant entries survive export-import roundtrip."""
        original_card = CharacterCardV3(
            data=CharacterCardData(
                name="Test",
                character_book=Lorebook(
                    name="World Book",
                    entries=[
                        LorebookEntry(
                            keys=[],
                            content="This entry is always active",
                            constant=True,
                            enabled=True,
                            id="const-1",
                        ),
                        LorebookEntry(
                            keys=["trigger"],
                            content="Normal entry",
                            constant=False,
                            enabled=True,
                            id="normal-1",
                        ),
                    ],
                ),
            )
        )

        export_resp = client.post(
            "/api/lorebook/export",
            json={"card": original_card.model_dump()},
        )
        assert export_resp.status_code == 200
        exported_book = export_resp.json()["data"]["lorebook"]

        new_card = CharacterCardV3(data=CharacterCardData(name="New Card"))
        import_resp = client.post(
            "/api/lorebook/import",
            json={
                "card": new_card.model_dump(),
                "lorebook": exported_book,
                "merge_mode": "replace",
            },
        )
        assert import_resp.status_code == 200
        imported_book = import_resp.json()["data"]["card"]["data"]["character_book"]

        const_entry = next(e for e in imported_book["entries"] if e["id"] == "const-1")
        assert const_entry["keys"] == []
        assert const_entry["constant"] is True
        assert const_entry["content"] == "This entry is always active"
