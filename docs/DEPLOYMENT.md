# Arcamage 部署指南

本文档覆盖 Docker 生产部署、本地开发部署、环境变量、反向代理与运维建议。

---

## 1. 部署模式

| 模式 | 适用场景 | 入口 |
|------|----------|------|
| 预构建镜像 | 最快上线 | `docker run ...` |
| Docker Compose | 常规部署（推荐） | `docker compose -f docker/docker-compose.yml ...` |
| 本地开发 | 调试/二次开发 | 后端 `uvicorn` + 前端 `vite` |

---

## 2. Docker 部署（推荐）

### 2.1 预构建镜像

```bash
# Docker Hub
docker run -d -p 8000:8000 --name arcamage shizukuyume/arcamage:latest

# 或 GHCR
docker run -d -p 8000:8000 --name arcamage ghcr.io/shizuku-yume/arcamage:latest
```

验证：

```bash
curl http://localhost:8000/api/health
# 预期: {"status":"healthy"}
```

> 若镜像拉取失败（仓库未发布或权限受限），请改用 **2.2 Compose（源码构建）**。

### 2.2 Compose（源码构建）

```bash
git clone https://github.com/Shizuku-Yume/arcamage.git
cd arcamage

docker compose -f docker/docker-compose.yml --env-file docker/.env.production up -d --build
```

停止：

```bash
docker compose -f docker/docker-compose.yml down
```

### 2.3 单独构建镜像

```bash
docker build -t arcamage:latest -f docker/Dockerfile .
docker run -d --name arcamage -p 8000:8000 arcamage:latest
```

---

## 3. 本地开发部署

### 3.1 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### 3.2 前端

```bash
cd frontend
npm install
npm run dev
```

访问：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`

---

## 4. 环境变量

推荐从 `docker/.env.production` 或根目录 `.env.example` 复制后修改。

### 4.1 常用变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ARCAMAGE_DEBUG` | `false` | 调试模式 |
| `ARCAMAGE_MAX_UPLOAD_MB` | `20` | 上传限制（MB） |
| `ARCAMAGE_HTTP_TIMEOUT` | `30` | 上游 HTTP 超时（秒） |
| `ARCAMAGE_LOG_LEVEL` | `INFO` | 日志级别 |
| `ARCAMAGE_LOG_REDACT` | `true` | 日志脱敏（建议始终开启） |
| `ARCAMAGE_CORS_ORIGINS` | `*` | 允许来源（生产建议收敛） |
| `ARCAMAGE_PORT` | `8000` | Compose 对外端口 |

### 4.2 可选应用标识变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ARCAMAGE_APP_NAME` | `Arcamage` | 应用名（`/api/version` 输出） |
| `ARCAMAGE_APP_VERSION` | `0.1.0` | 应用版本（`/api/version` 输出） |

### 4.3 代理相关变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ARCAMAGE_TRUSTED_PROXIES` | `[]` | 信任代理列表（高级） |

---

## 5. 生产建议配置

### 5.1 使用自定义 `.env` 启动

```bash
cp docker/.env.production .env
# 编辑 .env
docker compose -f docker/docker-compose.yml --env-file .env up -d
```

### 5.2 Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name arcamage.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name arcamage.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 20M;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 5.3 Caddy 示例

```caddyfile
arcamage.example.com {
    reverse_proxy localhost:8000
    request_body {
        max_size 20MB
    }
}
```

---

## 6. 运维操作

### 6.1 健康检查

```bash
curl http://localhost:8000/api/health
```

### 6.2 查看日志

```bash
docker logs -f arcamage
docker logs --tail 200 arcamage
```

### 6.3 Compose 升级流程

```bash
git pull
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d
curl http://localhost:8000/api/health
```

---

## 7. 安全与资源建议

生产最小基线建议：

- 启用 HTTPS（反向代理层）
- `ARCAMAGE_LOG_REDACT=true`
- 收敛 `ARCAMAGE_CORS_ORIGINS`（避免长期 `*`）
- 与代理同步上传限制（Nginx `client_max_body_size` / Caddy `max_size`）

Compose 默认已启用：

- 非 root 运行
- 资源限制（CPU / 内存）
- `no-new-privileges`
- 日志轮转（json-file）

---

## 8. 故障排查

### 8.1 容器启动失败

- 查看日志：`docker logs arcamage`
- 常见原因：端口冲突、环境变量错误、镜像拉取失败

### 8.2 健康检查失败

- 确认服务监听 `8000`
- 手动请求 `curl http://localhost:8000/api/health`

### 8.3 上传失败

- 提高 `ARCAMAGE_MAX_UPLOAD_MB`
- 同步调大代理上传限制

### 8.4 页面可访问但 API 报错

- 检查反向代理是否转发 `/api/*`
- 检查 CORS 配置是否匹配部署域名

---

## 9. 备份建议

Arcamage 服务端不依赖持久化数据库，重点备份部署配置：

```bash
cp .env .env.backup
cp docker/docker-compose.yml docker/docker-compose.yml.backup
```

> 用户草稿主要存在浏览器本地存储（客户端），不在服务端容器内。
> Arcaferry 待取队列位于进程内存（`/api/import/remote/pending*`），服务重启后会清空。
