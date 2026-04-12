# Open-Jarvis

[![License: MIT][license-badge]][license-url]

[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT

基于 [deepagents](https://github.com/langchain-ai/deepagentsjs) 的 **Electron 桌面客户端**：在本地工作区内与智能体对话，支持文件系统工具、子代理、人机协同审批（HITL）以及可配置的 Skills。界面中助手品牌为 **Jarvis**。

> 本项目由 [openwork](https://github.com/langchain-ai/openwork) 一脉演进；包名与二进制入口见 `package.json` 的 `bin`。

> [!CAUTION]
> 智能体可访问你选定的工作区文件并执行 shell 命令。请在信任的工作区内使用，并在批准工具调用前仔细核对。

## 功能概览

- **会话与历史**：多会话、侧栏管理；新建会话可继承当前会话的**模型**与**工作区路径**（写入线程 metadata）；会话与检查点持久化（sql.js）。
- **工作区**：按会话绑定本地文件夹；树形 / 列表视图（可调整列宽，时间列含年份）；`@` 引用工作区路径；文件变更监听。
- **模型**：Anthropic / OpenAI / Google 等；API Key 与 OpenAI 兼容配置存于本地；默认模型可切换。
- **Agent 运行时**：主进程内 `createDeepAgent` + LangGraph；`LocalSandbox` 扩展文件读写（含 **UTF-8 / GB18030** 文本解码，避免中文乱码）与命令执行。
- **Skills**：`.deepagents/skills` 目录列表、导入、创建（含 Markdown）、编辑 `SKILL.md`、重命名与删除（带确认）。
- **对话 UI**：流式 Markdown、工具调用卡片、待办、上下文用量；单条气泡与整会话 **导出 Markdown**；`@` 补全在深色模式下有高对比选中态。
- **文件预览**：代码使用 **Shiki**（多语言含 MATLAB `.m` 等）；大 **CSV/TSV** 为纯文本截断预览以防卡顿；**PDF** 内嵌预览占满中间栏可用区域。

## 环境要求

- [Bun](https://bun.sh)（推荐 **1.3+**，与 `package.json` 中 `packageManager` 一致）
- Node.js **18+**（Electron / 工具链兼容所需）

## 从源码运行

```bash
git clone <your-repo-url> open-jarvis
cd open-jarvis
bun install
bun run dev
```

其他常用命令：

| 命令 | 说明 |
|------|------|
| `bun run dev` | electron-vite 开发模式（热更新） |
| `bun run build` | 类型检查 + 打包到 `out/` |
| `bun run start` | 预览已构建产物 |
| `bun run typecheck` | 主进程 + 渲染进程 TypeScript 检查 |
| `bun run lint` | ESLint |

## 项目结构（精简）

```
src/
  main/                 # Electron 主进程
    index.ts            # 窗口、IPC 注册、数据库初始化
    agent/              # DeepAgent 运行时、LocalSandbox、system prompt
    ipc/                # agent / threads / models+workspace / skills
    db.ts, storage.ts   # 会话与密钥等持久化
    text-encoding.ts    # 文本文件解码（UTF-8 与 GB18030 回退）
  preload/              # contextBridge → window.api
  renderer/src/         # React 19 + Tailwind 4
    App.tsx             # 三栏布局（侧栏与标题栏/标签行对齐）、看板总览
    components/         # 聊天、侧栏、右侧面板、看板等
    lib/                # store、thread-context、shiki-highlighter、chat-markdown 等
electron.vite.config.ts # main / preload / renderer 构建
AGENTS.md               # 给 AI / 协作者的架构与修改入口说明
```

## 架构要点

- **IPC**：`agent:*`、`threads:*`、`models:*`、`workspace:*`、`skills:*` 等在 [`src/main`](src/main) 注册，[`src/preload`](src/preload) 暴露给渲染进程。
- **流式对话**：渲染进程通过 LangGraph SDK 订阅流事件；主进程执行 `agent:invoke` / `agent:resume` / `agent:interrupt` 等。
- **工作区路径**：保存在线程 metadata 中；工具侧使用**绝对路径**（见 `runtime.ts` 中的 system prompt）。

## 命令行入口（可选）

`package.json` 中 `bin` 指向 `bin/cli.js`（与上游 openwork CLI 兼容时可全局安装后启动；具体以仓库内 `bin/cli.js` 为准）。

## 支持的模型（与上游能力一致）

| 提供商 | 示例 |
|--------|------|
| Anthropic | Claude 系列 |
| OpenAI | GPT / o 系列等 |
| Google | Gemini 系列 |

具体列表以应用内模型配置为准。

## 贡献与协议

欢迎贡献；说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

协议：**MIT**，见 [LICENSE](LICENSE)。

## 协作者与自动化

修改代码前建议阅读根目录 [**AGENTS.md**](AGENTS.md)（技术栈、目录地图、IPC 与质量检查命令）。
