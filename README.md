<div align="center">
  <img src="./frontend/public/icon_tarot.svg" alt="Arcamage Logo" width="120" height="120" />
  <h1>Arcamage</h1>
  <p>✨ SillyTavern 角色卡编辑工作台 | SillyTavern Character Card Workbench</p>

  <p>
    <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python" alt="Python"></a>
    <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=flat-square&logo=fastapi" alt="FastAPI"></a>
    <a href="https://alpinejs.dev/"><img src="https://img.shields.io/badge/Alpine.js-Frontend-8BC0D0?style=flat-square&logo=alpinedotjs" alt="Alpine.js"></a>
    <a href="https://vitejs.dev/"><img src="https://img.shields.io/badge/Vite-Build-646CFF?style=flat-square&logo=vite" alt="Vite"></a>
    <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS-UI-38B2AC?style=flat-square&logo=tailwind-css" alt="Tailwind CSS"></a>
  </p>
</div>

---

面向 **SillyTavern** 的角色卡编辑器，以 **CCv3** 规范为核心，提供结构化编辑、 AI 辅助改写等功能的一站式工作流。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.11+ · FastAPI · Pydantic v2 · Uvicorn |
| 前端 | Alpine.js · Vite · Tailwind CSS |
| 部署 | Docker 多阶段构建（Node 22 → Python 3.12-slim），单容器运行 |

---

## 核心功能

### 卡片编辑

在浏览器中完成角色卡的导入、编辑与导出，无需手动修改 JSON：

- **多入口导入**：上传 PNG / JSON、新建空白卡、从 [Arcaferry](https://github.com/Shizuku-Yume/Arcaferry) 远程拉取
- **分区编辑**：基础信息、描述、消息、系统设定、扩展字段按类别展示，逐字段修改
- **格式兼容**：支持 CCv3 / CCv2 导入，V2 自动迁移至 V3；导出可附带 V2 兼容块以适配旧版前端
- **编辑效率**：自动保存与草稿恢复、撤销 / 重做、文本清洗、实时 Token 估算
- **非破坏式导出**：PNG 导出基于 chunk 级写入，不接触像素数据，图像完整性不受影响

### 世界书（Lorebook）管理

独立的世界书编辑界面，支持可视化管理全部条目：

- 新增、复制、删除、拖拽排序
- 完整参数配置：触发词、二级触发词、常驻开关、插入优先级等
- 独立导入 / 导出为 JSON，支持替换与合并两种模式

### Arcaferry 远程导入

内置 [Arcaferry](https://github.com/Shizuku-Yume/Arcaferry) 导入工作流，可从远端服务拉取角色卡：

- 粘贴分享链接进行单卡抓取，或通过批量模式一次拉取多张
- 暂存区管理——预览、筛选后再决定导入
- 导入的卡片可一键送入工作台进行二次编辑

### Agent 模式

用自然语言与 AI 对话来编辑角色卡——描述意图，AI 执行修改：

- **对话式编辑**：描述修改目标，AI 自动定位并修改对应字段
- **Diff 预览**：每次修改以差异对比展示，确认后再应用
- **撤销与重试**：支持整轮应用、最近变更撤销、按条目粒度重试
- **预设与技能**：内置翻译、润色、扩写等预设；支持自定义 Markdown 技能的导入导出
- **参考资料**：可上传 txt / md / 图片作为 AI 的辅助上下文

---

## 快速开始

### 环境要求

- **Docker 部署**：Docker 20.10+（推荐）
- **本地开发**：Python 3.11+、Node.js 18+、npm 9+

### Docker Run（最简单）

```bash
# Docker Hub
docker run -d -p 8000:8000 --name arcamage shizukuyume/arcamage:latest

# 或使用 GHCR
docker run -d -p 8000:8000 --name arcamage ghcr.io/shizuku-yume/arcamage:latest
```

启动后访问 `http://localhost:8000` 即可使用。

### Docker Compose（推荐）

```bash
git clone https://github.com/Shizuku-Yume/arcamage.git
cd arcamage
docker compose -f docker/docker-compose.yml --env-file docker/.env.production up -d --build
```

停止服务：

```bash
docker compose -f docker/docker-compose.yml down
```

可通过 `docker/.env.production` 配置端口、上传大小限制、日志级别等参数。

### 本地开发

后端：

```bash
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

前端（另开终端）：

```bash
cd frontend
npm install
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端开发服务器 | `http://localhost:3000` |
| 后端 API | `http://localhost:8000` |

> 前端开发服务器已配置代理，`/api` 请求会自动转发到后端。

---

## 开发命令

后端（在 `backend/` 下执行）：

```bash
pytest -v              # 运行测试
ruff check .           # 代码检查
ruff format .          # 代码格式化
mypy app               # 类型检查
```

前端（在 `frontend/` 下执行）：

```bash
npx vitest run         # 运行测试
npm run lint           # 代码检查
npm run build          # 构建生产产物
```

---

## 项目结构

```
arcamage/
├── backend/           # FastAPI 后端：API 路由、CCv3 解析、PNG chunk 处理
│   ├── app/           # 应用代码（api/ core/ middleware/）
│   └── tests/         # pytest 测试套件 + golden file 基准
├── frontend/          # Alpine.js 前端：编辑器 UI、Agent 交互
│   └── src/           # 源码（components/ pages/ stores/ agent/）
└── docker/            # Dockerfile + Compose 配置
```

---

## 许可证

[MIT](LICENSE)


