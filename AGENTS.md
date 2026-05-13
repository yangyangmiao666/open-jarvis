# AGENTS.md — open-jarvis 代码库说明

本文档面向在本仓库内协作的开发者与代码代理，目标是提供一份可直接落地的定位图：哪些目录决定行为，哪些文件只是桥接层，改动时有哪些同步点，以及提交前最小验证动作是什么。

## 1. 总体架构

### 1.1 技术栈

| 层级 | 技术选型 | 版本 |
|------|----------|------|
| **Shell** | Electron + electron-vite | 42 / 5 |
| **主进程** | TypeScript, Node.js | 6 / 24+ |
| **渲染层** | React + Tailwind CSS + Radix UI + Zustand | 19 / 4 / 10+ / 5 |
| **智能体运行时** | deepagents `createDeepAgent` + LangGraph | ^1.10.0 / ^1.3.0 |
| **检查点存储** | SqlJsSaver（每线程独立 SQLite） | sql.js ^1.14.1 |
| **模型集成** | @langchain/anthropic, @langchain/openai, @langchain/google-genai | ^1.3.29 / ^1.4.5 / ^2.1.30 |
| **MCP 集成** | @modelcontextprotocol/sdk | ^1.29.0 |
| **代码高亮** | Shiki | ^4.0.2 |
| **Markdown** | react-markdown + remark-gfm + remark-math + rehype-katex | ^10.1.0 |
| **包管理** | Bun（固定版本） | 1.3.13 |
| **构建** | Vite + electron-builder | 8 / 26 |
| **类型检查** | TypeScript | 6 |
| **Lint** | ESLint (flat config) + Prettier | 10 / 3 |
| **代理** | undici ProxyAgent | 内置 |

### 1.2 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ App.tsx     │  │ store.ts    │  │ thread-context.tsx      │  │
│  │ (三栏布局)  │  │ (全局状态)  │  │ (线程状态 + Stream订阅) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                         ↓ window.api ↓                          │
├─────────────────────────────────────────────────────────────────┤
│                        Preload (桥接层)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ contextBridge.exposeInMainWorld("api", {...})               ││
│  │ 类型契约: index.d.ts                                        ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                        主进程 (Main)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ index.ts    │  │ IPC Handlers│  │ Agent Runtime           │  │
│  │ (入口)      │  │ (7个模块)   │  │ (deepagents + MCP)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ DB (SQLite) │  │ Storage     │  │ Tooling (嵌入式工具链)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 进程间通信模型

- 渲染进程**严禁**直接引入 Electron / Node 能力，所有主进程访问必须通过 `window.api`。
- 流式事件（对话流、HITL 中断、工作区变更）通过 `agent:stream:${threadId}` 通道从主进程推送到渲染进程。
- 渲染进程通过 `ElectronIPCTransport`（实现 LangGraph SDK `UseStreamTransport` 接口）适配流事件。
- IPC 注册在主进程 7 个模块中，preload 暴露 8 个命名空间（agent, threads, approval, models, workspace, mcp, skills, settings）。

## 2. 顶层目录

```
open-jarvis/
  src/
    main/                 # Electron 主进程（27 个 TS 文件）
    preload/              # contextBridge → window.api（2 个文件）
    renderer/src/         # React 19 + Tailwind 4 UI
    model-context.ts      # 模型上下文窗口配置
    types.ts              # 渲染层共享类型
  resources/tooling/      # 按平台打包的 bun / uv / Python 嵌入式工具链
  scripts/prepare-embedded-tooling.mjs  # 准备嵌入式工具链并生成 manifest
  bin/cli.js              # CLI 入口（openwork / open-jarvis 二进制）
  release/                # electron-builder 产物
  docs/                   # 截图与源码导览
  out/                    # 构建输出（main / preload / renderer）
  verify_sandbox_temp/    # 本地验证嵌入式工具链/沙箱时使用的临时目录
```

## 3. 主进程地图

### 3.1 启动入口

- **`src/main/index.ts`**（245 行）
  - 创建 BrowserWindow，macOS `hiddenInset` 标题栏 + `trafficLightPosition`。
  - 窗口状态持久化（bounds、maximized）到 electron-store。
  - 首次启动自动最大化；F12 在 dev 模式下切换 DevTools。
  - 初始化数据库 `initializeDatabase()`。
  - 加载 `.env` 文件到 `process.env`（`loadEnvFileToProcessEnv`）。
  - 配置全局代理 `applyGlobalProxyDispatcher()`。
  - 注册全部 IPC：approval / agent / threads / models(workspace) / mcp / skills / settings。
  - 退出前调用 `closeAllRuntimeResources()`，清理 agent checkpointers 与 MCP 连接。

### 3.2 Agent 运行时

