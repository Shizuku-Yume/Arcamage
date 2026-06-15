"""Controlled LLM proxy helpers."""

from __future__ import annotations

import ipaddress
import json
import socket
from collections.abc import AsyncGenerator
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from .api_models import LlmModelsRequest, LlmProxyRequest, SupplierModel
from .exceptions import NetworkError, TimeoutError, UnauthorizedError, ValidationError

MAX_PROXY_BODY_BYTES = 1_000_000
ALLOWED_METHODS = {"GET", "POST"}
ALLOWED_HEADER_NAMES = {
    "accept",
    "content-type",
    "anthropic-version",
    "anthropic-beta",
    "openai-beta",
    "http-referer",
    "x-title",
    "x-affinity",
}
BLOCKED_HOSTNAMES = {"localhost", "localhost.localdomain"}


def is_blocked_proxy_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def resolve_host_ips(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        results = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return []

    resolved: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for result in results:
        sockaddr = result[4]
        if not sockaddr:
            continue
        try:
            resolved.append(ipaddress.ip_address(str(sockaddr[0])))
        except ValueError:
            continue
    return resolved


def format_error_event(code: str, message: str) -> bytes:
    payload = json.dumps({"code": code, "message": message}, ensure_ascii=False)
    return f"event: error\ndata: {payload}\n\n".encode()


def map_upstream_error_code(status_code: int) -> str:
    if status_code == 401:
        return "UNAUTHORIZED"
    if status_code == 429:
        return "RATE_LIMITED"
    if status_code in {400, 422}:
        return "VALIDATION_ERROR"
    return "UPSTREAM_ERROR"


def normalize_llm_base_url(base_url: str) -> str:
    if not base_url or not base_url.strip():
        raise ValidationError("API 地址不能为空")

    parsed = urlparse(base_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError("API 地址无效")
    if parsed.username or parsed.password:
        raise ValidationError("API 地址不能包含认证信息")

    host = parsed.hostname or ""
    normalized_host = host.rstrip(".").lower()
    if normalized_host in BLOCKED_HOSTNAMES:
        raise ValidationError("API 地址不能为 localhost")

    try:
        ip = ipaddress.ip_address(normalized_host.strip("[]"))
    except ValueError:
        ip = None

    if ip and is_blocked_proxy_ip(ip):
        raise ValidationError("API 地址不能指向本地或内网地址")
    if not ip and any(is_blocked_proxy_ip(resolved_ip) for resolved_ip in resolve_host_ips(host)):
        raise ValidationError("API 地址不能解析到本地或内网地址")

    return base_url.strip().rstrip("/")


def validate_proxy_path(path: str) -> str:
    if not path or not path.startswith("/") or path.startswith("//"):
        raise ValidationError("代理路径必须以 / 开头")

    parsed = urlparse(path)
    if parsed.scheme or parsed.netloc:
        raise ValidationError("代理路径不能是完整 URL")
    return path


def validate_proxy_method(method: str) -> str:
    normalized = method.upper()
    if normalized not in ALLOWED_METHODS:
        raise ValidationError("代理方法仅支持 GET 或 POST")
    return normalized


def filter_proxy_headers(headers: dict[str, str] | None) -> dict[str, str]:
    filtered: dict[str, str] = {}
    for name, value in (headers or {}).items():
        normalized = name.strip().lower()
        if not normalized or "\r" in name or "\n" in name:
            raise ValidationError("请求头名称无效")
        if normalized not in ALLOWED_HEADER_NAMES:
            raise ValidationError(f"不允许透传请求头: {name}")
        if "\r" in value or "\n" in value:
            raise ValidationError("请求头值无效")
        filtered[name] = value
    return filtered


def encode_proxy_body(body: Any) -> bytes | None:
    if body is None:
        return None
    encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_PROXY_BODY_BYTES:
        raise ValidationError("请求体过大")
    return encoded


def build_proxy_url(base_url: str, path: str) -> str:
    return urljoin(f"{normalize_llm_base_url(base_url)}/", validate_proxy_path(path).lstrip("/"))


def build_auth_headers(provider: str, api: str, api_key: str) -> dict[str, str]:
    if not api_key or not api_key.strip():
        raise ValidationError("API Key 不能为空")
    if provider == "anthropic" or api == "anthropic-messages":
        return {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
    if provider == "google" or api == "google-generative-ai":
        return {"x-goog-api-key": api_key}
    return {"Authorization": f"Bearer {api_key}"}


def build_proxy_headers(payload: LlmProxyRequest | LlmModelsRequest, accept: str) -> dict[str, str]:
    headers = {
        "Accept": accept,
        **build_auth_headers(payload.provider, payload.api, payload.api_key),
    }
    passthrough = filter_proxy_headers(payload.headers)
    headers.update(passthrough)
    if isinstance(payload, LlmProxyRequest) and payload.method == "POST":
        headers.setdefault("Content-Type", "application/json")
    return headers


def parse_upstream_error(response: httpx.Response) -> str:
    message = f"Upstream error ({response.status_code})"
    if not response.content:
        return message
    try:
        parsed = response.json()
    except ValueError:
        return response.text.strip() or message
    if not isinstance(parsed, dict):
        return message
    error = parsed.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return str(error["message"])
    if isinstance(parsed.get("message"), str):
        return str(parsed["message"])
    return message


async def stream_llm_proxy(payload: LlmProxyRequest) -> AsyncGenerator[bytes, None]:
    method = validate_proxy_method(payload.method)
    url = build_proxy_url(payload.base_url, payload.path)
    body = encode_proxy_body(payload.body)
    headers = build_proxy_headers(payload, "text/event-stream")
    timeout = httpx.Timeout(60.0, connect=10.0, read=60.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                method,
                url,
                headers=headers,
                content=body if method == "POST" else None,
            ) as response:
                if response.status_code >= 400:
                    raw = await response.aread()
                    proxy_response = httpx.Response(
                        response.status_code,
                        headers=response.headers,
                        content=raw,
                    )
                    yield format_error_event(
                        map_upstream_error_code(response.status_code),
                        parse_upstream_error(proxy_response),
                    )
                    return

                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
    except httpx.TimeoutException:
        yield format_error_event("TIMEOUT", "Request timed out")
    except httpx.RequestError:
        yield format_error_event("NETWORK_ERROR", "Network request failed")


async def request_llm_proxy(payload: LlmProxyRequest) -> httpx.Response:
    method = validate_proxy_method(payload.method)
    url = build_proxy_url(payload.base_url, payload.path)
    body = encode_proxy_body(payload.body)
    headers = build_proxy_headers(payload, "application/json")
    timeout = httpx.Timeout(60.0, connect=10.0, read=60.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.request(
                method,
                url,
                headers=headers,
                content=body if method == "POST" else None,
            )
    except httpx.TimeoutException as error:
        raise TimeoutError("Request timed out") from error
    except httpx.RequestError as error:
        raise NetworkError("Network request failed", {"error": str(error)}) from error


async def fetch_llm_models(payload: LlmModelsRequest) -> list[SupplierModel]:
    url = build_proxy_url(payload.base_url, payload.path)
    headers = build_proxy_headers(payload, "application/json")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException as error:
        raise TimeoutError("Request timed out") from error
    except httpx.RequestError as error:
        raise NetworkError("Network request failed", {"error": str(error)}) from error

    if response.status_code == 401:
        raise UnauthorizedError("Unauthorized")
    if response.status_code >= 400:
        raise NetworkError(
            f"Upstream error: {response.status_code}",
            {"status_code": response.status_code},
        )

    try:
        data = response.json()
    except ValueError as error:
        raise ValidationError("响应解析失败", {"error": str(error)}) from error

    raw_models = data.get("data") if isinstance(data, dict) else None
    if not isinstance(raw_models, list):
        return []

    models: list[SupplierModel] = []
    for item in raw_models:
        if isinstance(item, dict) and item.get("id"):
            models.append(SupplierModel(id=str(item["id"])))
    return models


__all__ = [
    "format_error_event",
    "map_upstream_error_code",
    "normalize_llm_base_url",
    "is_blocked_proxy_ip",
    "resolve_host_ips",
    "validate_proxy_path",
    "validate_proxy_method",
    "filter_proxy_headers",
    "encode_proxy_body",
    "build_proxy_url",
    "stream_llm_proxy",
    "request_llm_proxy",
    "fetch_llm_models",
]
