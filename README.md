# autoshop-mcp-server v1.5.1

MCP server for helping users understand and inspect Inovance AutoShop PLC projects.

The core goal of v1.5 is beginner readability: a PLC novice should be able to ask an AI client to explain an open AutoShop project, understand where to start, follow `MAIN` into subroutines, and identify common PLC addresses such as `X`, `Y`, `M`, `D`, `T`, and `C`.

AutoShop does not expose a confirmed Openness-style public automation API. This server therefore focuses on safe capabilities:

- detect open AutoShop windows and select the intended project
- explain an AutoShop project for a PLC beginner
- explain one AutoShop block for a PLC beginner
- inspect AutoShop project files without modifying them
- list and read LD/ST/FB blocks
- extract CALL relationships, symbols, comments, and variable records
- run project health checks and export review snapshots
- generate ST and ladder review artifacts for manual implementation
- read, write, and monitor live PLC points over Modbus TCP

## v1.5 Highlights

- New `autoshop_explain_project_for_beginner` tool: explains where to start, what `MAIN` calls, program areas, variable hints, PLC glossary, and recommended next questions.
- New `autoshop_explain_block_for_beginner` tool: explains one block's role, LD/ST/FB meaning, CALLs, common instructions, and address symbols.
- Safer multi-project selection: if `projectName`, `projectPath`, or `windowTitleContains` is explicitly provided but does not match an open AutoShop project, the MCP returns an error with available projects instead of silently falling back.
- Better Chinese comment keyword extraction for beginner explanations.

## v1.5.1 Patch

- `autoshop_read_block_source` now reads LD/FB binary strings without the old default `maxStrings` cap.
- The optional `maxStrings` parameter remains available when callers want an explicit temporary limit.
- Block previews and extracted instruction/call/symbol summaries no longer apply the previous read-block truncation.

## Tools

Beginner reading workflow:

- `autoshop_detect_open_instances`
- `autoshop_explain_project_for_beginner`
- `autoshop_explain_block_for_beginner`

Orientation and current-project context:

- `autoshop_bootstrap`
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

## Recommended Beginner Workflow

When AutoShop is already open:

1. Call `autoshop_detect_open_instances`.
2. If more than one project is open, pick the exact `projectName`, for example `6#PLC`.
3. Call `autoshop_explain_project_for_beginner`.
4. Call `autoshop_explain_block_for_beginner` for `MAIN`.
5. Ask follow-up questions from the tool's `next_questions`.
6. Use `autoshop_search_symbols` to search start, stop, alarm, reset, `M8000`, `X`, `Y`, `M`, or `D` addresses.
7. Use `autoshop_parse_variable_tables` to map addresses back to comments or variable names.

Example:

```json
{
  "projectName": "6#PLC",
  "response_format": "markdown"
}
```

## Safety

Project explanation, project inspection, call graph, health checks, and snapshot export do not modify AutoShop project files. Snapshot export only writes files to the chosen output folder. Live write operations require `confirmRisk=true`.

AutoShop `.LD` and `.FB` files are proprietary binary containers. This MCP extracts readable calls, instructions, comments, and symbols, but it does not claim lossless native LAD import/export.

## Chinese User Guide

See `docs\autoshop-mcp-v1.5-user-guide.md` for a Chinese setup and usage guide.
