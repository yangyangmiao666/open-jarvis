# AGENTS.md — open-jarvis 代码库说明

本文档面向在本仓库内协作的开发者与代码代理，目标是提供一份可直接落地的定位图：哪些目录决定行为，哪些文件只是桥接层，改动时有哪些同步点，以及提交前最小验证动作是什么。

## 1. 总体架构

- Shell：Electron 41 + electron-vite，按 main / preload / renderer 三段构建。
- 主进程：TypeScript，负责窗口、IPC、线程数据、模型与工作区文件访问、嵌入式工具链解析。
- 智能体运行时：deepagents `createDeepAgent` + LangGraph；每个线程使用独立的 `SqlJsSaver` 检查点。
- 渲染层：React 19 + Tailwind CSS 4 + Radix UI + Zustand。
- 状态分层：全局 UI 与线程列表在 `store.ts`；线程内消息、草稿、文件、todo、subagent、审批态、token usage 在 `thread-context.tsx`。
- 包管理与脚本：统一使用 Bun，根目录 `packageManager` 固定为 `bun@1.3.13`。

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

- `src/main/agent/mcp-runtime.ts`
	- 管理 MCP 连接与工具包装。
	- 支持 `stdio`、`streamable_http`、`sse` 三种传输；远程连接支持自定义 headers。
	- 连接缓存按 `server.id + 配置签名` 维度失效；改工具命名、传输配置或连接生命周期时先看这里。

### 3.3 线程、存储与配置

- `src/main/db`
	- 线程的 SQLite 持久化访问层。

- `src/main/checkpointer/sqljs-saver.ts`
	- 每线程独立 checkpoint 数据库。

- `src/main/storage.ts`
	- `.openwork` 目录、API Key、线程 checkpoint 路径等持久化入口。

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
	- 监听工作区文件变化并驱动 UI 刷新。

### 3.4 IPC 入口

- `src/main/ipc/agent.ts`
	- `agent:invoke`、`agent:resume`、`agent:interrupt`、`agent:cancel`。
	- 对话流、HITL 审批与取消都从这里进主进程。

- `src/main/ipc/approval.ts`
	- `approval:getMode`、`approval:setMode`、`approval:shouldAutoApprove`。
	- 审批模式切换与工作区自动批准判断都从这里进主进程。

- `src/main/ipc/threads.ts`
	- 线程列表、读取、创建、更新、批量删除、历史、标题生成。

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

### 5.2 状态层

- `src/renderer/src/lib/store.ts`
	- 全局 Zustand store。
	- 保存线程列表、当前线程 id、模型列表、provider 列表、设置弹窗状态、看板开关等。
	- `createThread()` 会继承当前线程的 `model`、`workspacePath`、`approvalMode`。
	- 删除最后一个线程时会立刻补一个新线程，避免 `currentThreadId === null` 造成工作区相关状态悬空。

- `src/renderer/src/lib/thread-context.tsx`
	- 线程内状态源：`messages`、`draftInput`、`todos`、`workspaceFiles`、`workspacePath`、`subagents`、`pendingApproval`、`currentModel`、`tokenUsage` 等。
	- `ThreadProvider` 为每个活跃线程挂接 `useStream()`。
	- 新线程默认状态是消息空数组、草稿空字符串、无工作区文件、审批模式 `manual`。
	- token usage 会落到 localStorage，用于上下文窗口监控。

### 5.3 左侧会话栏

- `src/renderer/src/components/sidebar/ThreadSidebar.tsx`
	- 会话列表、新建、重命名、批量删除、切换到看板等。
	- 当前逻辑：点击“新会话”时，如果当前线程仍为空线程（无消息、无草稿），会复用当前线程，不再额外创建新的空会话。
	- 如果要改“新建线程”的 UX，这里是首选入口；不要先改 DB 层。

### 5.4 对话与消息

- `src/renderer/src/components/chat/ChatContainer.tsx`
	- 对话主容器，负责消息发送、流式状态、错误提示、审批状态接入。

- `src/renderer/src/components/chat/MessageBubble.tsx`
	- 单条消息渲染。
	- 产品文案上，助手显示为 Jarvis，用户显示为“你”。

- `src/renderer/src/components/chat/ToolCallRenderer.tsx`
	- 工具调用卡片与结果展示。
	- 待审批工具会显示专门的状态与批准/拒绝/编辑交互。

- `src/renderer/src/components/chat/StreamingMarkdown.tsx`
	- 流式 Markdown 展示。

- `src/renderer/src/components/chat/ThinkAwareMarkdown.tsx`
	- 对 reasoning / think 类内容做额外展示处理。

- `src/renderer/src/components/chat/ContextUsageIndicator.tsx`
	- 显示输入 / 输出 / 缓存 token 使用量与模型上下文窗口占比。
	- 模型上限采用内置近似值；若改模型清单，最好同步这里。

- `src/renderer/src/components/chat/ModelSwitcher.tsx`
	- 当前线程模型切换。

- `src/renderer/src/components/chat/WorkspacePicker.tsx`
	- 工作区关联入口。

- `src/renderer/src/components/chat/SettingsHubDialog.tsx`
	- 设置总入口。

### 5.5 右侧面板

- `src/renderer/src/components/panels/RightPanel.tsx`
	- 右侧三段式面板：任务、文件、子智能体。
	- 每段高度可拖拽。
	- 文件区头部负责工作区路径显示、树/列表切换、关联/更换/同步按钮。
	- 当前还新增了“打开”按钮，可直接打开当前工作区文件夹。
	- 面板本身不决定数据，只消费 `thread-context` 中的 `todos` / `workspaceFiles` / `subagents`。

