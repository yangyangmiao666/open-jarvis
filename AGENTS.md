# AGENTS.md — open-jarvis 代码库说明

本文档面向在本仓库内协作的开发者与代码代理，目标是提供一份可直接落地的定位图：哪些目录决定行为，哪些文件只是桥接层，改动时有哪些同步点，以及提交前最小验证动作是什么。

## 1. 总体架构

### 1.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| **Shell** | Electron 42 + electron-vite |
| **主进程** | TypeScript，Node.js 24+ |
| **渲染层** | React 19 + Tailwind CSS 4 + Radix UI + Zustand |
| **智能体运行时** | deepagents `createDeepAgent` + LangGraph |
| **检查点存储** | SqlJsSaver（每线程独立 SQLite） |
| **模型集成** | @langchain/anthropic, @langchain/openai, @langchain/google-genai |
| **MCP 集成** | @modelcontextprotocol/sdk |
| **包管理** | Bun 1.3.13（固定版本） |

### 1.2 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ App.tsx     │  │ store.ts    │  │ thread-context.tsx      │  │
│  │ (布局)      │  │ (全局状态)  │  │ (线程状态 + Stream订阅) │  │
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
│  │ (入口)      │  │ (6个模块)   │  │ (deepagents + MCP)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ DB (SQLite) │  │ Storage     │  │ Tooling (嵌入式工具链)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 顶层目录

- `src/main`：Electron 主进程、Agent 运行时、IPC、DB、配置与存储。
- `src/preload`：`window.api` 桥接层；所有 IPC 暴露都要同步这里。
- `src/renderer/src`：React UI。
- `resources/tooling`：按平台打包的 bun / uv / Python 嵌入式工具链。
- `scripts/prepare-embedded-tooling.mjs`：准备嵌入式工具链并生成 manifest。
- `release`：electron-builder 产物与本地打包输出。
- `verify_sandbox_temp`：本地验证嵌入式工具链/沙箱时使用的临时目录。

## 3. 主进程地图

### 3.1 启动入口

- `src/main/index.ts`
	- 创建 BrowserWindow，处理 macOS `trafficLightPosition` 与首屏最大化。
	- 初始化数据库 `initializeDatabase()`。
	- 注册全部 IPC：approval / agent / threads / models(workspace) / mcp / skills。
	- 退出前调用 `closeAllRuntimeResources()`，清理 agent 与 MCP 连接。

### 3.2 Agent 运行时

- `src/main/agent/runtime.ts`
	- 组装 DeepAgent、选择模型实例、绑定 system prompt、挂接 checkpoint。
	- 从线程 metadata 读取 `model`、`workspacePath`、MCP 启用状态。
	- 处理 OpenAI-compatible 历史消息归一化，避免 reasoning/content 格式差异导致崩溃。
	- Skill 源解析走 `resolveSkillSourcesForWorkspace()`。

- `src/main/agent/system-prompt.ts`
	- Agent 的基础行为约束。
	- 需要改智能体默认策略时，优先改这里而不是散落在 UI 文案中。

- `src/main/agent/local-sandbox.ts`
	- 基于 deepagents 沙箱做本地化封装。
	- 文件读取必须与主进程 `workspace:readFile` 使用同一编码策略。
	- 命令超时：120 秒；输出截断：100KB。
	- 自动注入嵌入式工具链环境变量（uv, bun, Python）。

- `src/main/agent/mcp-runtime.ts`
	- 管理 MCP 连接与工具包装。
	- 支持 `stdio`、`streamable_http`、`sse` 三种传输；远程连接支持自定义 headers。
	- 连接缓存按 `server.id + 配置签名` 维度失效；改工具命名、传输配置或连接生命周期时先看这里。
	- 工具命名归一化：`{serverName}_{toolName}`。

- `src/main/agent/types.ts`
	- Agent 类型定义，包括 `DeepAgent` 接口。

### 3.3 线程、存储与配置

- `src/main/db/index.ts`
	- 线程的 SQLite 持久化访问层。

- `src/main/checkpointer/sqljs-saver.ts`
	- 每线程独立 checkpoint 数据库。
	- 提供 `truncateThread()` 方法用于消息回滚。

- `src/main/storage.ts`
	- `~/.open-jarvis` 目录、API Key、线程 checkpoint 路径等持久化入口。

