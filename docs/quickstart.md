# AutoShop MCP quickstart v1.2

## Scope

AutoShop MCP follows the workflow shape of TIA Portal Openness MCP where practical:

- L0: bootstrap, open-instance discovery, capability self-test
- L1: active project scan, block listing, block reading, call graph, symbol search, variable parsing
- L2: ST/ladder artifact generation, point-table validation, Modbus live point access

Unlike TIA Portal Openness, no confirmed public AutoShop automation API was found. This MCP does not directly edit AutoShop project internals or drive hidden IDE APIs. LD/FB files are proprietary binary containers, so the server performs read-only extraction of readable calls, symbols, comments, and instructions.

## Current AutoShop workflow

1. Open AutoShop and the target project.
2. Call `autoshop_detect_open_instances`.
3. Call `autoshop_scan_active_project`.
4. Call `autoshop_analyze_call_graph`.
5. Use the project tools without passing `projectPath`:
   - `autoshop_list_program_blocks`
   - `autoshop_read_block_source`
   - `autoshop_search_symbols`
   - `autoshop_parse_variable_tables`

`autoshop_read_block_source` can omit `blockName`; it reads the active block from the AutoShop window title.

## Local validation

Validated against an open AutoShop V4.12.0.0.B30 project:

- Project: `D:\牧哲\1、程序\镜像\抛光\PLC\111`
- Active block: `MAIN`
- Configured PLC IP: `192.168.250.3`
- Project scan: 67 program blocks, 64 LD blocks, 3 ST blocks, 2 FB blocks, 26 variable tables
- CALL graph: 69 blocks scanned, 66 CALL edges, 0 unresolved calls
- Instruction catalog: read from `D:\Inovance Control\AutoShop\AIAssistantELinkCmd.xml`

## Safety

Project and catalog tools are read-only. `autoshop_write_live_points` is the only live write tool and requires `confirmRisk=true`.