- **`src/main/agent/runtime.ts`**（745 行）
  - `createAgentRuntime(options)`：核心工厂函数，组装 DeepAgent。
  - **模型路由**：
    - `claude*` → `ChatAnthropic`
    - `gpt*/o1/o3/o4*` → `ChatOpenAI`
    - `gemini*` → `ChatGoogleGenerativeAI`
    - `oac:*` → 自定义 OpenAI-compatible（支持 `openai` 和 `anthropic` 两种 API 格式）
  - 自定义 `OpenAICompatibleChatCompletions` 类归一化消息格式（array content、reasoning_content、thinking blocks、lone surrogates）。
  - 每线程独立 SqlJsSaver checkpointer，缓存在 `Map<string, SqlJsSaver>`。
  - LocalSandbox 后端：120s 超时、100KB 输出截断、绝对路径。
  - System prompt = workspace 路径段 + `BASE_SYSTEM_PROMPT`。
  - MCP 工具从线程 metadata 读取启用状态，工具命名 `{serverName}_{toolName}`。
  - HITL `interruptOn`：所有 `execute` 工具 + 已启用的 MCP 工具名。
  - Skills 通过 `resolveSkillSourcesForWorkspace()` 解析。
  - `RuntimeToolErrorMiddleware`：全局工具调用错误中间件，捕获异常后返回 `ToolMessage` 而非崩溃。

- **`src/main/agent/system-prompt.ts`**（122 行）
  - Agent 基础行为约束：简洁回复、文件分页读取、shell 执行规则（必须用嵌入式 uv/bun）、HITL 审批处理、todo 管理、子代理委派、代码引用格式。
  - 需要改智能体默认策略时，**优先改这里**而不是散落在 UI 文案中。

- **`src/main/agent/local-sandbox.ts`**（1557 行）
  - 继承 `FilesystemBackend`，实现 `SandboxBackendProtocolV2`。
  - **文件读取**：`read()` / `readRaw()` 使用 `decodeTextBuffer()`（UTF-8 优先 + GB18030 回退），与主进程 `workspace:readFile` 保持一致。
  - **命令执行**：`execute()` 是核心方法。
    - 直接 `python/python3/pip/pip3/pytest` 调用被拦截，返回错误提示使用 `uv run`。
    - 直接 `node/npm/npx/pnpm/yarn/tsx/ts-node/tsc` 调用被拦截，返回错误提示使用 `bun`。
    - macOS/Linux：`buildWorkspaceRuntimeCommand()` 注入 shell 函数覆盖（python→uv, npm→bun 等）。
    - Windows：`buildWorkspaceRuntimeCommandForWindows()` 生成 `.cmd` shim 文件到 `.open-jarvis/runtime-bin/` 和 `.open-jarvis/python-runtime-bin/`。
    - 自动创建 `.venv`（若不存在）使用嵌入式 Python 3.12.13。
    - 命令超时：120s；输出截断：100KB。
    - 自动注入嵌入式工具链环境变量（`OPEN_JARVIS_UV`, `OPEN_JARVIS_BUN`, `OPEN_JARVIS_PYTHON` 等）。
    - 代理环境变量别名：`withProxyEnvAliases()` 同时设置大小写形式（`HTTP_PROXY` / `http_proxy`）。
  - **MIME 类型**：覆盖 50+ 种二进制和文本扩展名。
  - **macOS textutil**：`.doc/.docx/.odt/.rtf` 通过 `/usr/bin/textutil` 提取文本。
  - **符号链接安全**：支持 `O_NOFOLLOW` 的系统上拒绝符号链接读取。

- **`src/main/agent/mcp-runtime.ts`**（197 行）
  - 管理 MCP 连接与工具包装。
  - 支持 `stdio`、`streamable_http`、`sse` 三种传输；远程连接支持自定义 headers。
  - 连接缓存按 `server.id + 配置签名` 维度失效。
  - 工具命名归一化：`{serverName}_{toolName}`。
  - MCP 工具自动附加 `__approvalAliases` 标记，供 HITL 审批使用。
  - `closeAllMCPConnections()`：应用退出时清理所有连接。

- **`src/main/agent/types.ts`**
  - Agent 类型定义，包括 `DeepAgent` 接口。

### 3.3 线程、存储与配置

- **`src/main/db/index.ts`**（259 行）
  - SQLite 持久化访问层：线程、运行、助手的 CRUD。
  - 数据库文件：`~/.open-jarvis/openwork.sqlite`。

- **`src/main/checkpointer/sqljs-saver.ts`**（510 行）
  - 每线程独立 checkpoint 数据库：`~/.open-jarvis/threads/{threadId}.sqlite`。
  - 提供 `truncateThread()` 方法用于消息回滚（配合 `threads:rewindToMessage`）。
  - Checkpointer 实例缓存在 `runtime.ts` 的 `Map<string, SqlJsSaver>` 中。

- **`src/main/storage.ts`**（227 行）
  - `~/.open-jarvis` 目录管理（含从 `~/.openwork` 的自动迁移）。
  - API Key 读写（ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY）到 `.env` 文件。
  - 线程 checkpoint 路径、默认模型、代理配置等持久化入口。
  - `loadEnvFileToProcessEnv()`：启动时加载 `.env` 到 `process.env`。

- **`src/main/approval-settings.ts`**（159 行）
  - 线程审批模式读写（`manual` / `auto`）。
  - 工作区 `.open-jarvis/approval-rules.json` 规则匹配。
  - `createApprovalSignature()` 对工具参数做归一化，避免命令细节波动导致规则失配。
  - `rememberWorkspaceApproval()`：用户勾选"记住"时写入工作区规则文件。

- **`src/main/mcp-config.ts`**（196 行）
  - MCP server 配置 CRUD、导入导出、线程启用状态。
  - 配置存储在 electron-store `settings.json`。

