# AutoShop MCP quickstart v1.4

## Scope

AutoShop MCP follows the workflow shape of TIA Portal Openness MCP where practical:

- L0: bootstrap, open-instance discovery, capability self-test
- L1: active project scan, block listing, block reading, call graph, health checks, symbol search, variable parsing, snapshot export
- L2: ST/ladder artifact generation, point-table validation, Modbus live point access

Unlike TIA Portal Openness, no confirmed public AutoShop automation API was found. This MCP does not directly edit AutoShop project internals or drive hidden IDE APIs. LD/FB files are proprietary binary containers, so the server performs read-only extraction of readable calls, symbols, comments, and instructions.

## Current AutoShop Workflow

1. Open AutoShop and the target project.
2. Call `autoshop_detect_open_instances`.
3. If multiple projects are open, pass `projectName`, `windowTitleContains`, or `projectPath`.
4. Call `autoshop_scan_active_project`.
5. Call `autoshop_run_capability_self_test`.
6. Call `autoshop_analyze_call_graph`.
7. Call `autoshop_inspect_project_health`.
8. Use `autoshop_export_project_snapshot` before larger AI-assisted edits.
9. Use the project tools:
   - `autoshop_list_program_blocks`
   - `autoshop_read_block_source`
   - `autoshop_search_symbols`
   - `autoshop_parse_variable_tables`

`autoshop_read_block_source` can omit `blockName`; it reads the active block from the AutoShop window title.

## Project Selection

Most project tools accept the same selector fields:

```json
{
  "projectName": "6.10",
  "windowTitleContains": "抛光\\PLC\\6.10",
  "projectPath": "D:\\牧哲\\1、程序\\镜像\\抛光\\PLC\\6.10"
}
```

Selector priority is explicit argument first, then environment variables, then foreground AutoShop project, then newest valid AutoShop project.

Supported environment variables:

- `AUTOSHOP_PROJECT_PATH`
- `AUTOSHOP_PROJECT_NAME`
- `AUTOSHOP_WINDOW_TITLE`

## Local Validation

Validated against open AutoShop V4.12.0.0.B30 projects:

- Detected AutoShop instances: 3
- Selected project: `D:\牧哲\1、程序\镜像\抛光\PLC\6.10`
- Active block: `MAIN`
- Configured PLC IP: `192.168.250.3`
- Project scan: 67 program blocks, 64 LD blocks, 3 ST blocks, 2 FB blocks, 26 variable tables
- CALL graph: 69 blocks scanned, 66 CALL edges, 0 unresolved calls
- Health checks: 8 checks, 7 ok, 1 warning
- Snapshot export: JSON and Markdown artifacts generated through MCP
- Instruction catalog: read from `D:\Inovance Control\AutoShop\AIAssistantELinkCmd.xml`

## Safety

Project and catalog tools are read-only. Snapshot export writes only to the selected output directory. `autoshop_write_live_points` is the only live write tool and requires `confirmRisk=true`.
