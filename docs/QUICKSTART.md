# Arcamage 快速开始

> 目标：5~10 分钟内完成「启动服务 → 导入/新建卡片 → 编辑 → 导出」。

## 1. 你会得到什么

- 一个可用的 Web 角色卡编辑器（默认 `http://localhost:8000`）
- 可编辑 CCv3 卡片（支持 V2 自动迁移）
- PNG/JSON 导入导出、世界书编辑、自动保存、AI 辅助、Arcaferry 导入

---

## 2. 环境要求

| 场景 | 需要环境 |
|------|----------|
| Docker 运行（推荐） | Docker 24+、Docker Compose |
| 本地开发 | Python 3.11+、Node.js 20+、npm |

---

## 3. 方式 A：Docker 运行（推荐）

### A1. 使用预构建镜像（最快）

```bash
# Docker Hub
docker run -d -p 8000:8000 --name arcamage shizukuyume/arcamage:latest

# 或 GHCR
docker run -d -p 8000:8000 --name arcamage ghcr.io/shizuku-yume/arcamage:latest
```

验证服务：

```bash
curl http://localhost:8000/api/health
# 预期: {"status":"healthy"}
```

浏览器打开：`http://localhost:8000`

> 若镜像拉取失败（仓库未发布或权限受限），请改用 **A2 从源码构建并运行**。

### A2. 从源码构建并运行

```bash
git clone https://github.com/Shizuku-Yume/arcamage.git
cd arcamage

docker compose -f docker/docker-compose.yml --env-file docker/.env.production up -d --build
```

停止服务：

```bash
docker compose -f docker/docker-compose.yml down
```

---

## 4. 方式 B：本地开发模式

开发模式下：

- 前端：`http://localhost:3000`
- 后端 API：`http://localhost:8000`
- 前端通过 Vite 代理访问 `/api`

### B1. 启动后端

```bash
cd backend

# 创建并激活虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1

# 安装依赖（含开发工具）
pip install -e ".[dev]"

# 启动 API
uvicorn app.main:app --reload --port 8000
```

### B2. 启动前端（新开终端）

```bash
cd frontend
npm install
npm run dev
```

可选验证地址：

- Swagger：`http://localhost:8000/docs`
- ReDoc：`http://localhost:8000/redoc`

---

## 5. 第一次操作流程

1. 打开首页，选择：
   - 上传 PNG/JSON，或
   - 新建空白卡片，或
   - 通过 Arcaferry 导入。
2. 在工作台编辑基础字段、描述字段、开场白与世界书。
3. 点击导出：
   - **导出 PNG**（推荐）：写入 `ccv3`，可选同时写入 `chara`（V2 兼容）
   - **导出 JSON**：导出纯结构化卡片数据

---

## 6. 常见问题

### Q1：上传后提示解析失败

优先检查：

- 文件是否为合法角色卡 PNG 或 JSON
- 文件体积是否超出限制（默认 20MB）

### Q2：无法导出 PNG

导出 PNG 需要卡面图片。若当前是纯 JSON 导入，请先在工作台上传/替换 PNG 图片。

### Q3：本地开发出现跨域或接口失败

请确认：

- 后端在 `8000` 启动
- 前端在 `3000` 启动
- 通过 Vite 页面访问（而不是直接打开静态文件）

### Q4：前端上传格式为何只有 PNG/JSON？

这是前端入口的当前限制。后端 `POST /api/cards/parse` 仍支持将 JPG/WebP/GIF/BMP 等图片先转 PNG 再尝试解析卡片数据。

---

## 7. 下一步

- [用户手册](USER_GUIDE.md)：完整功能与操作说明
- [API 文档](API.md)：后端接口与请求示例
- [部署指南](DEPLOYMENT.md)：生产部署与运维建议
