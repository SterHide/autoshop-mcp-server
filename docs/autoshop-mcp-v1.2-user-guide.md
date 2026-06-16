# AutoShop MCP v1.2 使用说明

## 1. 这个 MCP 能做什么

AutoShop MCP 是给 AI 客户端使用的本地工具服务。它不会嵌入 AutoShop，也不会让 AutoShop 软件自动调用它。

调用方向是：

```text
AI 客户端 / Codex -> AutoShop MCP -> 当前打开的 AutoShop 工程文件、指令目录、PLC 通讯
```

适合做这些工作：

- 识别当前打开的 AutoShop 工程路径和当前程序块。
- 扫描工程里的 LD、ST、FB 程序块。
- 读取当前块或指定块的可读内容。
- 分析 `MAIN` 到各个 `SBR_*` 的 CALL 调用关系。
- 搜索 `M8000`、`D100`、报警文字、子程序名等符号。
- 解析变量表、地址变量表和 CSV 表。
- 查询 AutoShop 自带 AI 指令目录。
- 生成 ST 源码、梯形图审阅稿和点表文件。
- 通过 Modbus TCP 读取、监控、写入 PLC 点位。

## 2. v1.2 主要变化

- 新增当前 AutoShop 窗口识别能力。
- 新增当前工程自动扫描工具。
- 新增 MCP 能力自检工具。
- 新增 AutoShop 指令目录读取工具。
- 新增程序块 CALL 调用关系分析工具。
- 工程读取类工具可以省略 `projectPath`，默认使用当前打开的 AutoShop 工程。
- `autoshop_read_block_source` 可以省略 `blockName`，默认读取 AutoShop 标题栏显示的当前块。
- 修复 AutoShop 常见 UTF-8 / GB18030 文本解码问题，中文块名、路径、网卡名可正常显示。

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

## 4. 推荐使用流程

先打开 AutoShop，并打开目标工程。

然后在 AI 客户端里按这个顺序使用：

1. `autoshop_detect_open_instances`
2. `autoshop_scan_active_project`
3. `autoshop_run_capability_self_test`
4. `autoshop_analyze_call_graph`
5. `autoshop_list_program_blocks`
6. `autoshop_read_block_source`
7. `autoshop_search_symbols`
8. `autoshop_parse_variable_tables`

如果 AutoShop 当前已经打开工程，下面这些工具通常不用传 `projectPath`：

- `autoshop_list_program_blocks`
- `autoshop_read_block_source`
- `autoshop_analyze_call_graph`
- `autoshop_search_symbols`
- `autoshop_parse_variable_tables`

## 5. 常用示例

读取当前打开的 AutoShop 信息：

```json
{
  "response_format": "markdown"
}
```

读取当前块：

```json
{
  "includeRawStrings": false,
  "maxStrings": 300,
  "response_format": "markdown"
}
```

搜索 `M8000`：

```json
{
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

分析调用关系：

```json
{
  "maxBlocks": 250,
  "response_format": "markdown"
}
```

## 6. 已验证环境

本版本已在以下环境做过烟测：

- AutoShop：V4.12.0.0.B30
- 工程：`D:\牧哲\1、程序\镜像\抛光\PLC\111`
- 当前块：`MAIN`
- PLC IP：`192.168.250.3`
- 工程扫描结果：67 个程序块、64 个 LD、3 个 ST、2 个 FB、26 个变量表
- 调用关系结果：69 个块参与扫描、66 条 CALL 边、0 个未解析调用
- 指令目录：`D:\Inovance Control\AutoShop\AIAssistantELinkCmd.xml`

## 7. 安全边界

工程扫描、块读取、变量解析、调用关系分析和指令目录查询都是只读操作。

这个 MCP 不会直接改写 AutoShop 的 `.LD` 或 `.FB` 二进制工程文件，也不会自动在 AutoShop 界面里插入梯形图。

实时 PLC 写入只通过 `autoshop_write_live_points` 完成，并且必须显式传入：

```json
{
  "confirmRisk": true
}
```

没有这个确认，写入工具会拒绝执行。