- **`src/main/skill-config.ts`**（91 行）
  - 解析全局与工作区 skill 源目录。
  - 工作区技能目录：`.deepagents/skills`。
  - 全局技能目录：`~/.open-jarvis/skills/`。

- **`src/main/openai-compatible-profiles.ts`**（74 行）
  - 自定义 OpenAI 兼容模型配置 CRUD。
  - 支持 `apiFormat`（openai/anthropic）、`thinkingType`、`thinkingEffort`、`contextWindow`。

- **`src/main/tooling.ts`**（159 行）
  - 解析嵌入式工具链根目录与各运行时路径。
  - 打包版优先走 `process.resourcesPath/tooling/<platform-arch>`。
  - 开发态回退到仓库内 `resources/tooling/<platform-arch>`。
  - 返回 `{ rootDir, binDir, uvPath, bunPath, pythonPath, pythonVersion }`。

- **`src/main/text-encoding.ts`**（27 行）
  - `decodeTextBuffer(buffer)`：UTF-8 优先，必要时回退 GB18030。
  - Windows 中文编码兼容**必须**统一走这里。

- **`src/main/proxy-config.ts`**（48 行）
  - `getProxyConfigFromEnv()`：从 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 读取。
  - `applyGlobalProxyDispatcher()`：配置 undici 全局代理分发器。
  - 优先级：`HTTPS_PROXY` > `HTTP_PROXY` > `ALL_PROXY`。

- **`src/main/logger.ts`**（20 行）
  - 简单日志：`logInfo` / `logWarn` / `logError`，仅输出到 console，不写文件。

- **`src/main/services/title-generator.ts`**（51 行）
  - 首条消息生成线程标题。

- **`src/main/services/workspace-watcher.ts`**（134 行）
  - 监听工作区文件变化（`fs.watch` + 500ms debounce）。
  - 通过 `workspace:files-changed` 事件驱动 UI 刷新。

- **`src/main/types.ts`**（307 行）
  - 主进程共享类型：Thread、StreamEvent、ModelConfig、MCPServerConfig、ProxyConfig、HITLRequest、HITLDecision、OpenAICompatibleProfile、CustomModelApiFormat、CustomModelThinkingType、CustomModelThinkingEffort、WorkspaceApprovalRule、Subagent、Todo、FileInfo 等。

### 3.4 IPC 入口

- **`src/main/ipc/agent.ts`**（664 行）
  - `agent:invoke`：发送消息，启动流式对话。自动中止同线程已有流。
  - `agent:resume`：HITL 审批后恢复执行。支持 `rememberForWorkspace` 写入工作区规则。
  - `agent:interrupt`：HITL 中断响应（approve/reject/edit）。
  - `agent:cancel`：取消运行（AbortController）。
  - 流式事件通过 `agent:stream:${threadId}` 通道发送，双模式 `["messages", "values"]`。
  - 对话日志：`logConversationMessagesFromValues()` 提取并记录消息内容。
  - 工作区路径**必需**：缺失时返回 `WORKSPACE_REQUIRED` 错误。

- **`src/main/ipc/approval.ts`**
  - `approval:getMode`、`approval:setMode`、`approval:shouldAutoApprove`。
  - 审批模式切换与工作区自动批准判断。

- **`src/main/ipc/threads.ts`**（272 行）
  - 线程列表、读取、创建、更新、批量删除、历史、标题生成。
  - `threads:rewindToMessage`：消息回滚，通过 `SqlJsSaver.truncateThread()` 截断检查点。

- **`src/main/ipc/models.ts`**（487 行）
  - 模型列表、默认模型、API Key、provider 列表。
  - **同时承载** `workspace:get/set/select/loadFromDisk/readFile/readBinaryFile/openCurrentFolder`。
  - 这是工作区相关 IPC 的真实入口，不在单独的 workspace 文件里。

- **`src/main/ipc/mcp.ts`**（95 行）
  - MCP server 的列表、增删改、导入导出、线程启用状态。

- **`src/main/ipc/skills.ts`**（271 行）
  - 技能源目录、导入、创建（含 Markdown + YAML frontmatter）、读写 SKILL.md、重命名、删除（带确认）。

- **`src/main/ipc/settings.ts`**（19 行）
  - `settings:getProxyConfig`、`settings:setProxyConfig`。
  - 设置代理后自动调用 `applyGlobalProxyDispatcher()`。

## 4. Preload 契约

- **`src/preload/index.ts`**（404 行）
  - 通过 `contextBridge` 暴露 `window.api`，包含 8 个命名空间：agent, threads, approval, models, workspace, mcp, skills, settings。
  - 渲染层只应通过这里访问主进程能力。
  - 流式事件订阅返回清理函数。
  - `window.electron` 暴露原始 IPC 访问（`ipcRenderer.send/on/invoke`）和平台信息。

- **`src/preload/index.d.ts`**（196 行）
  - `window.api` 的类型契约。
  - 任何新增 IPC 或方法签名变更，**都必须同步这里**，否则渲染层类型会漂移。
  - 当前 `approval`、`mcp`、`workspace`、`skills`、`settings` 都已经是独立契约面，不要只改实现不改声明。

## 5. 渲染层地图