- `src/main/approval-settings.ts`
	- 线程审批模式读写，以及工作区 `.open-jarvis/approval-rules.json` 规则匹配。
	- `createApprovalSignature()` 对工具参数做归一化，避免命令细节波动导致规则失配。

- `src/main/mcp-config.ts`
	- MCP server 配置 CRUD、导入导出、线程启用状态。

- `src/main/skill-config.ts`
	- 解析全局与工作区 skill 源目录；工作区技能目录是 `.deepagents/skills`。

- `src/main/openai-compatible-profiles.ts`
	- 自定义 OpenAI 兼容模型配置读写。

- `src/main/tooling.ts`
	- 解析嵌入式工具链根目录。
	- 打包版优先走 `process.resourcesPath/tooling/<platform-arch>`。
	- 开发态回退到仓库内 `resources/tooling/<platform-arch>`。

- `src/main/text-encoding.ts`
	- `decodeTextBuffer()`：UTF-8 优先，必要时回退 GB18030。
	- Windows 中文编码兼容必须统一走这里。

- `src/main/services/title-generator.ts`
	- 首条消息生成线程标题。

- `src/main/services/workspace-watcher.ts`
	- 监听工作区文件变化并通过 `workspace:files-changed` 事件驱动 UI 刷新。

- `src/main/types.ts`
	- 主进程共享类型：Thread、StreamEvent、ModelConfig、MCP 配置、workspace IPC 参数、HITLRequest 等。

### 3.4 IPC 入口

- `src/main/ipc/agent.ts`
	- `agent:invoke`、`agent:resume`、`agent:interrupt`、`agent:cancel`。
	- 对话流、HITL 审批与取消都从这里进主进程。
	- 流式事件通过 `agent:stream:${threadId}` 通道发送。

- `src/main/ipc/approval.ts`
	- `approval:getMode`、`approval:setMode`、`approval:shouldAutoApprove`。
	- 审批模式切换与工作区自动批准判断都从这里进主进程。

- `src/main/ipc/threads.ts`
	- 线程列表、读取、创建、更新、批量删除、历史、标题生成。
	- `threads:rewindToMessage`：消息回滚，通过 `SqlJsSaver.truncateThread()` 截断检查点。

- `src/main/ipc/models.ts`
	- 模型列表、默认模型、API Key。
	- 同时承载 `workspace:get/set/select/loadFromDisk/readFile/readBinaryFile/openCurrentFolder`。
	- 这是工作区相关 IPC 的真实入口，不在单独的 workspace 文件里。

- `src/main/ipc/mcp.ts`
	- MCP server 的列表、增删改、导入导出、线程启用状态。

- `src/main/ipc/skills.ts`
	- 技能源目录、导入、创建、读写、重命名、删除。

## 4. Preload 契约

- `src/preload/index.ts`
	- 通过 `contextBridge` 暴露 `window.api`。
	- 渲染层只应通过这里访问主进程能力。
	- 流式事件订阅返回清理函数。

- `src/preload/index.d.ts`
	- `window.api` 的类型契约。
	- 任何新增 IPC 或方法签名变更，都必须同步这里，否则渲染层类型会漂移。
	- 当前 `approval`、`mcp`、`workspace`、`skills` 都已经是独立契约面，不要只改实现不改声明。

## 5. 渲染层地图

### 5.1 顶层布局

- `src/renderer/src/App.tsx`
	- 应用总布局：左侧会话栏、中间主工作区、右侧信息面板。
	- 初始化时先 `loadThreads()`；若没有任何线程，创建默认线程。
	- macOS 下顶层标题栏与主内容区做了专门的对齐处理。

- `src/renderer/src/components/WindowTitleBar.tsx`
	- 自定义标题栏占位，与主进程窗口配置保持一致。

- `src/renderer/src/components/branding/JarvisMark.tsx`
	- 品牌 Logo 组件，Gemini 风格八芒星 SVG。

### 5.2 状态层

- `src/renderer/src/lib/store.ts`
	- 全局 Zustand store。
	- 保存线程列表、当前线程 id、模型列表、provider 列表、设置弹窗状态、看板开关等。
	- `createThread()` 会继承当前线程的 `model`、`workspacePath`、`approvalMode`。
	- 删除最后一个线程时会立刻补一个新线程，避免 `currentThreadId === null` 造成工作区相关状态悬空。