- `src/renderer/src/components/panels/WorkspaceFileListTable.tsx`
	- 文件列表视图，带排序、列宽持久化、目录展开。

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

### 5.7 看板

- `src/renderer/src/components/kanban`
	- `KanbanView.tsx`、`KanbanHeader.tsx` 等看板相关组件。
	- 看板开关与线程列表状态仍由全局 store 驱动。

### 5.8 常用库文件

- `src/renderer/src/lib/electron-transport.ts`
	- 将主进程流事件适配为 LangGraph SDK 的 transport。

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

- `src/renderer/src/lib/utils.ts`
	- `cn()`、日期格式化、截断等基础工具。

## 6. 工作区与文件处理约定

- 渲染层展示的工作区文件路径多数是 POSIX 风格，以 `/` 开头。
- 实际磁盘路径在主进程解析，渲染层不要手拼绝对系统路径后直接读文件。
- 文本文件读取必须走 `workspace:readFile` 或 `LocalSandbox`，两者都应使用 `decodeTextBuffer()`。
- 二进制文件走 `workspace:readBinaryFile`。
- 当前工作区文件夹可通过 `workspace:openCurrentFolder` 在系统文件管理器中打开。
- 工作区审批规则存放在 `.open-jarvis/approval-rules.json`，不要把这类规则误写到 `.openwork`。

## 7. 嵌入式工具链

- `resources/tooling/<platform-arch>` 内包含 bun、uv、Python 运行时以及 `manifest.json`。
- `scripts/prepare-embedded-tooling.mjs` 负责准备这些文件，打包脚本会在 electron-builder 之前先执行它。
- 打包后工具链位于应用资源目录下的 `tooling/<platform-arch>`。
- `src/main/tooling.ts` 是运行时唯一可信的工具链定位入口。
- 仓库记忆补充：本项目曾验证过 macOS 打包时 Python 绝对符号链接会破坏 bundle 校验，需要在准备阶段改写或移除。

## 8. 类型与契约

- `src/main/types.ts` 定义主进程共享类型：Thread、StreamEvent、ModelConfig、MCP 配置、workspace IPC 参数等。
- `src/types.ts` 与 `src/renderer/src/types.ts` 负责渲染层消费的类型出口。
- 新增 IPC 时，至少要同步三处：主进程 handler、preload 暴露、preload 类型声明。

## 9. 常见修改路线

### 9.1 新增一个 IPC 能力

1. 在 `src/main/ipc/*.ts` 注册 `ipcMain.handle(...)`。
2. 在 `src/preload/index.ts` 暴露到 `window.api`。
3. 在 `src/preload/index.d.ts` 补类型。
4. 由渲染层组件通过 `window.api.*` 调用。

### 9.2 改新建会话行为

1. 先看 `src/renderer/src/components/sidebar/ThreadSidebar.tsx`。
2. 再看 `src/renderer/src/lib/store.ts` 的 `createThread()` 是否需要继承更多 metadata。
3. 只有涉及持久化字段时再下探 `src/main/ipc/threads.ts` 与 `src/main/db`。
4. 若删线程后出现“无工作区”之类回归，优先核对 `deleteThreads()` 的兜底新线程逻辑。

### 9.3 改工作区文件面板

1. 入口在 `src/renderer/src/components/panels/RightPanel.tsx`。
2. 列表视图改 `WorkspaceFileListTable.tsx`。
3. 树数据改 `workspace-file-tree.ts`。
4. 如需系统文件操作，再回到 `src/main/ipc/models.ts` 的 workspace handlers。

### 9.4 改 Agent 行为或工具链

1. Agent 行为优先看 `src/main/agent/runtime.ts` 与 `system-prompt.ts`。
2. 本地文件沙箱与编码问题看 `local-sandbox.ts` 与 `text-encoding.ts`。
3. 嵌入式 bun / uv / Python 相关问题看 `tooling.ts` 与 `prepare-embedded-tooling.mjs`。

### 9.5 改审批 / HITL 行为

1. 线程级模式切换先看 `src/main/ipc/approval.ts` 与 `src/main/approval-settings.ts`。
2. UI 交互先看 `src/renderer/src/components/chat/ToolCallRenderer.tsx` 与对话区底部审批栏。
3. 若要记住“以后自动批准”，必须同步确认工作区规则文件 `.open-jarvis/approval-rules.json` 的写入逻辑。

### 9.6 改 MCP 配置或连接方式

1. CRUD 与导入导出先看 `src/main/ipc/mcp.ts`、`src/main/mcp-config.ts`。
2. 传输实现与缓存失效看 `src/main/agent/mcp-runtime.ts`。
3. 渲染层入口在 `src/renderer/src/components/chat/MCPConfigDialog.tsx`。

### 9.7 改上下文窗口 / token 统计

1. UI 展示在 `src/renderer/src/components/chat/ContextUsageIndicator.tsx`。
2. 事件汇总与传递在 `src/renderer/src/lib/electron-transport.ts`。
3. 每线程持久化与消费在 `src/renderer/src/lib/thread-context.tsx`。

## 10. 验证命令

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

## 11. 协作注意点

- 不要绕过 preload 直接在渲染层引入 Electron / Node 能力。
- 不要在主进程与沙箱里各写一套文本解码逻辑。
- 不要弱化 HITL、工作区权限与“只信任当前工作区”的安全提示。
- 如果只是在 UI 上新增一个按钮或状态，先找真正决策行为的组件，不要上来改 store 或 DB。
- 如果一个文件只是桥接层，优先继续追到真正计算或变更状态的代码处再动手。
