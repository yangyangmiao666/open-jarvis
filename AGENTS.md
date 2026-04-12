# AGENTS.md — 给 AI 与协作者的代码库说明

本文档概括 **open-jarvis** 仓库的技术栈、目录职责与修改时的注意点，便于在 Cursor / 自动化助手中快速定位。

## 技术栈

- **Shell**：Electron 39+，**electron-vite** 分 main / preload / renderer 构建。
- **主进程**：TypeScript；智能体基于 **deepagents** `createDeepAgent` + **LangGraph**；检查点 **SqlJsSaver**（每线程独立 DB 路径）。
- **渲染进程**：React 19、Tailwind CSS 4、Radix UI、Zustand（全局 UI / 线程列表）、**按线程的状态**在 `ThreadProvider`（`thread-context.tsx`）与 LangGraph SDK `useStream`。
- **类型**：`tsconfig.node.json`（主进程 + preload）、`tsconfig.web.json`（渲染）。

## 目录地图

| 路径 | 职责 |
|------|------|
| `src/main/index.ts` | 创建窗口、注册全部 IPC、`initializeDatabase` |
| `src/main/agent/runtime.ts` | 模型实例、system prompt、组装 DeepAgent |
| `src/main/agent/local-sandbox.ts` | 继承 deepagents 沙箱：**覆盖 `read`/`readRaw`**，用 `fs` + `decodeTextBuffer` 读文件，与 UI 侧 `workspace:readFile` 编码策略一致 |
| `src/main/text-encoding.ts` | `decodeTextBuffer`：UTF-8，含替换符时回退 GB18030 |
| `src/main/ipc/agent.ts` | 流式调用、取消、人机审批 resume |
| `src/main/ipc/threads.ts` | 会话 CRUD、历史、标题生成 |
| `src/main/ipc/models.ts` | 模型列表、密钥、**workspace:get/set/select、loadFromDisk、readFile** 等 |
| `src/main/ipc/skills.ts` | Skills 路径、创建/读/写/重命名/删除（`.deepagents/skills`） |
| `src/preload/index.ts` | 暴露 `window.api`；改 IPC 必须同步 **index.d.ts** |
| `src/renderer/src/App.tsx` | 顶层布局：左侧会话栏与中间区同列起点（相对 macOS 标题栏/标签行对齐）、可拖拽分栏宽度 |
| `src/renderer/src/lib/store.ts` | 全局：线程列表、**`createThread`（可从当前会话继承 model/workspacePath metadata）**、主题、看板开关等 |
| `src/renderer/src/lib/thread-context.tsx` | 每线程：消息草稿、工作区文件、流、pendingApproval、todos、`currentModel` 与 metadata 同步 |
| `src/renderer/src/lib/shiki-highlighter.ts` | Shiki 按需语言包与扩展名 → 语言 id（预览与工具代码块共用） |
| `src/renderer/src/lib/file-types.ts` | 按扩展名区分图片/音视频/PDF/**代码与文本**（决定走二进制还是 `CodeViewer`） |
| `src/renderer/src/lib/chat-markdown.ts` | 单条 / 整会话导出 Markdown |
| `src/renderer/src/lib/workspace-file-tree.ts` | 工作区文件列表建树（与右侧面板共用） |
| `src/renderer/src/components/tabs/CodeViewer.tsx` | 代码预览（Shiki）；**CSV/TSV** 走纯文本截断预览，避免大文件卡顿 |
| `src/renderer/src/components/tabs/PDFViewer.tsx` | PDF 内嵌预览布局（中间栏撑满） |

## 修改功能时的入口

- **新 IPC**：在对应 `src/main/ipc/*.ts` 注册 `ipcMain.handle`，在 `preload` 挂到 `api`，渲染层通过 `window.api.*` 调用。
- **对话与工具展示**：`ChatContainer.tsx`、`MessageBubble.tsx`、`ToolCallRenderer.tsx`。
- **工作区文件 UI**：`RightPanel.tsx`、`WorkspaceFileListTable.tsx`、文件树逻辑 `workspace-file-tree.ts`；树形视图 `RightPanel` 内 `FileTreeNode` 的 `memo` 需在 `expanded` 引用变化时重渲染子节点。
- **Skills UI**：`SkillsDialog.tsx`（与 `skills:*` IPC 对应）。
- **Agent 行为 / 工具 / 沙箱**：优先改 `runtime.ts`、`local-sandbox.ts`、`system-prompt`，避免直接改 `node_modules`。

## 编码与兼容性

- 工作区文本文件在主进程与 **LocalSandbox** 中应走 **`decodeTextBuffer`**，避免中文 Windows 环境下 GBK/GB18030 文件在工具卡片中乱码。
- 渲染层路径展示多为 POSIX 风格（以 `/` 开头）；实际磁盘路径由主进程解析。

## 质量检查

提交前建议执行：

```bash
bun run typecheck
bun run lint
```

打包：`bun run build`（含 typecheck + electron-vite build）。

依赖安装与脚本约定使用 **Bun**（见仓库根目录 `bun.lock` 与 `package.json` 的 `packageManager`）。

## 产品文案

- 对话中助手显示名为 **Jarvis**，用户侧为 **你**（见 `MessageBubble`）。

## 安全提示

智能体可在用户批准下读写工作区并执行命令；不要在文档或代码中弱化 HITL 与「仅信任工作区」的说明。