- `src/renderer/src/lib/thread-context.tsx`
	- 线程内状态源：`messages`、`todos`、`workspaceFiles`、`workspacePath`、`subagents`、`pendingApproval`、`currentModel`、`tokenUsage`、`openFiles`、`activeTab`、`fileContents` 等。
	- `ThreadProvider` 为每个活跃线程挂接 `useStream()` + `ElectronIPCTransport`。
	- 新线程默认状态是消息空数组、草稿空字符串、无工作区文件、审批模式 `manual`。
	- token usage 会落到 localStorage，用于上下文窗口监控。
	- 自定义事件处理：interrupt、workspace、subagents、token_usage。

### 5.3 左侧会话栏

- `src/renderer/src/components/sidebar/ThreadSidebar.tsx`
	- 会话列表、新建、重命名、批量删除、切换到看板等。
	- 当前逻辑：点击"新会话"时，如果当前线程仍为空线程（无消息、无草稿），会复用当前线程，不再额外创建新的空会话。
	- 如果要改"新建线程"的 UX，这里是首选入口；不要先改 DB 层。

### 5.4 对话与消息

- `src/renderer/src/components/chat/ChatContainer.tsx`
	- 对话主容器，负责消息发送、流式状态、错误提示、审批状态接入。
	- 流式处理时显示动态提示，基于当前状态生成上下文相关提示信息。

- `src/renderer/src/components/chat/MessageBubble.tsx`
	- 单条消息渲染。
	- 产品文案上，助手显示为 Jarvis，用户显示为"你"。

- `src/renderer/src/components/chat/ToolCallRenderer.tsx`
	- 工具调用卡片与结果展示。
	- 待审批工具会显示专门的状态与批准/拒绝/编辑交互。

- `src/renderer/src/components/chat/StreamingMarkdown.tsx`
	- 流式 Markdown 展示。

- `src/renderer/src/components/chat/ThinkAwareMarkdown.tsx`
	- 对 reasoning / think 类内容做额外展示处理。

- `src/renderer/src/components/chat/ContextUsageIndicator.tsx`
	- 显示输入 / 输出 / 缓存 token 使用量与模型上下文窗口占比。
	- 模型上限采用 `src/model-context.ts` 中的配置；若改模型清单，最好同步这里。

- `src/renderer/src/components/chat/ModelSwitcher.tsx`
	- 当前线程模型切换。

- `src/renderer/src/components/chat/WorkspacePicker.tsx`
	- 工作区关联入口。

- `src/renderer/src/components/chat/SettingsHubDialog.tsx`
	- 设置总入口。

- `src/renderer/src/components/chat/ChatTodos.tsx`
	- 对话区任务列表展示。

- `src/renderer/src/components/chat/MCPConfigDialog.tsx`
	- MCP 服务器配置 UI。

- `src/renderer/src/components/chat/OpenAICompatibleDialog.tsx`
	- 自定义 OpenAI 兼容模型配置 UI。

- `src/renderer/src/components/chat/ApiKeyDialog.tsx`
	- API Key 配置 UI。

### 5.5 右侧面板

- `src/renderer/src/components/panels/RightPanel.tsx`
	- 右侧三段式面板：任务、文件、子智能体。
	- 每段高度可拖拽。
	- 文件区头部负责工作区路径显示、树/列表切换、关联/更换/同步按钮。
	- 当前还新增了"打开"按钮，可直接打开当前工作区文件夹。
	- 面板本身不决定数据，只消费 `thread-context` 中的 `todos` / `workspaceFiles` / `subagents`。

- `src/renderer/src/components/panels/WorkspaceFileListTable.tsx`
	- 文件列表视图，带排序、列宽持久化、目录展开。

- `src/renderer/src/components/panels/FilesystemPanel.tsx`
	- 文件系统面板组件。

- `src/renderer/src/components/panels/SkillsDialog.tsx`
	- 工作区技能管理 UI。

- `src/renderer/src/components/panels/TodoPanel.tsx`
	- todo 面板组件。

- `src/renderer/src/components/panels/SubagentPanel.tsx`
	- 子智能体状态面板组件。

### 5.6 标签页与文件预览

- `src/renderer/src/components/tabs/TabbedPanel.tsx`
	- 中间主面板容器。

- `src/renderer/src/components/tabs/TabBar.tsx`
	- 标签栏。

- `src/renderer/src/components/tabs/FileViewer.tsx`
	- 根据文件类型选择具体 viewer。

