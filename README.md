# autoshop-mcp-server v1.4

MCP server for Inovance AutoShop engineering workflows.

This server follows the workflow shape of TIA Portal Openness MCP where practical, but AutoShop does not expose a confirmed Openness-style public automation API. The implementation therefore focuses on safe capabilities that are useful while AutoShop is open:

- detect open AutoShop windows and select the intended project
- inspect AutoShop project files without modifying them
- list and read LD/ST/FB blocks
- extract CALL relationships, symbols, comments, and variable records
- run project health checks and export review snapshots
- read the AutoShop AI instruction catalog
- generate ST and ladder review artifacts for manual implementation
- read, write, and monitor live PLC points over Modbus TCP

## v1.4 Highlights

- Multi-instance project selection with `projectName`, `windowTitleContains`, `AUTOSHOP_PROJECT_NAME`, `AUTOSHOP_PROJECT_PATH`, and `AUTOSHOP_WINDOW_TITLE`.
- Foreground/window-aware AutoShop instance detection, with newest valid project fallback.
- New `autoshop_inspect_project_health` tool for folder index, call graph, variable table, communication config, orphan block, and large block checks.
- New `autoshop_export_project_snapshot` tool that writes JSON and Markdown project snapshots.
- Updated MCP manifest and Chinese user guide.

## Tools

Orientation and current-project context:

- `autoshop_bootstrap`
- `autoshop_detect_open_instances`
- `autoshop_scan_active_project`
- `autoshop_run_capability_self_test`
- `autoshop_list_instruction_catalog`

Project inspection:

- `autoshop_scan_project`
- `autoshop_list_program_blocks`
- `autoshop_read_block_source`
- `autoshop_analyze_call_graph`
- `autoshop_inspect_project_health`
- `autoshop_export_project_snapshot`
- `autoshop_search_symbols`
- `autoshop_parse_variable_tables`

Generation and validation:

- `autoshop_validate_point_table`
- `autoshop_generate_st_source`
- `autoshop_generate_ladder`
- `autoshop_scaffold_project_bundle`

Live PLC access:

- `autoshop_read_live_points`
- `autoshop_write_live_points`
- `autoshop_monitor_live_points`

## Run

```powershell
cd D:\mcp\autoshop-mcp
npm install
npm run build
npm start
```

Default transport is stdio. HTTP mode:

```powershell
$env:TRANSPORT="http"
$env:PORT="3000"
npm start
```

## MCP Client Config

```json
{
  "mcpServers": {
    "autoshop": {
      "command": "node",
      "args": ["D:\\mcp\\autoshop-mcp\\dist\\index.js"],
      "cwd": "D:\\mcp\\autoshop-mcp"
    }
  }
}
```

## Chinese User Guide

See `docs\autoshop-mcp-v1.4-user-guide.md` for a Chinese setup and usage guide.

## Recommended Workflow

When AutoShop is already open:

1. Call `autoshop_detect_open_instances`.
2. Call `autoshop_scan_active_project`.
3. Call `autoshop_run_capability_self_test`.
4. Call `autoshop_analyze_call_graph`.
5. Call `autoshop_inspect_project_health`.
6. Export a snapshot with `autoshop_export_project_snapshot` before larger AI-assisted work.
7. Use `autoshop_list_program_blocks`, `autoshop_read_block_source`, `autoshop_search_symbols`, and `autoshop_parse_variable_tables`.

The core project tools can omit `projectPath`; they will select an open AutoShop project. When multiple AutoShop projects are open, pass `projectName`, for example:

```json
{
  "projectName": "6.10",
  "response_format": "markdown"
}
```

`autoshop_read_block_source` can also omit `blockName`; it reads the active block shown in the AutoShop title bar.

## Tested Project

```json
{
  "autoShopVersion": "4.12.0.0.B30",
  "projectPath": "D:\\牧哲\\1、程序\\镜像\\抛光\\PLC\\6.10",
  "activeBlock": "MAIN",
  "plcIp": "192.168.250.3",
  "programs": 67,
  "callEdges": 66,
  "unresolvedCalls": 0,
  "healthChecks": "7 ok, 1 warning"
}
```

## Ladder and ST

Use `examples\ladder.start-stop.json` as a start/stop rung example. The server returns an ASCII ladder diagram plus equivalent ST so the logic can be reviewed and recreated in AutoShop.

AutoShop `.LD` and `.FB` files are proprietary binary containers. The project tools extract readable calls, instructions, comments, and symbols, but they do not claim lossless native LAD import/export.

## Safety

Project inspection, call graph, health checks, and snapshot export do not modify AutoShop project files. Snapshot export only writes files to the chosen output folder. Live write operations require `confirmRisk=true`.