### 5.1 顶层布局

- **`src/renderer/src/App.tsx`**（230 行）
  - 应用总布局：左侧会话栏（220-350px 可拖拽）、中间主工作区、右侧信息面板（230-450px 可拖拽）。
  - 初始化时先 `loadThreads()`；若没有任何线程，创建默认线程。
  - macOS 下 `WindowTitleBar` 与主内容区做了专门的对齐处理。
  - `ThreadProvider` 包裹整个 `AppShell`，提供线程上下文。
  - 看板视图与对话视图互斥切换。

- **`src/renderer/src/components/WindowTitleBar.tsx`**
  - 自定义标题栏占位，与主进程窗口配置保持一致。

- **`src/renderer/src/components/branding/JarvisMark.tsx`**
  - 品牌 Logo 组件，Gemini 风格八芒星 SVG。

- **`src/renderer/src/components/ThemeToggle.tsx`**
  - 亮色 / 深色模式切换，持久化到 localStorage `openwork-theme`。

### 5.2 状态层

- **`src/renderer/src/lib/store.ts`**（303 行）
  - 全局 Zustand store。
  - 保存：线程列表、当前线程 id、模型列表、provider 列表、设置弹窗状态、看板开关、侧栏折叠、右面板 tab、亮色/深色模式。
  - `createThread()` 会继承当前线程的 `model`、`workspacePath`、`approvalMode`。
  - 删除最后一个线程时会立刻补一个新线程，避免 `currentThreadId === null` 造成工作区相关状态悬空。

- **`src/renderer/src/lib/thread-context.tsx`**（1100 行）
  - 线程内状态源：`messages`、`todos`、`workspaceFiles`、`workspacePath`、`subagents`、`pendingApproval`、`currentModel`、`tokenUsage`、`openFiles`、`activeTab`、`fileContents`、`draftInput`、`approvalMode` 等。
  - `ThreadProvider` 为每个活跃线程挂接 `useStream()` + `ElectronIPCTransport`。
  - 新线程默认状态：消息空数组、草稿空字符串、无工作区文件、审批模式 `manual`。
  - token usage 持久化到 localStorage，用于上下文窗口监控。
  - 自定义事件处理：interrupt、workspace、subagents、token_usage。

### 5.3 左侧会话栏

- **`src/renderer/src/components/sidebar/ThreadSidebar.tsx`**
  - 会话列表、新建、重命名、批量删除、切换到看板等。
  - 当前逻辑：点击"新会话"时，如果当前线程仍为空线程（无消息、无草稿），会复用当前线程，不再额外创建新的空会话。
  - 如果要改"新建线程"的 UX，**这里是首选入口**；不要先改 DB 层。

### 5.4 对话与消息

- **`src/renderer/src/components/chat/ChatContainer.tsx`**（1206 行）
  - 对话主容器，负责消息发送、流式状态、错误提示、审批状态接入。
  - 流式处理时显示动态提示，基于当前状态生成上下文相关提示信息。
  - 消息发送前检查工作区路径，缺失时阻止发送并提示。

- **`src/renderer/src/components/chat/MessageBubble.tsx`**
  - 单条消息渲染。助手显示为 Jarvis，用户显示为"你"。
  - 支持单条消息与整会话导出 Markdown。

- **`src/renderer/src/components/chat/ToolCallRenderer.tsx`**（742 行）
  - 工具调用卡片与结果展示。
  - 待审批工具会显示专门的状态与批准/拒绝/编辑交互。
  - 支持"记住此决定"复选框，勾选后写入工作区审批规则。

- **`src/renderer/src/components/chat/StreamingMarkdown.tsx`**
  - 流式 Markdown 展示，支持 GFM、数学公式（KaTeX）。

- **`src/renderer/src/components/chat/ThinkAwareMarkdown.tsx`**
  - 对 reasoning / think 类内容做可折叠展示处理。

- **`src/renderer/src/components/chat/ContextUsageIndicator.tsx`**
  - 显示输入 / 输出 / 缓存 token 使用量与模型上下文窗口占比。
  - 模型上限采用 `src/model-context.ts` 中的配置；若改模型清单，最好同步这里。

- **`src/renderer/src/components/chat/ModelSwitcher.tsx`**
  - 当前线程模型切换，支持打开模型配置设置。

- **`src/renderer/src/components/chat/WorkspacePicker.tsx`**
  - 工作区关联入口，支持选择/更换/同步。

- **`src/renderer/src/components/chat/SettingsHubDialog.tsx`**
  - 设置总入口，根据 `SettingsOpenRequest` 定向打开子对话框。

- **`src/renderer/src/components/chat/ChatTodos.tsx`**
  - 对话区任务列表展示。

- **`src/renderer/src/components/chat/MCPConfigDialog.tsx`**
  - MCP 服务器配置 UI，支持三种传输方式、自定义 headers、导入导出 JSON。

- **`src/renderer/src/components/chat/OpenAICompatibleDialog.tsx`**
  - 自定义 OpenAI 兼容模型配置 UI，支持 API 格式、思考类型/力度、上下文窗口。

- **`src/renderer/src/components/chat/ApiKeyDialog.tsx`**
  - API Key 配置 UI（Anthropic / OpenAI / Google）。

