# autoshop-mcp-server

AutoShop MCP for Inovance PLC work.

It covers read-only AutoShop project inspection, ST source generation, ladder-logic generation, point-table validation, and live PLC reads/writes over Modbus TCP.

## Tools

- `autoshop_bootstrap`
- `autoshop_scan_project`
- `autoshop_list_program_blocks`
- `autoshop_read_block_source`
- `autoshop_search_symbols`
- `autoshop_parse_variable_tables`
- `autoshop_validate_point_table`
- `autoshop_generate_st_source`
- `autoshop_generate_ladder`
- `autoshop_scaffold_project_bundle`
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

## Ladder

Use `examples\ladder.start-stop.json` as a start/stop rung example. The server returns ASCII ladder plus equivalent ST so the logic can be reviewed and recreated in AutoShop.

AutoShop `.LD` and `.FB` files are proprietary binary containers. The project tools extract readable calls, instructions, comments, and symbols from existing blocks, but they do not claim a lossless native LAD import/export format.

## Existing AutoShop Projects

Start with:

```json
{
  "projectPath": "D:\\牧哲\\1、程序\\镜像\\抛光\\PLC\\111",
  "response_format": "markdown"
}
```

Recommended sequence:

1. `autoshop_scan_project`
2. `autoshop_list_program_blocks`
3. `autoshop_read_block_source`
4. `autoshop_search_symbols`
5. `autoshop_parse_variable_tables`

## Point Table

Use `examples\points.sample.json` as a basic Modbus point list.

## Safety

Live write operations require `confirmRisk=true`.