- `src/renderer/src/components/tabs/CodeViewer.tsx`
	- Shiki 代码预览。
	- CSV / TSV 走纯文本截断预览，避免大文件卡顿。

- `src/renderer/src/components/tabs/ImageViewer.tsx`
	- 图片预览。

- `src/renderer/src/components/tabs/MediaViewer.tsx`
	- 音视频预览。

- `src/renderer/src/components/tabs/PDFViewer.tsx`
	- PDF 内嵌预览。

- `src/renderer/src/components/tabs/BinaryFileViewer.tsx`
	- 二进制文件兜底提示。

- `src/renderer/src/components/chat/ShikiCodePreview.tsx`
	- Shiki 代码高亮预览组件。

### 5.7 看板

- `src/renderer/src/components/kanban`
	- `KanbanView.tsx`、`KanbanHeader.tsx`、`KanbanColumn.tsx`、`KanbanCard.tsx` 等看板相关组件。
	- 看板开关与线程列表状态仍由全局 store 驱动。

### 5.8 常用库文件

- `src/renderer/src/lib/electron-transport.ts`
	- 将主进程流事件适配为 LangGraph SDK 的 transport。
	- 实现 `UseStreamTransport` 接口。
	- 处理 LangChain 序列化格式（lc, type, id, kwargs）。
	- 提取 usage_metadata 用于上下文窗口监控。
	- 子智能体状态追踪（task 工具）。

- `src/renderer/src/lib/shiki-highlighter.ts`
	- Shiki 按需语言包加载与扩展名到语言映射。

- `src/renderer/src/lib/file-types.ts`
	- 文件类型判定，决定用哪种 viewer。

- `src/renderer/src/lib/workspace-file-tree.ts`
	- 把平铺的工作区文件列表转成树结构。

- `src/renderer/src/lib/chat-markdown.ts`
	- 会话导出 Markdown。

- `src/renderer/src/lib/workspace-utils.ts`
	- 工作区相关工具函数。

- `src/renderer/src/lib/media-blob.ts`
	- `useObjectUrlFromBase64()`：将 base64 文件数据转为 Object URL，组件卸载时自动释放。

- `src/renderer/src/lib/utils.ts`
	- `cn()`、日期格式化、截断等基础工具。

### 5.9 UI 基础组件

- `src/renderer/src/components/ui/`
	- `button.tsx`、`dialog.tsx`、`popover.tsx`、`scroll-area.tsx`、`context-menu.tsx`、`badge.tsx`、`card.tsx`、`separator.tsx`、`input.tsx`、`resizable.tsx` 等 Radix UI 封装组件。

## 6. 模型上下文窗口

- `src/model-context.ts`
	- 定义各模型的上下文窗口大小。
	- `getContextWindowForModel(modelId, configuredContextWindow)`：获取模型上下文窗口。
	- 支持的模型家族：
		- Claude: 200K
		- GPT-5: 400K, GPT-4.1: 1M, GPT-4o/4-turbo: 128K, GPT-4: 8K
		- O1/O3/O4: 200K
		- Gemini-3-pro/2.5-pro/1.5-pro: 2M, 其他 Gemini: 1M
		- DeepSeek: 64K, Qwen: 131K, GLM/ChatGLM: 128K, Minimax/ABAB: 1M
	- 默认回退：128K。

## 7. 工作区与文件处理约定

- 渲染层展示的工作区文件路径多数是 POSIX 风格，以 `/` 开头。
- 实际磁盘路径在主进程解析，渲染层不要手拼绝对系统路径后直接读文件。
- 文本文件读取必须走 `workspace:readFile` 或 `LocalSandbox`，两者都应使用 `decodeTextBuffer()`。
- 二进制文件走 `workspace:readBinaryFile`。
- 当前工作区文件夹可通过 `workspace:openCurrentFolder` 在系统文件管理器中打开。
- 工作区审批规则存放在 `.open-jarvis/approval-rules.json`，不要把这类规则误写到 `.openwork`。
- 文件变更通过 `workspace:files-changed` 事件通知渲染层。

## 8. 嵌入式工具链

- `resources/tooling/<platform-arch>` 内包含 bun、uv、Python 运行时以及 `manifest.json`。
- `scripts/prepare-embedded-tooling.mjs` 负责准备这些文件，打包脚本会在 electron-builder 之前先执行它。
	- 下载 uv、bun 可执行文件。
	- 使用 uv 安装 Python 3.12.13。
	- 重写 Python 符号链接为相对路径（macOS 打包兼容）。
	- 生成 manifest.json。
