"""Legacy LLM route removal tests."""

from fastapi.testclient import TestClient

from app.main import app


def test_legacy_llm_routes_are_not_in_openapi() -> None:
    client = TestClient(app)

    schema = client.get("/openapi.json").json()

    assert "/api/proxy/chat" not in schema["paths"]
    assert "/api/suppliers/models" not in schema["paths"]
    assert "/api/suppliers/test-connection" not in schema["paths"]
    assert "/api/llm/proxy" in schema["paths"]
    assert "/api/llm/models" in schema["paths"]


def test_legacy_llm_routes_return_404() -> None:
    client = TestClient(app)

    assert client.post("/api/proxy/chat", json={}).status_code == 404
    assert client.post("/api/suppliers/models", json={}).status_code == 404
    assert client.post("/api/suppliers/test-connection", json={}).status_code == 404