- **`src/renderer/src/components/chat/ProxyConfigDialog.tsx`**
  - 代理配置 UI（HTTP / HTTPS / ALL_PROXY）。

- **`src/renderer/src/components/chat/ShikiCodePreview.tsx`**
  - Shiki 代码高亮预览组件。

### 5.5 右侧面板

- **`src/renderer/src/components/panels/RightPanel.tsx`**
  - 右侧三段式面板：任务（todos）、文件（workspace）、子智能体（subagents）。
  - 每段高度可拖拽。
  - 文件区头部：工作区路径显示、树/列表切换、关联/更换/同步/打开按钮。
  - 面板本身不决定数据，只消费 `thread-context` 中的 `todos` / `workspaceFiles` / `subagents`。

- **`src/renderer/src/components/panels/WorkspaceFileListTable.tsx`**
  - 文件列表视图，带排序、列宽持久化、目录展开、时间列含年份。

- **`src/renderer/src/components/panels/FilesystemPanel.tsx`**
  - 文件系统面板组件。

- **`src/renderer/src/components/panels/SkillsDialog.tsx`**
  - 工作区技能管理 UI。

- **`src/renderer/src/components/panels/TodoPanel.tsx`**
  - todo 面板组件。

- **`src/renderer/src/components/panels/SubagentPanel.tsx`**
  - 子智能体状态面板组件。

### 5.6 标签页与文件预览

- **`src/renderer/src/components/tabs/TabbedPanel.tsx`**
  - 中间主面板容器，支持多标签页。

- **`src/renderer/src/components/tabs/TabBar.tsx`**
  - 标签栏，支持关闭标签、设置入口。

- **`src/renderer/src/components/tabs/FileViewer.tsx`**
  - 根据文件类型选择具体 viewer。

- **`src/renderer/src/components/tabs/CodeViewer.tsx`**
  - Shiki 代码预览（35+ 语言，亮色/深色主题）。
  - CSV / TSV 走纯文本截断预览，避免大文件卡顿。

- **`src/renderer/src/components/tabs/ImageViewer.tsx`**
  - 图片预览（PNG, JPG, GIF, WebP, BMP, SVG 等）。

- **`src/renderer/src/components/tabs/MediaViewer.tsx`**
  - 音视频预览（MP3, MP4, WebM, WAV 等）。

- **`src/renderer/src/components/tabs/PDFViewer.tsx`**
  - PDF 内嵌预览，占满中间栏可用区域。

- **`src/renderer/src/components/tabs/BinaryFileViewer.tsx`**
  - 二进制文件兜底提示。

### 5.7 看板

- **`src/renderer/src/components/kanban/`**
  - `KanbanView.tsx`、`KanbanHeader.tsx`、`KanbanColumn.tsx`、`KanbanCard.tsx`：看板相关组件。
  - 看板开关与线程列表状态仍由全局 store 驱动。
  - 支持按线程状态分列展示（idle / busy / interrupted / error）。

### 5.8 常用库文件

- **`src/renderer/src/lib/electron-transport.ts`**（1308 行）
  - 将主进程流事件适配为 LangGraph SDK 的 transport。
  - 实现 `UseStreamTransport` 接口。
  - 处理 LangChain 序列化格式（`lc: 1, type: "constructor", id, kwargs`）。
  - 提取 `AIMessageChunk` / `ToolMessage` 内容，累积流式工具调用。
  - 检测 HITL 中断（legacy + 新格式），子智能体 task 追踪。
  - 提取 `usage_metadata` 用于上下文窗口监控。
  - 双流模式处理：`messages`（实时 token）+ `values`（完整状态）。

- **`src/renderer/src/lib/shiki-highlighter.ts`**（259 行）
  - Shiki 按需语言包加载与扩展名到语言映射（含 MATLAB `.m` 等）。

- **`src/renderer/src/lib/file-types.ts`**（227 行）
  - 文件类型判定，决定用哪种 viewer。

- **`src/renderer/src/lib/workspace-file-tree.ts`**（92 行）
  - 把平铺的工作区文件列表转成树结构。

- **`src/renderer/src/lib/chat-markdown.ts`**（85 行）
  - 会话导出 Markdown。

- **`src/renderer/src/lib/workspace-utils.ts`**（27 行）
  - 工作区相关工具函数。

- **`src/renderer/src/lib/media-blob.ts`**（35 行）
  - `useObjectUrlFromBase64()`：将 base64 文件数据转为 Object URL，组件卸载时自动释放。

- **`src/renderer/src/lib/utils.ts`**（57 行）
  - `cn()`（className 合并）、日期格式化（zh-CN）、截断、`generateId()` 等。

### 5.9 UI 基础组件

- **`src/renderer/src/components/ui/`**
  - 11 个 Radix UI 封装组件：button, dialog, popover, scroll-area, context-menu, badge, card, separator, input, resizable, toast(sonner)。
  - 遵循 shadcn/ui 风格约定。

### 5.10 设计系统

- **`src/renderer/src/index.css`**（1553 行）
  - Tailwind CSS 4 + 完整 CSS 变量设计系统。
  - 亮色/深色主题变量、自定义滚动条、动画、组件样式。
  - 主题 key 持久化到 localStorage `openwork-theme`，默认亮色。

## 6. 模型上下文窗口

