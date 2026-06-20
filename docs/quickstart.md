# AutoShop MCP quickstart v1.5

## Scope

AutoShop MCP v1.5 is optimized for one primary workflow: help a PLC beginner understand an open AutoShop project.

- L0: bootstrap, open-instance discovery, capability self-test
- L1: beginner project guide, beginner block guide, active project scan, block listing, block reading, call graph, health checks, symbol search, variable parsing, snapshot export
- L2: ST/ladder review artifact generation, point-table validation, Modbus live point access

Unlike TIA Portal Openness, no confirmed public AutoShop automation API was found. This MCP does not directly edit AutoShop project internals or drive hidden IDE APIs.

## Beginner Workflow

1. Open AutoShop and the target project.
2. Call `autoshop_detect_open_instances`.
3. If multiple projects are open, choose the exact `projectName`, `windowTitleContains`, or `projectPath`.
4. Call `autoshop_explain_project_for_beginner`.
5. Call `autoshop_explain_block_for_beginner` with `blockName: "MAIN"`.
6. Follow the returned `next_questions` and `suggested_next_steps`.
7. Use lower-level tools only when needed:
   - `autoshop_analyze_call_graph`
   - `autoshop_search_symbols`
   - `autoshop_parse_variable_tables`
   - `autoshop_read_block_source`

## Project Selection Safety

Most project tools accept:

```json
{
  "projectName": "6#PLC",
  "windowTitleContains": "6-8\\6#PLC",
  "projectPath": "D:\\牧哲\\1、程序\\触摸屏中译英\\6-8(2)\\6-8\\6#PLC"
}
```

v1.5 changes selector behavior: if an explicit selector does not match an open AutoShop project, the tool returns an error and lists available projects. It no longer silently falls back to another open project.

## Beginner Tool Examples

Explain the selected project:

```json
{
  "projectName": "6#PLC",
  "maxBlocks": 250,
  "variableLimit": 80,
  "response_format": "markdown"
}
```

Explain `MAIN`:

```json
{
  "projectName": "6#PLC",
  "blockName": "MAIN",
  "response_format": "markdown"
}
```

Search for start/stop/alarm clues:

```json
{
  "projectName": "6#PLC",
  "query": "报警",
  "limit": 20,
  "response_format": "markdown"
}
```

## Local Validation

Validated against open AutoShop V4.12.0.0.B30 projects:

- Detected AutoShop instances: 3
- Selected project in smoke test: `6#PLC`
- Active block: `MAIN`
- Tool count: 22
- Beginner project guide: returned `MAIN` and MAIN CALL reading order
- Beginner block guide: explained `MAIN`, returned instruction hints and symbol hints
- Strict selector guard: passing a nonexistent `projectName` returns MCP `isError: true` with available project names

## Safety

Project and catalog tools are read-only. Snapshot export writes only to the selected output directory. `autoshop_write_live_points` is the only live write tool and requires `confirmRisk=true`.
