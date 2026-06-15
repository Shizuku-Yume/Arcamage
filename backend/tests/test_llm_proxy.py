"""Controlled LLM proxy tests."""

from __future__ import annotations

import socket
from collections.abc import AsyncGenerator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.api_models import LlmModelsRequest, LlmProxyRequest, SupplierModel
from app.core.exceptions import TimeoutError, ValidationError
from app.core.llm_proxy import (
    build_auth_headers,
    encode_proxy_body,
    fetch_llm_models,
    filter_proxy_headers,
    format_error_event,
    normalize_llm_base_url,
    request_llm_proxy,
    stream_llm_proxy,
    validate_proxy_path,
)
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def proxy_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "provider": "openai-compatible",
        "api": "openai-completions",
        "base_url": "https://api.example.com",
        "api_key": "sk-test",
        "method": "POST",
        "path": "/v1/chat/completions",
        "headers": {},
        "body": {"model": "model-x", "messages": []},
        "stream": False,
    }
    payload.update(overrides)
    return payload


class TestLlmProxyValidation:
    def test_rejects_localhost_base_url(self, client: TestClient) -> None:
        response = client.post(
            "/api/llm/proxy",
            json=proxy_payload(base_url="http://localhost:11434"),
        )

        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    def test_rejects_private_ip_base_url(self, client: TestClient) -> None:
        response = client.post(
            "/api/llm/proxy",
            json=proxy_payload(base_url="http://192.168.1.10:8000"),
        )

        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    def test_rejects_link_local_metadata_base_url(self) -> None:
        with pytest.raises(ValidationError):
            normalize_llm_base_url("http://169.254.169.254/latest/meta-data")

    def test_rejects_hostname_resolving_to_private_ip(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def fake_getaddrinfo(
            _host: str,
            _port: object,
            type: int = 0,
        ) -> list[tuple[int, int, int, str, tuple[str, int]]]:
            assert type == socket.SOCK_STREAM
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.7", 443))]

        monkeypatch.setattr("app.core.llm_proxy.socket.getaddrinfo", fake_getaddrinfo)

        with pytest.raises(ValidationError):
            normalize_llm_base_url("https://provider.example.com")

    def test_rejects_full_url_path(self) -> None:
        with pytest.raises(ValidationError):
            validate_proxy_path("https://evil.example/v1/chat/completions")

    def test_rejects_disallowed_headers(self) -> None:
        with pytest.raises(ValidationError):
            filter_proxy_headers({"Authorization": "Bearer attacker"})

    def test_allows_mistral_affinity_header(self) -> None:
        assert filter_proxy_headers({"x-affinity": "session-1"}) == {
            "x-affinity": "session-1",
        }

    def test_rejects_oversized_body(self) -> None:
        with pytest.raises(ValidationError):
            encode_proxy_body({"prompt": "x" * 1_000_001})

    def test_uses_anthropic_api_key_headers(self) -> None:
        assert build_auth_headers("anthropic", "anthropic-messages", "sk-ant-test") == {
            "x-api-key": "sk-ant-test",
            "anthropic-version": "2023-06-01",
        }

    def test_uses_google_api_key_header(self) -> None:
        assert build_auth_headers("google", "google-generative-ai", "google-key") == {
            "x-goog-api-key": "google-key",
        }

    def test_uses_bearer_auth_for_mistral(self) -> None:
        assert build_auth_headers("mistral", "mistral-conversations", "mistral-key") == {
            "Authorization": "Bearer mistral-key",
        }


class TestLlmProxyRoutes:
    def test_non_stream_proxy_returns_upstream_json(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fake_request(payload: LlmProxyRequest) -> httpx.Response:
            assert payload.path == "/v1/chat/completions"
            return httpx.Response(200, json={"id": "chatcmpl-test"})

        monkeypatch.setattr("app.api.llm_proxy.request_llm_proxy", fake_request)

        response = client.post("/api/llm/proxy", json=proxy_payload())

        assert response.status_code == 200
        assert response.json() == {"id": "chatcmpl-test"}

    def test_non_stream_proxy_maps_upstream_error(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fake_request(_payload: LlmProxyRequest) -> httpx.Response:
            return httpx.Response(401, json={"error": {"message": "bad key"}})

        monkeypatch.setattr("app.api.llm_proxy.request_llm_proxy", fake_request)

        response = client.post("/api/llm/proxy", json=proxy_payload())

        assert response.status_code == 401
        assert response.json() == {
            "error": {
                "message": "bad key",
                "code": "UNAUTHORIZED",
            }
        }

    def test_stream_proxy_passes_chunks(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fake_stream(_payload: LlmProxyRequest) -> AsyncGenerator[bytes, None]:
            yield b"data: one\n\n"
            yield b"data: two\n\n"

        monkeypatch.setattr("app.api.llm_proxy.stream_llm_proxy", fake_stream)

        response = client.post("/api/llm/proxy", json=proxy_payload(stream=True))

        assert response.status_code == 200
        assert response.text == "data: one\n\ndata: two\n\n"

    def test_models_route_wraps_supplier_models(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def fake_models(_payload: object) -> list[SupplierModel]:
            return [SupplierModel(id="model-a"), SupplierModel(id="model-b")]

        monkeypatch.setattr("app.api.llm_proxy.fetch_llm_models", fake_models)

        response = client.post(
            "/api/llm/models",
            json={
                "provider": "openai-compatible",
                "api": "openai-completions",
                "base_url": "https://api.example.com",
                "api_key": "sk-test",
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "success": True,
            "data": {"models": [{"id": "model-a"}, {"id": "model-b"}]},
            "error": None,
            "error_code": None,
        }


class TestLlmProxyCoreErrors:
    @pytest.mark.asyncio
    async def test_stream_proxy_formats_upstream_error_event(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class FakeStreamResponse:
            status_code = 429
            headers: dict[str, str] = {}

            async def aread(self) -> bytes:
                return b'{"error":{"message":"slow down"}}'

        class FakeStreamContext:
            async def __aenter__(self) -> FakeStreamResponse:
                return FakeStreamResponse()

            async def __aexit__(
                self,
                _exc_type: object,
                _exc: object,
                _tb: object,
            ) -> None:
                return None

        class FakeAsyncClient:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def __aenter__(self) -> FakeAsyncClient:
                return self

            async def __aexit__(
                self,
                _exc_type: object,
                _exc: object,
                _tb: object,
            ) -> None:
                return None

            def stream(self, *_args: object, **_kwargs: object) -> FakeStreamContext:
                return FakeStreamContext()

        monkeypatch.setattr("app.core.llm_proxy.httpx.AsyncClient", FakeAsyncClient)

        payload = LlmProxyRequest(**proxy_payload(stream=True))
        chunks = [chunk async for chunk in stream_llm_proxy(payload)]

        assert chunks == [format_error_event("RATE_LIMITED", "slow down")]

    @pytest.mark.asyncio
    async def test_stream_proxy_maps_timeout_to_error_event(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class TimeoutStreamClient:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def __aenter__(self) -> TimeoutStreamClient:
                return self

            async def __aexit__(
                self,
                _exc_type: object,
                _exc: object,
                _tb: object,
            ) -> None:
                return None

            def stream(self, *_args: object, **_kwargs: object) -> object:
                raise httpx.TimeoutException("slow")

        monkeypatch.setattr("app.core.llm_proxy.httpx.AsyncClient", TimeoutStreamClient)

        payload = LlmProxyRequest(**proxy_payload(stream=True))
        chunks = [chunk async for chunk in stream_llm_proxy(payload)]

        assert chunks == [format_error_event("TIMEOUT", "Request timed out")]

    @pytest.mark.asyncio
    async def test_non_stream_proxy_maps_timeout_exception(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class TimeoutRequestClient:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def __aenter__(self) -> TimeoutRequestClient:
                return self

            async def __aexit__(
                self,
                _exc_type: object,
                _exc: object,
                _tb: object,
            ) -> None:
                return None

            async def request(self, *_args: object, **_kwargs: object) -> httpx.Response:
                raise httpx.TimeoutException("slow")

        monkeypatch.setattr("app.core.llm_proxy.httpx.AsyncClient", TimeoutRequestClient)

        payload = LlmProxyRequest(**proxy_payload())
        with pytest.raises(TimeoutError):
            await request_llm_proxy(payload)

    @pytest.mark.asyncio
    async def test_models_proxy_maps_timeout_exception(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class TimeoutModelsClient:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def __aenter__(self) -> TimeoutModelsClient:
                return self

            async def __aexit__(
                self,
                _exc_type: object,
                _exc: object,
                _tb: object,
            ) -> None:
                return None

            async def get(self, *_args: object, **_kwargs: object) -> httpx.Response:
                raise httpx.TimeoutException("slow")

        monkeypatch.setattr("app.core.llm_proxy.httpx.AsyncClient", TimeoutModelsClient)

        payload = LlmModelsRequest(
            provider="openai-compatible",
            api="openai-completions",
            base_url="https://api.example.com",
            api_key="sk-test",
        )
        with pytest.raises(TimeoutError):
            await fetch_llm_models(payload)
