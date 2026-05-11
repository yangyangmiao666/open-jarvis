# Windows 内置工具链诊断指南

## 问题症状

在Windows打包应用中，执行涉及Python/uv的命令时失败，返回：
```
[stderr] '\"...\uv.exe\"' 不是内部或外部命令，也不是可运行的程序
```

## 根本原因（已修复）

### 工具链文件的问题（已解决✅）

工具链文件本身是找到并正确加载的。日志会显示：
```
[Tooling] Using packaged embedded tooling
[Tooling] Resolved embedded tooling runtime {...uvExists:true, bunExists:true, pythonExists:true}
```

### cmd.exe 变量引用问题（已修复✅）

在Windows cmd.exe中，当变量（如`%OPEN_JARVIS_UV%`）用作**可执行命令**时，不应该被双重引号包裹。原来的代码：

```cmd
if not exist "%CD%\.venv\Scripts\python.exe" "%OPEN_JARVIS_UV%" venv ...
```

这会导致cmd.exe错误地处理引号和变量展开，产生 `'\"path\"' 不是内部或外部命令` 的错误。

**修复方案**（已应用）：

```cmd
if not exist "%CD%\.venv\Scripts\python.exe" (%OPEN_JARVIS_UV% venv "%CD%\.venv" --python %OPEN_JARVIS_PYTHON% >nul)
```

改动：
1. 去掉 `%OPEN_JARVIS_UV%` 周围的引号（变量本身处理路径）
2. 去掉 `%OPEN_JARVIS_PYTHON%` 周围的引号（路径作为参数，不需要引号）
3. 用圆括号 `(...)` 包裹整个命令块，确保cmd.exe正确处理

## 诊断步骤

如果仍然遇到问题，按以下步骤诊断：

### 步骤1：检查本地工具链是否生成

```bash
bun run prepare:tooling:win:x64
ls -la resources/tooling/win32-x64/
```

应该看到：
- manifest.json
- bin/uv.exe
- bin/bun.exe
- python/cpython-3.12.13-windows-x86_64/...

### 步骤2：检查manifest.json内容

```bash
cat resources/tooling/win32-x64/manifest.json
```

应该包含正确的路径：
```json
{
  "uv": { "path": "bin/uv.exe" },
  "bun": { "path": "bin/bun.exe" },
  "python": { "path": "python\\cpython-3.12.13-windows-x86_64-none\\python.exe" }
}
```

### 步骤3：查看应用日志中的tooling诊断

```
~/.open-jarvis/logs/main-*.log
```

查找 `[Tooling]` 日志，确认：
- 工具链根目录被找到
- 所有文件存在（uvExists, bunExists, pythonExists都是true）

### 步骤4：完整打包流程

```bash
# 清理旧构建
rm -rf out/ dist/ release/ resources/tooling/

# 重新生成工具链和打包（对于Windows x64）
bun dist:win:x64
```

### 步骤5：验证修复

安装打包后的应用，在应用对话中测试：

```powershell
# 测试Python
python --version

# 测试uv
uv --version

# 测试bun
bun --version
```

预期结果：
- `python --version` → 显示 `Python 3.12.13`
- `uv --version` → 显示 `uv 0.11.7`
- `bun --version` → 显示 `1.3.13`（来自系统）或内置bun

## 常见错误及解决

### 错误：`not found embedded tooling`

**原因**：打包时没有运行 prepare:tooling 脚本

**解决**：
```bash
bun dist:win:x64  # 这会自动运行 prepare:tooling:win:x64
```

### 错误：`不是内部或外部命令` 带有奇怪的引号

**原因**：cmd.exe 变量引用问题（已在本次修复中解决）

**解决**：确保使用最新的代码，其中 `%OPEN_JARVIS_UV%` 不被双重引号包裹

### 错误：Python venv 创建失败

**原因**：uv 或 Python 路径不正确

**诊断**：
1. 检查应用日志中的 `embeddedTooling` 部分
2. 验证 `uvPath` 和 `pythonPath` 指向实际存在的文件
3. 检查Windows长路径是否被正确处理

## 工作原理

当用户在Windows打包应用中运行Python/uv命令时：

1. **LocalSandbox** 检测命令需要Python
2. **getEmbeddedToolingRuntime()** 加载工具链配置（从manifest.json）
3. **buildWorkspaceRuntimeCommandForWindows()** 构建cmd.exe脚本：
   - 设置 PATH 包含运行时shims和embedded工具
   - 设置 `%OPEN_JARVIS_UV%`, `%OPEN_JARVIS_PYTHON%`, `%OPEN_JARVIS_BUN%` 等环境变量
   - 创建 `.venv` 虚拟环境（如果不存在）
   - 执行实际命令，此时 Python/uv 从虚拟环境或embedded tooling运行

## 最近的修复（2026-05-12）

- ✅ 修复了cmd.exe中变量作为可执行命令时的引号处理
- ✅ 改进了 `if not exist` 语句中的命令分组
- ✅ 增强了诊断日志（显示目录内容、文件存在性等）
- ✅ 优化了错误消息清晰度

## 验证修复

要验证这些修复已生效：

1. 构建并运行最新代码
2. 在对话中测试Python命令
3. 检查日志中是否有"embedded runtime is incomplete"错误
4. 如果出现错误，日志会详细显示缺失或错误的路径