- 打包后工具链位于应用资源目录下的 `tooling/<platform-arch>`。
- `src/main/tooling.ts` 是运行时唯一可信的工具链定位入口。
- 仓库记忆补充：本项目曾验证过 macOS 打包时 Python 绝对符号链接会破坏 bundle 校验，需要在准备阶段改写或移除。

## 9. 类型与契约

- `src/main/types.ts` 定义主进程共享类型：Thread、StreamEvent、ModelConfig、MCP 配置、workspace IPC 参数、HITLRequest 等。
- `src/types.ts` 与 `src/renderer/src/types.ts` 负责渲染层消费的类型出口。
- 新增 IPC 时，至少要同步三处：主进程 handler、preload 暴露、preload 类型声明。

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
    用户点击批准/拒绝
        ↓
    handleApprovalDecision("approve" | "reject")
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

## 11. IPC 通道清单

| 通道 | 方向 | 处理器文件 | 说明 |
|------|------|-----------|------|
| `agent:invoke` | 渲染→主 | agent.ts | 发送消息 |
| `agent:resume` | 渲染→主 | agent.ts | 恢复执行 |
| `agent:interrupt` | 渲染→主 | agent.ts | 中断响应 |
| `agent:cancel` | 渲染→主 | agent.ts | 取消运行 |
| `agent:stream:${threadId}` | 主→渲染 | agent.ts | 流式事件 |
| `threads:list/get/create/update/delete/deleteMany/history/rewindToMessage/generateTitle` | 双向 | threads.ts | 线程管理 |
| `models:list/listProviders/getDefault/setDefault/setApiKey/getApiKey/deleteApiKey/openaiCompatible*` | 双向 | models.ts | 模型管理 |
| `workspace:get/set/select/loadFromDisk/readFile/readBinaryFile/openCurrentFolder` | 双向 | models.ts | 工作区操作 |
| `workspace:files-changed` | 主→渲染 | models.ts | 文件变更通知 |
| `approval:getMode/setMode/shouldAutoApprove` | 双向 | approval.ts | 审批管理 |
| `mcp:listServers/upsertServer/deleteServer/importServers/exportServers/getEnabledForThread/setEnabledForThread` | 双向 | mcp.ts | MCP 配置 |
| `skills:listSources/setSources/listWorkspaceSkillFolders/importFolder/createSkill/*` | 双向 | skills.ts | 技能管理 |

## 12. 常见修改路线

### 12.1 新增一个 IPC 能力

1. 在 `src/main/ipc/*.ts` 注册 `ipcMain.handle(...)`。
2. 在 `src/preload/index.ts` 暴露到 `window.api`。
3. 在 `src/preload/index.d.ts` 补类型。
4. 由渲染层组件通过 `window.api.*` 调用。

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

### 12.5 改审批 / HITL 行为

1. 线程级模式切换先看 `src/main/ipc/approval.ts` 与 `src/main/approval-settings.ts`。
2. UI 交互先看 `src/renderer/src/components/chat/ToolCallRenderer.tsx` 与对话区底部审批栏。
3. 若要记住"以后自动批准"，必须同步确认工作区规则文件 `.open-jarvis/approval-rules.json` 的写入逻辑。

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

## 13. 验证命令

常用脚本来自 `package.json`：

```bash
bun run format
bun run lint
bun run typecheck:node
bun run typecheck:web
bun run typecheck
bun run dev
bun run build
bun run package:dir
bun run package:mac
bun run dist
bun run dist:mac
bun run dist:win
bun run dist:linux
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

- 不要绕过 preload 直接在渲染层引入 Electron / Node 能力。
- 不要在主进程与沙箱里各写一套文本解码逻辑。
- 不要弱化 HITL、工作区权限与"只信任当前工作区"的安全提示。
- 如果只是在 UI 上新增一个按钮或状态，先找真正决策行为的组件，不要上来改 store 或 DB。
- 如果一个文件只是桥接层，优先继续追到真正计算或变更状态的代码处再动手。
- 新增 IPC 时必须同步三处：主进程 handler、preload 暴露、preload 类型声明。
- 流式事件处理必须通过 `ElectronIPCTransport` 适配，不要直接消费 IPC 事件。
