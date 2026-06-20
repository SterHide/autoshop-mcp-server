# AutoShop MCP v1.5 使用说明

## 1. v1.5 的核心目标

v1.5 的核心目标是：把用户当成 PLC 小白，也能通过 MCP 读懂 AutoShop 工程。

它不是让 AutoShop 自动调用 MCP，也不是自动改 PLC 程序。调用方向仍然是：

```text
AI 客户端 / Codex -> AutoShop MCP -> 当前打开的 AutoShop 工程文件、指令目录、PLC 通讯
```

你在 AI 客户端里问：

- “帮我读懂当前 PLC 程序”
- “MAIN 里面每个 CALL 是什么意思”
- “这个块控制什么”
- “哪些变量像启动、停止、报警、复位”

AI 才会调用 MCP 工具读取工程并解释。

## 2. v1.5 新增内容

- 新增 `autoshop_explain_project_for_beginner`
  - 面向新手解释整个工程。
  - 告诉你应该先看 `MAIN`，再按哪些子程序顺序看。
  - 汇总程序块数量、CALL 调用、变量线索、PLC 地址类型和下一步问题。

- 新增 `autoshop_explain_block_for_beginner`
  - 面向新手解释一个块，比如 `MAIN` 或 `SBR_B0_主程序`。
  - 解释这个块可能负责什么。
  - 解释 `LD/ST/FB` 是什么。
  - 解释 `CALL`、`SET`、`RST`、`MOV`、`TON` 等常见指令。
  - 解释 `X/Y/M/D/T/C` 地址大概代表什么。

- 改进多工程选择安全性
  - 如果你指定 `projectName`，但当前没打开这个工程，MCP 会报错并列出可选工程。
  - 不再静默切换到另一个打开的工程，避免读错 PLC。

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

## 4. 推荐新手流程

先打开 AutoShop，并打开目标工程。

然后在 AI 客户端里按这个顺序使用：

1. `autoshop_detect_open_instances`
2. `autoshop_explain_project_for_beginner`
3. `autoshop_explain_block_for_beginner`，先解释 `MAIN`
4. `autoshop_search_symbols`，搜索启动、停止、报警、复位、手动、自动等关键词
5. `autoshop_parse_variable_tables`，查变量表里的地址和注释
6. `autoshop_analyze_call_graph`，看程序调用关系
7. `autoshop_read_block_source`，需要更底层内容时再用

## 5. 常用示例

检测当前打开的 AutoShop 工程：

```json
{
  "response_format": "markdown"
}
```

如果打开了多个工程，指定工程名：

```json
{
  "projectName": "6#PLC",
  "response_format": "markdown"
}
```

让 AI 用新手方式解释整个工程：

```json
{
  "projectName": "6#PLC",
  "maxBlocks": 250,
  "variableLimit": 80,
  "response_format": "markdown"
}
```

解释 `MAIN`：

```json
{
  "projectName": "6#PLC",
  "blockName": "MAIN",
  "response_format": "markdown"
}
```

解释某个子程序：

```json
{
  "projectName": "6#PLC",
  "blockName": "SBR_B0_主程序",
  "response_format": "markdown"
}
```

搜索报警：

```json
{
  "projectName": "6#PLC",
  "query": "报警",
  "limit": 20,
  "response_format": "markdown"
}
```

搜索常见运行标志：

```json
{
  "projectName": "6#PLC",
  "query": "M8000",
  "limit": 20,
  "response_format": "markdown"
}
```

## 6. 小白读 PLC 的基本方法

先记住这几个概念：

- `MAIN`：主程序入口，优先从这里开始。
- `CALL`：调用子程序，可以理解为“去看另一个章节”。
- `SBR`：子程序，通常被 `MAIN` 或其他块调用。
- `LD`：梯形图，按“条件触点 -> 输出线圈/指令”阅读。
- `ST`：结构化文本，像代码一样阅读。
- `FB`：功能块，常用于封装气缸、电机、按钮等复用逻辑。
- `X`：外部输入，比如按钮、传感器、到位开关。
- `Y`：外部输出，比如电磁阀、指示灯、接触器。
- `M`：内部辅助位，比如运行状态、步骤标志、允许条件。
- `D`：数据寄存器，比如参数、计数、位置、触摸屏数据。
- `T`：定时器。
- `C`：计数器。

推荐读法：

1. 先看 `MAIN`。
2. 按 `MAIN` 里的 CALL 顺序看子程序。
3. 每个子程序先看名字，比如“初始化”“主程序”“模式选择”“数据处理”。
4. 遇到 `X/Y/M/D/T/C` 地址，去变量表里找中文注释。
5. 最后再看报警、互锁、复位和手自动逻辑。

## 7. 已验证环境

本版本已在以下环境做过烟测：

- AutoShop：V4.12.0.0.B30
- 已检测 AutoShop 实例数：3
- 烟测工程：`6#PLC`
- 当前块：`MAIN`
- MCP 工具数：22
- 新手工程导读：可返回 `MAIN` 和 MAIN CALL 阅读顺序
- 新手块导读：可解释 `MAIN`，返回指令提示和符号提示
- 严格工程选择：传入不存在的 `projectName` 会返回错误并列出当前可选工程

## 8. 安全边界

工程导读、块导读、扫描、搜索、变量解析、调用关系分析、健康检查和指令目录查询都是只读操作。

这个 MCP 不会直接改写 AutoShop 的 `.LD` 或 `.FB` 二进制工程文件，也不会自动在 AutoShop 界面里插入梯形图。

实时 PLC 写入只通过 `autoshop_write_live_points` 完成，并且必须显式传入：

```json
{
  "confirmRisk": true
}
```

没有这个确认，写入工具会拒绝执行。
