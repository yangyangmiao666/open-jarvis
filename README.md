# Open-Jarvis

[![License: MIT][license-badge]][license-url]

[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT

基于 [deepagents](https://github.com/langchain-ai/deepagentsjs) 的 **Electron 桌面客户端**：在本地工作区内与智能体对话，支持文件系统工具、子代理、人机协同审批（HITL）、MCP 工具接入以及可配置的 Skills。界面中助手品牌为 **Jarvis**。

> 本项目由 [openwork](https://github.com/langchain-ai/openwork) 一脉演进；包名与二进制入口见 `package.json` 的 `bin`。

> [!CAUTION]
> 智能体可访问你选定的工作区文件并执行 shell 命令。请在信任的工作区内使用，并在批准工具调用前仔细核对。

## 界面预览

<table>
  <tr>
    <td align="center"><b>主界面 - 亮色</b></td>
    <td align="center"><b>主界面 - 深色</b></td>
  </tr>
  <tr>
    <td><img src="docs/主界面-亮色.png" alt="主界面-亮色" /></td>
    <td><img src="docs/主界面-深色.png" alt="主界面-深色" /></td>
  </tr>
  <tr>
    <td align="center"><b>设置中枢 - 亮色</b></td>
    <td align="center"><b>设置中枢 - 深色</b></td>
  </tr>
  <tr>
    <td><img src="docs/设置中枢-亮色.png" alt="设置中枢-亮色" /></td>
    <td><img src="docs/设置中枢-深色.png" alt="设置中枢-深色" /></td>
  </tr>
  <tr>
    <td align="center"><b>多任务总览 - 亮色</b></td>
    <td align="center"><b>多任务总览 - 深色</b></td>
  </tr>
  <tr>
    <td><img src="docs/多任务总览-亮色.png" alt="多任务总览-亮色" /></td>
    <td><img src="docs/多任务总览-深色.png" alt="多任务总览-深色" /></td>
  </tr>
</table>

## 功能概览

- **会话与历史**：多会话、侧栏管理；新建会话可继承当前会话的**模型**、**工作区路径**与**审批模式**；会话与检查点持久化（sql.js）；删除最后一个会话时会自动补一个新线程，避免工作区上下文丢失。
- **工作区**：按会话绑定本地文件夹；树形 / 列表视图（可调整列宽，时间列含年份）；`@` 引用工作区路径；文件变更监听。
- **模型**：Anthropic / OpenAI / Google 等；API Key 与 OpenAI 兼容配置存于本地；默认模型可切换；支持自定义 OpenAI-compatible base URL 与模型档案。
- **Agent 运行时**：主进程内 `createDeepAgent` + LangGraph；`LocalSandbox` 扩展文件读写（含 **UTF-8 / GB18030** 文本解码，避免中文乱码）与命令执行。
- **审批（HITL）**：支持线程级 `manual` / `auto` 审批模式；工具调用可批准、拒绝或编辑参数；工作区级记忆规则保存在 `.open-jarvis/approval-rules.json`，可对稳定命令自动放行。
- **MCP**：支持全局 MCP server 配置、导入导出 JSON、线程级启用状态；传输方式覆盖 `stdio`、`streamable_http` 与 `sse`，远程服务支持自定义 HTTP headers。
- **Skills**：`.deepagents/skills` 目录列表、导入、创建（含 Markdown）、编辑 `SKILL.md`、重命名与删除（带确认）。
- **对话 UI**：流式 Markdown、工具调用卡片、待办、上下文用量；单条气泡与整会话 **导出 Markdown**；`@` 补全在深色模式下有高对比选中态；内置上下文窗口指示器可查看输入 / 输出 / 缓存 token 使用量。
- **看板与子智能体**：支持 Kanban 总览全部线程状态；右侧面板展示 todo、工作区文件与子智能体生命周期，便于并行任务追踪。
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

| 命令                  | 说明                       |
|---------------------|--------------------------|
| `bun run dev`       | electron-vite 开发模式（热更新）  |
| `bun run build`     | 类型检查 + 打包到 `out/`        |
| `bun run package:dir` | 生成本机可运行应用目录到 `release/` |
| `bun run dist`      | 生成发行包；macOS 默认输出 `.dmg` 安装包 |
| `bun run start`     | 预览已构建产物                  |
| `bun run typecheck` | 主进程 + 渲染进程 TypeScript 检查 |
| `bun run lint`      | ESLint                   |

安装包构建说明：

- `bun run package:dir`：生成未安装版应用，便于本机直接验包。
- `bun run dist`：按当前平台生成发行包；在 macOS 上会输出 `.dmg` 与 `.zip` 到 `release/`。
- `bun run dist:mac`、`bun run dist:win`、`bun run dist:linux`：分别生成各平台目标。
- 打包前会联网下载并嵌入固定版本的 `uv 0.11.7`、`bun 1.3.13` 与内置 Python 运行时，终端用户机器无需预装这些环境即可由智能体在工作区创建 `.venv` 并执行 Python / JS 命令。
- `scripts/prepare-embedded-tooling.mjs` 会在打包前把 Python 安装中的符号链接改写为 bundle 内相对路径，避免 macOS 签名 / notarization 因绝对链接失效。
- 当前脚本默认关闭了本地自动签名发现，方便先完成 unsigned 本地打包；如需正式签名与 notarization，可在 CI 或发布机上按证书环境变量覆盖。

## 文档

- [docs/源码导览.md](docs/源码导览.md)：面向开发者的人类版源码地图，说明主进程、preload、渲染层、审批、MCP、技能和嵌入式工具链的实际控制点。
- [AGENTS.md](AGENTS.md)：面向代码代理 / 协作者的修改入口说明，强调桥接层、真实决策点与最小验证动作。

## 项目结构（精简）

```
src/
  main/                 # Electron 主进程
    index.ts            # 窗口、IPC 注册、数据库初始化
    approval-settings.ts# 审批模式与工作区规则
    agent/              # DeepAgent 运行时、LocalSandbox、system prompt
    ipc/                # approval / agent / threads / models+workspace / mcp / skills
    db/, storage.ts     # 会话与密钥等持久化
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

- **IPC**：`approval:*`、`agent:*`、`threads:*`、`models:*`、`workspace:*`、`mcp:*`、`skills:*` 等在 [`src/main`](src/main) 注册，[`src/preload`](src/preload) 暴露给渲染进程。
- **流式对话**：渲染进程通过 LangGraph SDK 订阅流事件；主进程执行 `agent:invoke` / `agent:resume` / `agent:interrupt` 等。
- **审批链路**：线程 metadata 决定默认审批模式，工作区规则用于自动批准已记忆的工具签名；渲染层在工具卡片与底部固定栏展示审批态。
- **Token 统计**：token usage 通过流事件进入渲染层，在每个线程内持久化到 localStorage，并由上下文窗口指示器展示。
- **工作区路径**：保存在线程 metadata 中；工具侧使用**绝对路径**（见 `runtime.ts` 中的 system prompt）。

## 命令行入口（可选）

`package.json` 中 `bin` 指向 `bin/cli.js`（与上游 openwork CLI 兼容时可全局安装后启动；具体以仓库内 `bin/cli.js` 为准）。

## 支持的模型（与上游能力一致）

| 提供商    | 示例           |
| --------- | -------------- |
| Anthropic | Claude 系列    |
| OpenAI    | GPT / o 系列等 |
| Google    | Gemini 系列    |

具体列表以应用内模型配置为准。

## 贡献与协议

欢迎贡献！协议：**MIT**。

## 协作者与自动化

修改代码前建议阅读根目录 [**AGENTS.md**](AGENTS.md)（技术栈、目录地图、IPC 与质量检查命令）。