- **`src/model-context.ts`**（78 行）
  - `getContextWindowForModel(modelId, configuredContextWindow?)`：获取模型上下文窗口。
  - 支持的模型家族与窗口大小：

  | 模型家族 | 上下文窗口 |
  |----------|-----------|
  | Claude | 200K |
  | GPT-5 | 400K |
  | GPT-4.1 | 1M |
  | GPT-4o / GPT-4-turbo | 128K |
  | GPT-4 | 8K |
  | O1 / O3 / O4 | 200K |
  | Gemini-3-pro / 2.5-pro / 1.5-pro | 2M |
  | 其他 Gemini | 1M |
  | DeepSeek | 64K |
  | Qwen | 131K |
  | GLM / ChatGLM | 128K |
  | Minimax / ABAB | 1M |
  | 默认回退 | 128K |

  - 自定义 profile 的 `contextWindow` 优先级最高，可覆盖上述默认值。

## 7. 工作区与文件处理约定

- 渲染层展示的工作区文件路径多数是 POSIX 风格，以 `/` 开头。
- 实际磁盘路径在主进程解析，渲染层**不要**手拼绝对系统路径后直接读文件。
- 文本文件读取必须走 `workspace:readFile` 或 `LocalSandbox`，两者都应使用 `decodeTextBuffer()`。
- 二进制文件走 `workspace:readBinaryFile`。
- 当前工作区文件夹可通过 `workspace:openCurrentFolder` 在系统文件管理器中打开。
- 工作区审批规则存放在 `.open-jarvis/approval-rules.json`，不要把这类规则误写到 `.openwork`。
- 文件变更通过 `workspace:files-changed` 事件通知渲染层。
- 工作区路径保存在线程 metadata 中；工具侧使用**绝对路径**（见 `runtime.ts` 中的 system prompt）。

## 8. 嵌入式工具链

- `resources/tooling/<platform-arch>` 内包含 bun、uv、Python 运行时以及 `manifest.json`。
- **``scripts/prepare-embedded-tooling.mjs`**（740 行）负责准备这些文件，打包脚本会在 electron-builder 之前先执行它。
  - 下载 uv 0.11.7、bun 1.3.13 可执行文件。
  - 使用 uv 安装 Python 3.12.13。
  - 重写 Python 符号链接为相对路径（macOS 打包兼容）。
  - 生成 `manifest.json`。
  - 支持 6 个平台目标：darwin-arm64/x64, linux-arm64/x64, win32-arm64/x64。
- 打包后工具链位于应用资源目录下的 `tooling/<platform-arch>`。
- **`src/main/tooling.ts`** 是运行时**唯一可信**的工具链定位入口。
- 仓库记忆补充：本项目曾验证过 macOS 打包时 Python 绝对符号链接会破坏 bundle 校验，需要在准备阶段改写或移除。

## 9. 类型与契约

- **`src/main/types.ts`**（307 行）定义主进程共享类型：Thread、StreamEvent、ModelConfig、MCPServerConfig、ProxyConfig、HITLRequest、HITLDecision、OpenAICompatibleProfile、CustomModelApiFormat、CustomModelThinkingType、CustomModelThinkingEffort、WorkspaceApprovalRule、Subagent、Todo、FileInfo、GrepMatch 等。
- **`src/types.ts`** 与 **`src/renderer/src/types.ts`** 负责渲染层消费的类型出口。
- 新增 IPC 时，至少要同步**三处**：主进程 handler、preload 暴露、preload 类型声明。

## 10. 数据流

### 10.1 消息发送流程

```
用户输入
    ↓
ChatContainer.submitUserMessage()
    ↓
stream.submit({ messages: [...] }, { config: { thread_id, model_id } })
    ↓
ElectronIPCTransport.stream()
    ↓
window.api.agent.streamAgent(threadId, message, command, onEvent)
    ↓
IPC: "agent:invoke" → 主进程
    ↓
createAgentRuntime({ threadId, workspacePath, modelId })
    ↓
agent.stream({ messages: [HumanMessage] }, { streamMode: ["messages", "values"] })
    ↓
for await (chunk of stream) → window.webContents.send(channel, { type: "stream", mode, data })
    ↓
ElectronIPCTransport.convertToSDKEvents() → StreamEvent[]
    ↓
useStream onCustomEvent → ThreadContext.handleCustomEvent()
    ↓
updateThreadState() → React 重渲染
```

### 10.2 HITL 审批流程

```
Agent 执行 execute 工具
    ↓
interruptOn: { execute: true } → 中断
    ↓
主进程发送 { type: "stream", mode: "values", data: { __interrupt__: [...] } }
    ↓
ElectronIPCTransport → { event: "custom", data: { type: "interrupt", request, requests } }
    ↓
ThreadContext.handleCustomEvent("interrupt")
    ↓
window.api.approval.shouldAutoApprove(threadId, request)
    ↓
┌─ 自动批准 → stream.submit(null, { command: { resume: { decision: "approve" } } })
│
└─ 需要审批 → setPendingApproval(request)
        ↓
    ChatContainer 渲染审批栏
        ↓
    用户点击批准/拒绝（可选"记住此决定"）
        ↓
    handleApprovalDecision("approve" | "reject")
        ↓
    若 rememberForWorkspace → rememberWorkspaceApproval() 写入 .open-jarvis/approval-rules.json
        ↓
    stream.submit(null, { command: { resume: { decision, request, requests } } })
        ↓
    主进程 agent:resume → Command({ resume: { decisions: [...] } })
        ↓
    Agent 继续执行
