# AutoShop MCP v1.4 使用说明

## 1. 这个 MCP 怎么工作

AutoShop MCP 是给 AI 客户端使用的本地工具服务。它不会嵌入 AutoShop，也不会让 AutoShop 软件自动调用它。

调用方向是：

```text
AI 客户端 / Codex -> AutoShop MCP -> 当前打开的 AutoShop 工程文件、指令目录、PLC 通讯
```

也就是说，你在 AutoShop 里正常编写程序时，AutoShop 本身不会主动调用这个 MCP。只有当你在支持 MCP 的 AI 客户端里提问，例如“扫描当前 AutoShop 工程”“读取 MAIN 块”“分析调用关系”，AI 才会调用这些工具。

## 2. v1.4 主要升级

- 支持同时打开多个 AutoShop 工程时按 `projectName`、`windowTitleContains` 或环境变量精确选择工程。
- `autoshop_detect_open_instances` 会返回候选实例、默认选中的实例、前台窗口状态、工程路径和当前块。
- 新增 `autoshop_inspect_project_health`，用于检查工程文件、`folder.txt` 索引、CALL 调用图、通讯配置、变量表、孤立块和大文件块。
- 新增 `autoshop_export_project_snapshot`，可导出 JSON 和 Markdown 项目快照，适合在做较大修改前留档审阅。
- 工程读取类工具仍然默认只读，不会改写 AutoShop 的 `.LD`、`.FB` 或项目文件。

## 3. MCP 客户端配置

把下面配置加入支持 MCP 的客户端：

```json
{
  "mcpServers": {
    "autoshop": {
      "command": "node",
      "args": [
        "D:\\mcp\\autoshop-mcp\\dist\\index.js"
      ],
      "cwd": "D:\\mcp\\autoshop-mcp"
    }
  }
}
```

修改配置后，重启或刷新 MCP 客户端。

## 4. 多工程选择

如果只打开一个 AutoShop 工程，通常不用传 `projectPath`。

如果同时打开多个工程，建议传 `projectName`：

```json
{
  "projectName": "6.10",
  "response_format": "markdown"
}
```

也可以传窗口标题片段：

```json
{
  "windowTitleContains": "抛光\\PLC\\6.10",
  "response_format": "markdown"
}
```

还可以用环境变量指定默认工程：

```powershell
$env:AUTOSHOP_PROJECT_NAME="6.10"
# 或
$env:AUTOSHOP_PROJECT_PATH="D:\牧哲\1、程序\镜像\抛光\PLC\6.10"
```

## 5. 推荐使用流程

先打开 AutoShop，并打开目标工程。

然后在 AI 客户端里按这个顺序使用：

1. `autoshop_detect_open_instances`
2. `autoshop_scan_active_project`
3. `autoshop_run_capability_self_test`
4. `autoshop_analyze_call_graph`
5. `autoshop_inspect_project_health`
6. `autoshop_export_project_snapshot`
7. `autoshop_list_program_blocks`
8. `autoshop_read_block_source`
9. `autoshop_search_symbols`
10. `autoshop_parse_variable_tables`

常用工程读取工具：

- `autoshop_scan_active_project`
- `autoshop_scan_project`
- `autoshop_list_program_blocks`
- `autoshop_read_block_source`
- `autoshop_analyze_call_graph`
- `autoshop_inspect_project_health`
- `autoshop_export_project_snapshot`
- `autoshop_search_symbols`
- `autoshop_parse_variable_tables`

## 6. 常用示例

检测当前打开的 AutoShop：

```json
{
  "projectName": "6.10",
  "response_format": "markdown"
}
```

扫描当前工程：

```json
{
  "projectName": "6.10",
  "includeFiles": false,
  "response_format": "markdown"
}
```

读取当前块：

```json
{
  "projectName": "6.10",
  "includeRawStrings": false,
  "maxStrings": 300,
  "response_format": "markdown"
}
```

分析调用关系：

```json
{
  "projectName": "6.10",
  "maxBlocks": 250,
  "response_format": "markdown"
}
```

执行工程健康检查：

```json
{
  "projectName": "6.10",
  "maxBlocks": 250,
  "variableLimit": 500,
  "response_format": "markdown"
}
```

导出工程快照：

```json
{
  "projectName": "6.10",
  "outputDirectory": "D:\\mcp\\autoshop-snapshots\\6.10",
  "maxBlocks": 250,
  "variableLimit": 500,
  "response_format": "markdown"
}
```

搜索 `M8000`：

```json
{
  "projectName": "6.10",
  "query": "M8000",
  "limit": 20,
  "response_format": "markdown"
}
```

查询 PID 相关指令：

```json
{
  "query": "PID",
  "limit": 20,
  "response_format": "markdown"
}
```

## 7. 已验证环境

本版本已在以下环境做过烟测：

- AutoShop：V4.12.0.0.B30
- 已检测 AutoShop 实例数：3
- 目标工程：`D:\牧哲\1、程序\镜像\抛光\PLC\6.10`
- 当前块：`MAIN`
- PLC IP：`192.168.250.3`
- 工程扫描结果：67 个程序块、64 个 LD、3 个 ST、2 个 FB、26 个变量表
- 调用关系结果：69 个块参与扫描、66 条 CALL 边、0 个未解析调用
- 健康检查结果：8 项检查，7 项正常，1 项警告
- 快照导出：JSON 和 Markdown 均已通过 MCP 烟测生成
- 指令目录：`D:\Inovance Control\AutoShop\AIAssistantELinkCmd.xml`

## 8. 安全边界

工程扫描、块读取、变量解析、调用关系分析、健康检查和指令目录查询都是只读操作。

`autoshop_export_project_snapshot` 只会向你指定的输出目录写入快照文件，不会改写 AutoShop 工程。

这个 MCP 不会直接改写 AutoShop 的 `.LD` 或 `.FB` 二进制工程文件，也不会自动在 AutoShop 界面里插入梯形图。

实时 PLC 写入只通过 `autoshop_write_live_points` 完成，并且必须显式传入：

```json
{
  "confirmRisk": true
}
```

没有这个确认，写入工具会拒绝执行。
