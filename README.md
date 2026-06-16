# autoshop-mcp-server v1.2

MCP server for Inovance AutoShop engineering workflows.

This server is modeled after the TIA Portal Openness MCP workflow shape, but AutoShop does not expose a confirmed Openness-style public automation API. The implementation therefore focuses on safe, useful capabilities:

- detect the currently open AutoShop window and active project
- inspect AutoShop project files without modifying them
- list and read LD/ST/FB blocks
- extract CALL relationships, symbols, comments, and variable records
- read the AutoShop AI instruction catalog
- generate ST and ladder review artifacts for manual implementation
- read, write, and monitor live PLC points over Modbus TCP

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

## MCP client config

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

## Chinese user guide

See `docs\autoshop-mcp-v1.2-user-guide.md` for a Chinese setup and usage guide.

## Recommended workflow

When AutoShop is already open:

1. Call `autoshop_detect_open_instances`.
2. Call `autoshop_scan_active_project`.
3. Call `autoshop_analyze_call_graph`.
4. Use `autoshop_list_program_blocks`, `autoshop_read_block_source`, `autoshop_search_symbols`, and `autoshop_parse_variable_tables`.

The core project tools can omit `projectPath`; they will use the active AutoShop window. `autoshop_read_block_source` can also omit `blockName`; it will read the active block shown in the AutoShop title bar.

Tested active project:

```json
{
  "projectPath": "D:\\牧哲\\1、程序\\镜像\\抛光\\PLC\\111",
  "activeBlock": "MAIN",
  "plcIp": "192.168.250.3"
}
```

## Ladder and ST

Use `examples\ladder.start-stop.json` as a start/stop rung example. The server returns an ASCII ladder diagram plus equivalent ST so the logic can be reviewed and recreated in AutoShop.

AutoShop `.LD` and `.FB` files are proprietary binary containers. The project tools extract readable calls, instructions, comments, and symbols, but they do not claim lossless native LAD import/export.

## Safety

Project inspection tools are read-only. Live write operations require `confirmRisk=true`.