```

### 10.3 工作区文件同步

```
用户选择工作区
    ↓
window.api.workspace.select(threadId)
    ↓
主进程 dialog.showOpenDialog → 选择目录
    ↓
updateThread metadata.workspacePath
    ↓
startWatching(threadId, workspacePath)
    ↓
workspace:loadFromDisk → 返回文件列表
    ↓
渲染层 setWorkspaceFiles(files)
    ↓
文件变更 → workspace-watcher 发送 "workspace:files-changed"
    ↓
渲染层重新加载文件列表
```

### 10.4 代理配置流程

```
用户在 ProxyConfigDialog 设置代理
    ↓
window.api.settings.setProxyConfig(config)
    ↓
IPC: "settings:setProxyConfig" → 主进程
    ↓
setProxyConfig() 写入 electron-store
    ↓
applyGlobalProxyDispatcher(getProxyConfigFromEnv())
    ↓
undici.setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }))
    ↓
后续所有 HTTP 请求（模型 API、MCP 远程连接）走代理
```

## 11. IPC 通道清单

| 通道 | 方向 | 处理器文件 | 说明 |
|------|------|-----------|------|
| `agent:invoke` | 渲染→主 | agent.ts | 发送消息（流式） |
| `agent:resume` | 渲染→主 | agent.ts | 恢复执行（HITL 审批后） |
| `agent:interrupt` | 渲染→主 | agent.ts | 中断响应 |
| `agent:cancel` | 渲染→主 | agent.ts | 取消运行 |
| `agent:stream:${threadId}` | 主→渲染 | agent.ts | 流式事件推送 |
| `threads:list/get/create/update/delete/deleteMany/history/rewindToMessage/generateTitle` | 双向 | threads.ts | 线程管理 |
| `models:list/listProviders/getDefault/setDefault/setApiKey/getApiKey/deleteApiKey/openaiCompatible*` | 双向 | models.ts | 模型管理 |
| `workspace:get/set/select/loadFromDisk/readFile/readBinaryFile/openCurrentFolder` | 双向 | models.ts | 工作区操作 |
| `workspace:files-changed` | 主→渲染 | workspace-watcher.ts | 文件变更通知 |
| `approval:getMode/setMode/shouldAutoApprove` | 双向 | approval.ts | 审批管理 |
| `mcp:listServers/upsertServer/deleteServer/importServers/exportServers/getEnabledForThread/setEnabledForThread` | 双向 | mcp.ts | MCP 配置 |
| `skills:listSources/setSources/listWorkspaceSkillFolders/importFolder/createSkill/*` | 双向 | skills.ts | 技能管理 |
| `settings:getProxyConfig/setProxyConfig` | 双向 | settings.ts | 代理配置 |

## 12. 常见修改路线

### 12.1 新增一个 IPC 能力

1. 在 `src/main/ipc/*.ts` 注册 `ipcMain.handle(...)` 或 `ipcMain.on(...)`。
2. 在 `src/main/index.ts` 调用对应的 `register*Handlers(ipcMain)`。
3. 在 `src/preload/index.ts` 暴露到 `window.api`。
4. 在 `src/preload/index.d.ts` 补类型。
5. 由渲染层组件通过 `window.api.*` 调用。

### 12.2 改新建会话行为

1. 先看 `src/renderer/src/components/sidebar/ThreadSidebar.tsx`。
2. 再看 `src/renderer/src/lib/store.ts` 的 `createThread()` 是否需要继承更多 metadata。
3. 只有涉及持久化字段时再下探 `src/main/ipc/threads.ts` 与 `src/main/db`。
4. 若删线程后出现"无工作区"之类回归，优先核对 `deleteThreads()` 的兜底新线程逻辑。

### 12.3 改工作区文件面板

1. 入口在 `src/renderer/src/components/panels/RightPanel.tsx`。
2. 列表视图改 `WorkspaceFileListTable.tsx`。
3. 树数据改 `workspace-file-tree.ts`。
4. 如需系统文件操作，再回到 `src/main/ipc/models.ts` 的 workspace handlers。

### 12.4 改 Agent 行为或工具链

1. Agent 行为优先看 `src/main/agent/runtime.ts` 与 `system-prompt.ts`。
2. 本地文件沙箱与编码问题看 `local-sandbox.ts` 与 `text-encoding.ts`。
3. 嵌入式 bun / uv / Python 相关问题看 `tooling.ts` 与 `prepare-embedded-tooling.mjs`。
4. 工具调用错误处理看 `runtime.ts` 中的 `RuntimeToolErrorMiddleware`。

### 12.5 改审批 / HITL 行为

1. 线程级模式切换先看 `src/main/ipc/approval.ts` 与 `src/main/approval-settings.ts`。
2. UI 交互先看 `src/renderer/src/components/chat/ToolCallRenderer.tsx` 与对话区底部审批栏。
3. 若要记住"以后自动批准"，必须同步确认工作区规则文件 `.open-jarvis/approval-rules.json` 的写入逻辑（`rememberWorkspaceApproval()`）。

### 12.6 改 MCP 配置或连接方式

1. CRUD 与导入导出先看 `src/main/ipc/mcp.ts`、`src/main/mcp-config.ts`。
2. 传输实现与缓存失效看 `src/main/agent/mcp-runtime.ts`。
3. 渲染层入口在 `src/renderer/src/components/chat/MCPConfigDialog.tsx`。

### 12.7 改上下文窗口 / token 统计

1. UI 展示在 `src/renderer/src/components/chat/ContextUsageIndicator.tsx`。
2. 事件汇总与传递在 `src/renderer/src/lib/electron-transport.ts`。
3. 每线程持久化与消费在 `src/renderer/src/lib/thread-context.tsx`。
4. 模型上下文窗口配置在 `src/model-context.ts`。

### 12.8 改消息回滚功能

1. IPC 入口在 `src/main/ipc/threads.ts` 的 `threads:rewindToMessage`。
2. 检查点截断通过 `src/main/checkpointer/sqljs-saver.ts` 的 `truncateThread()` 实现。

### 12.9 改代理配置

1. UI 入口在 `src/renderer/src/components/chat/ProxyConfigDialog.tsx`。
2. IPC 在 `src/main/ipc/settings.ts`。
3. 全局分发器配置在 `src/main/proxy-config.ts`。
4. 命令执行时的代理别名注入在 `local-sandbox.ts` 的 `withProxyEnvAliases()`。

### 12.10 改 OpenAI 兼容模型配置

1. UI 入口在 `src/renderer/src/components/chat/OpenAICompatibleDialog.tsx`。
2. 配置 CRUD 在 `src/main/openai-compatible-profiles.ts`。
3. 模型实例化与消息归一化在 `src/main/agent/runtime.ts`。
4. 新增 `apiFormat` / `thinkingType` / `thinkingEffort` 字段需同步 `src/main/types.ts` 的 `OpenAICompatibleProfile`。

### 12.11 改嵌入式工具链

1. 运行时定位在 `src/main/tooling.ts`。
2. 准备脚本在 `scripts/prepare-embedded-tooling.mjs`。
3. 命令执行注入在 `src/main/agent/local-sandbox.ts`（`buildWorkspaceRuntimeCommand` / `buildWorkspaceRuntimeCommandForWindows`）。
4. 版本号变更需同步：`prepare-embedded-tooling.mjs` 中的下载 URL、`system-prompt.ts` 中的版本文案、`local-sandbox.ts` 中的错误提示。

## 13. 验证命令

常用脚本来自 `package.json`：

```bash
bun run format          # Prettier 格式化
bun run lint            # ESLint 检查
bun run typecheck:node  # 主进程 + preload TypeScript 检查
bun run typecheck:web   # 渲染进程 TypeScript 检查
bun run typecheck       # 全量 TypeScript 检查
bun run dev             # electron-vite 开发模式（热更新）
bun run build           # 类型检查 + 构建到 out/
bun run package:dir     # 生成本机可运行应用目录到 release/
bun run dist            # 生成发行包
```

嵌入式工具链准备：

```bash
bun run prepare:tooling                    # 当前平台
bun run prepare:tooling:darwin:arm64       # macOS Apple Silicon
bun run prepare:tooling:darwin:x64         # macOS Intel
bun run prepare:tooling:win:x64            # Windows x64
bun run prepare:tooling:win:arm64          # Windows arm64
bun run prepare:tooling:linux:x64          # Linux x64
bun run prepare:tooling:linux:arm64        # Linux arm64
```

提交前最少建议执行：

```bash
bun run typecheck
bun run lint
```

若只改渲染层，可先跑：

```bash
bun run typecheck:web
```

若只改主进程 / preload，可先跑：

```bash
bun run typecheck:node
```

## 14. 协作注意点

- **不要**绕过 preload 直接在渲染层引入 Electron / Node 能力。
- **不要**在主进程与沙箱里各写一套文本解码逻辑，统一走 `decodeTextBuffer()`。
- **不要**弱化 HITL、工作区权限与"只信任当前工作区"的安全提示。
- **不要**直接调用 `python/python3/pip/node/npm` 等系统命令，必须通过嵌入式 `uv` / `bun`。
- 如果只是在 UI 上新增一个按钮或状态，先找真正决策行为的组件，不要上来改 store 或 DB。
- 如果一个文件只是桥接层，优先继续追到真正计算或变更状态的代码处再动手。
- 新增 IPC 时**必须**同步三处：主进程 handler、preload 暴露、preload 类型声明。
- 流式事件处理**必须**通过 `ElectronIPCTransport` 适配，不要直接消费 IPC 事件。
- 工作区路径**必需**：`agent:invoke` 和 `agent:resume` 在缺失工作区时会返回错误。
- 改嵌入式工具链版本时，需同步 `prepare-embedded-tooling.mjs`、`system-prompt.ts`、`local-sandbox.ts` 三处。
- 代理环境变量需同时设置大小写形式（`HTTP_PROXY` / `http_proxy`），由 `withProxyEnvAliases()` 处理。
- Windows 命令执行使用 `.cmd` shim 文件，不要假设系统 PATH 中有 `uv` / `bun`。
