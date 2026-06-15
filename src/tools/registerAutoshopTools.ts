import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_MONITOR_INTERVAL_MS, DEFAULT_MONITOR_ITERATIONS, DEFAULT_OUTPUT_DIR, SUPPORTED_LANGUAGES, SUPPORTED_PROTOCOLS } from "../constants.js";
import {
  bootstrapInputSchema,
  generateLadderInputSchema,
  generateStInputSchema,
  listProgramBlocksInputSchema,
  monitorPointsInputSchema,
  parseVariableTablesInputSchema,
  readBlockSourceInputSchema,
  readPointsInputSchema,
  scaffoldProjectInputSchema,
  scanProjectInputSchema,
  searchSymbolsInputSchema,
  validatePointTableInputSchema,
  writePointsInputSchema,
} from "../schemas/autoshop.js";
import { listBlocks, parseVariableTables, readBlock, scanProject, searchSymbols } from "../services/autoshop-project.js";
import { formatResult } from "../services/format.js";
import { buildLadderFilename, buildLadderJsonFilename, generateLadderDiagram } from "../services/ladder-generator.js";
import { monitorModbusPoints, readModbusPoints, writeModbusPoints } from "../services/modbus.js";
import { loadPointDefinitions, summarizePointValidation, writeMarkdownFile, writePointArtifacts, writeTextFile } from "../services/point-table.js";
import { buildStFilename, generateStructuredTextSource, templateHelp } from "../services/st-generator.js";
import { ensureDirectory, resolveAbsolutePath, validatePointTable } from "../services/validation.js";
import { PointDefinition, ProjectBundleSpec } from "../types.js";

export function registerAutoshopTools(server: McpServer): void {
  server.registerTool(
    "autoshop_bootstrap",
    {
      title: "AutoShop Bootstrap",
      description: "Read-only orientation for the AutoShop MCP. Explains supported AutoShop workflows, generated artifacts, and live communication options before you pick a tool.",
      inputSchema: bootstrapInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ response_format }) => {
      const payload = {
        product: "Inovance AutoShop",
        focus: "Engineering assistance plus live PLC communication through open protocols, not direct IDE automation.",
        supported_languages: [...SUPPORTED_LANGUAGES],
        supported_protocols: [...SUPPORTED_PROTOCOLS],
        recommended_next_tools: [
          "autoshop_scan_project",
          "autoshop_list_program_blocks",
          "autoshop_read_block_source",
          "autoshop_search_symbols",
          "autoshop_parse_variable_tables",
          "autoshop_validate_point_table",
          "autoshop_generate_st_source",
          "autoshop_generate_ladder",
          "autoshop_scaffold_project_bundle",
          "autoshop_read_live_points",
        ],
      };

      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Bootstrap",
        payload,
        [
          "",
          "- Product focus: Inovance AutoShop engineering helper, not GUI automation.",
          `- Supported code languages: ${SUPPORTED_LANGUAGES.join(", ")}`,
          `- Supported live protocols: ${SUPPORTED_PROTOCOLS.join(", ")}`,
          "- Recommended flow:",
          "  1. scan the AutoShop project folder",
          "  2. list/read program blocks and search symbols",
          "  3. parse variable tables or validate external point tables",
          "  4. generate ST source or ladder rungs for manual implementation",
          "  5. use Modbus TCP tools for live read/write when needed",
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_validate_point_table",
    {
      title: "Validate AutoShop Point Table",
      description: "Validate a JSON or CSV point table for AutoShop and Modbus usage. Detects duplicate names, invalid addresses, and risky address overlaps.",
      inputSchema: validatePointTableInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ points, pointTablePath, response_format }) => {
      const loaded = await loadPointDefinitions({ points, pointTablePath });
      const report = validatePointTable(loaded.points);

      const payload = {
        source: loaded.sourceDescription,
        point_count: loaded.points.length,
        valid: report.isValid,
        errors: report.errors,
        warnings: report.warnings,
      };

      const { text, structuredContent } = formatResult(
        response_format,
        "Point Table Validation",
        payload,
        [
          "",
          `- Source: ${loaded.sourceDescription}`,
          ...summarizePointValidation(loaded.points),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_scan_project",
    {
      title: "Scan AutoShop Project",
      description: "Read an AutoShop project directory and summarize its block files, variable tables, project files, and folder.txt index. This is read-only and safe to use while AutoShop has the project open.",
      inputSchema: scanProjectInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, includeFiles, response_format }) => {
      const result = await scanProject({ projectPath, includeFiles });
      const programEntries = result.folder_index.entries.filter((entry) => entry.category === "PROG" && entry.kind === "FILE");
      const variableEntries = result.folder_index.entries.filter((entry) => entry.category === "VAR" && entry.kind === "FILE");
      const fbEntries = result.folder_index.entries.filter((entry) => entry.category === "FB" && entry.kind === "FILE");

      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Project Scan",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Project: ${result.project_name}`,
          `- Path: ${result.project_path}`,
          `- Programs: ${result.counts.programs} (${result.counts.ladder_blocks} LD, ${result.counts.st_blocks} ST)`,
          `- Function blocks: ${result.counts.function_blocks}`,
          `- Variable tables: ${result.counts.variable_tables}`,
          `- folder.txt index: ${result.folder_index.exists ? "found" : "not found"}`,
          `- Indexed program files: ${programEntries.length}`,
          `- Indexed variable files: ${variableEntries.length}`,
          `- Indexed FB files: ${fbEntries.length}`,
          ...result.warnings.map((warning) => `- Warning: ${warning}`),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_list_program_blocks",
    {
      title: "List AutoShop Program Blocks",
      description: "List AutoShop LD, ST, and FB block files from a project directory, with pagination and language filtering.",
      inputSchema: listProgramBlocksInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, language, limit, offset, response_format }) => {
      const result = await listBlocks({ projectPath, language, limit, offset });
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Program Blocks",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Path: ${result.project_path}`,
          `- Total: ${result.total_count}`,
          `- Showing: ${result.count} from offset ${result.offset}`,
          ...result.blocks.map((block) => `- ${block.name}: ${block.language}, ${block.sizeBytes} bytes, indexed=${block.listedInFolderIndex ? "yes" : "no"}`),
          ...(result.has_more ? [`- Next offset: ${result.next_offset}`] : []),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_read_block_source",
    {
      title: "Read AutoShop Block Source",
      description: "Read one AutoShop block. Text ST files are returned as source; binary LD/FB containers are summarized by extracting readable instructions, calls, comments, and symbols.",
      inputSchema: readBlockSourceInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, blockName, includeRawStrings, maxStrings, response_format }) => {
      const result = await readBlock({ projectPath, blockName, includeRawStrings, maxStrings });
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Block Source",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Block: ${result.block.name}`,
          `- Language: ${result.block.language}`,
          `- Source kind: ${result.source_kind}`,
          `- Calls: ${result.summary.calls.length}`,
          `- Instructions: ${result.summary.instructions.length}`,
          `- Symbols: ${result.summary.symbols.length}`,
          ...result.warnings.map((warning) => `- Warning: ${warning}`),
          "",
          "## Calls",
          ...(result.summary.calls.length > 0 ? result.summary.calls.slice(0, 40).map((call) => `- ${call}`) : ["- none found"]),
          "",
          "## Preview",
          "```text",
          result.text_preview,
          "```",
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_search_symbols",
    {
      title: "Search AutoShop Symbols",
      description: "Search readable strings in AutoShop blocks, variable tables, and config files. Useful for finding addresses like M8000, subroutine calls, comments, and alarm text.",
      inputSchema: searchSymbolsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, query, fileTypes, limit, offset, response_format }) => {
      const result = await searchSymbols({ projectPath, query, fileTypes, limit, offset });
      const lines = [
        "",
        `- Query: ${result.query}`,
        `- Total matching files: ${result.total_count}`,
        `- Showing: ${result.count} from offset ${result.offset}`,
      ];
      for (const match of result.matches) {
        lines.push(`- ${match.file} (${match.kind})`);
        for (const snippet of match.snippets.slice(0, 4)) {
          lines.push(`  - ${snippet}`);
        }
      }
      if (result.has_more) {
        lines.push(`- Next offset: ${result.next_offset}`);
      }

      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Symbol Search",
        result as unknown as Record<string, unknown>,
        lines,
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_parse_variable_tables",
    {
      title: "Parse AutoShop Variable Tables",
      description: "Extract readable variable records from AutoShop .gdt/.gvt/.csv variable files. AutoShop native tables are partly proprietary, so the result is a best-effort symbol and comment index.",
      inputSchema: parseVariableTablesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, tableName, query, limit, offset, response_format }) => {
      const result = await parseVariableTables({ projectPath, tableName, query, limit, offset });
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Variable Tables",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Path: ${result.project_path}`,
          `- Total records: ${result.total_count}`,
          `- Showing: ${result.count} from offset ${result.offset}`,
          ...result.records.slice(0, 80).map((record) => `- ${record.file}: ${record.text}`),
          ...(result.has_more ? [`- Next offset: ${result.next_offset}`] : []),
          ...result.warnings.map((warning) => `- Warning: ${warning}`),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_generate_ladder",
    {
      title: "Generate AutoShop Ladder",
      description: "Generate AutoShop ladder-logic material from structured rung JSON. Returns an ASCII ladder diagram, equivalent ST, and optional files for manual AutoShop implementation.",
      inputSchema: generateLadderInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ programName, rungs, includeEquivalentSt, outputDirectory, response_format }) => {
      const spec = { programName, rungs, includeEquivalentSt };
      const generated = generateLadderDiagram(spec);

      let artifactPaths: string[] = [];
      if (outputDirectory) {
        const resolvedOutputDir = resolveAbsolutePath(outputDirectory);
        await ensureDirectory(resolvedOutputDir);
        const ladderPath = path.join(resolvedOutputDir, buildLadderFilename(spec));
        const jsonPath = path.join(resolvedOutputDir, buildLadderJsonFilename(spec));
        await writeMarkdownFile(ladderPath, [
          generated.ascii,
          "",
          "## Equivalent ST",
          "",
          "```st",
          generated.equivalentSt,
          "```",
        ].join("\n"));
        await writeTextFile(jsonPath, `${JSON.stringify(spec, null, 2)}\n`);
        artifactPaths = [ladderPath, jsonPath];
      }

      const payload = {
        program_name: programName,
        rung_count: rungs.length,
        artifacts: artifactPaths,
        warnings: generated.warnings,
        ascii: generated.ascii,
        equivalent_st: includeEquivalentSt ? generated.equivalentSt : undefined,
      };

      const markdownLines = [
        "",
        `- Program: ${programName}`,
        `- Rungs: ${rungs.length}`,
        ...artifactPaths.map((artifact) => `- File: ${artifact}`),
        ...(generated.warnings.length > 0 ? generated.warnings.map((warning) => `- Warning: ${warning}`) : []),
        "",
        generated.ascii,
        ...(includeEquivalentSt
          ? [
              "",
              "## Equivalent ST",
              "",
              "```st",
              generated.equivalentSt,
              "```",
            ]
          : []),
      ];

      const { text, structuredContent } = formatResult(
        response_format,
        "Ladder Logic",
        payload,
        markdownLines,
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_generate_st_source",
    {
      title: "Generate AutoShop ST Source",
      description: "Generate Structured Text source for an AutoShop block. Supports small starter templates and explicit operation lists, with optional file output.",
      inputSchema: generateStInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      blockType,
      blockName,
      template,
      comment,
      inputs,
      outputs,
      statics,
      temps,
      operations,
      templateSignals,
      outputPath,
      response_format,
    }) => {
      const generated = generateStructuredTextSource({
        blockType,
        blockName,
        template,
        comment,
        inputs,
        outputs,
        statics,
        temps,
        operations,
        templateSignals,
      });

      let resolvedOutputPath: string | undefined;
      if (outputPath) {
        resolvedOutputPath = resolveAbsolutePath(outputPath);
        await writeTextFile(resolvedOutputPath, generated.text);
      }

      const payload = {
        block_name: blockName,
        block_type: blockType,
        template: template ?? "custom",
        template_help: templateHelp(),
        output_path: resolvedOutputPath,
        warnings: generated.warnings,
        source: generated.text,
      };

      const markdownLines = [
        "",
        `- Block: ${blockName}`,
        `- Type: ${blockType}`,
        `- Template: ${template ?? "custom"}`,
        ...(resolvedOutputPath ? [`- File: ${resolvedOutputPath}`] : []),
        ...(generated.warnings.length > 0 ? generated.warnings.map((warning) => `- Warning: ${warning}`) : []),
        "",
        "```st",
        generated.text,
        "```",
      ];

      const { text, structuredContent } = formatResult(
        response_format,
        "Structured Text Source",
        payload,
        markdownLines,
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_scaffold_project_bundle",
    {
      title: "Scaffold AutoShop Project Bundle",
      description: "Generate a local AutoShop engineering bundle: ST source, point tables, manifest, and import notes. This is the AutoShop counterpart to a project scaffold, without assuming an official IDE API.",
      inputSchema: scaffoldProjectInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectName, outputDirectory, block, ladder, points, pointTablePath, notes, communication, response_format }) => {
      const resolvedOutputDir = resolveAbsolutePath(outputDirectory || path.join(process.cwd(), DEFAULT_OUTPUT_DIR, projectName));
      await ensureDirectory(resolvedOutputDir);

      const loaded = await loadPointDefinitions({ points, pointTablePath });
      const validation = validatePointTable(loaded.points);
      const artifactPaths: string[] = [];
      let stPath: string | undefined;

      if (block) {
        const generated = generateStructuredTextSource(block);
        stPath = path.join(resolvedOutputDir, buildStFilename(block));
        await writeTextFile(stPath, generated.text);
        artifactPaths.push(stPath);
      }

      let ladderPath: string | undefined;
      let ladderJsonPath: string | undefined;
      if (ladder) {
        const generated = generateLadderDiagram(ladder);
        ladderPath = path.join(resolvedOutputDir, buildLadderFilename(ladder));
        ladderJsonPath = path.join(resolvedOutputDir, buildLadderJsonFilename(ladder));
        await writeMarkdownFile(ladderPath, [
          generated.ascii,
          "",
          "## Equivalent ST",
          "",
          "```st",
          generated.equivalentSt,
          "```",
        ].join("\n"));
        await writeTextFile(ladderJsonPath, `${JSON.stringify(ladder, null, 2)}\n`);
        artifactPaths.push(ladderPath, ladderJsonPath);
      }

      let pointArtifacts: { jsonPath: string; csvPath: string } | undefined;
      if (loaded.points.length > 0) {
        pointArtifacts = await writePointArtifacts(resolvedOutputDir, loaded.points);
        artifactPaths.push(pointArtifacts.jsonPath, pointArtifacts.csvPath);
      }

      const manifest: ProjectBundleSpec = {
        projectName,
        outputDirectory: resolvedOutputDir,
        block: block
          ? {
              blockType: block.blockType,
              blockName: block.blockName,
              template: block.template,
              comment: block.comment,
              inputs: block.inputs,
              outputs: block.outputs,
              statics: block.statics,
              temps: block.temps,
              operations: block.operations,
              templateSignals: block.templateSignals,
            }
          : undefined,
        ladder,
        points: loaded.points,
        notes,
        communication,
      };

      const manifestPath = path.join(resolvedOutputDir, "bundle.manifest.json");
      await writeTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      artifactPaths.push(manifestPath);

      const readmePath = path.join(resolvedOutputDir, "README.md");
      const readme = buildBundleReadme(projectName, block?.blockName, stPath, ladderPath, pointArtifacts, validation, communication, notes);
      await writeMarkdownFile(readmePath, readme);
      artifactPaths.push(readmePath);

      const payload = {
        project_name: projectName,
        output_directory: resolvedOutputDir,
        artifacts: artifactPaths,
        point_validation: validation,
        communication,
      };

      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Project Bundle",
        payload,
        [
          "",
          `- Output directory: ${resolvedOutputDir}`,
          `- Artifacts generated: ${artifactPaths.length}`,
          `- Point table valid: ${validation.isValid ? "yes" : "no"}`,
          ...artifactPaths.map((artifact) => `- ${artifact}`),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_read_live_points",
    {
      title: "Read Live PLC Points",
      description: "Read one or more AutoShop points from a live Inovance PLC over Modbus TCP. Use a point table file or inline points.",
      inputSchema: readPointsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ connection, points, pointTablePath, response_format }) => {
      const loaded = await loadPointDefinitions({ points, pointTablePath });
      const values = await readModbusPoints({
        connection,
        points: loaded.points,
      });

      const payload = {
        connection,
        source: loaded.sourceDescription,
        values,
      };

      const { text, structuredContent } = formatResult(
        response_format,
        "Live PLC Read",
        payload,
        [
          "",
          `- Target: ${connection.host}:${connection.port}`,
          `- Unit ID: ${connection.unitId}`,
          ...Object.entries(values).map(([name, value]) => `- ${name}: ${String(value)}`),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_write_live_points",
    {
      title: "Write Live PLC Points",
      description: "Write one or more AutoShop points to a live Inovance PLC over Modbus TCP. Writes are blocked unless confirmRisk=true.",
      inputSchema: writePointsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ connection, points, pointTablePath, confirmRisk, response_format }) => {
      const loaded = await loadPointDefinitions({ points, pointTablePath });
      const values = await writeModbusPoints({
        connection,
        points: loaded.points,
        confirmRisk,
      });

      const payload = {
        connection,
        source: loaded.sourceDescription,
        values,
        confirmRisk,
      };

      const { text, structuredContent } = formatResult(
        response_format,
        "Live PLC Write",
        payload,
        [
          "",
          `- Target: ${connection.host}:${connection.port}`,
          `- Unit ID: ${connection.unitId}`,
          `- Safety confirmation: ${confirmRisk ? "confirmed" : "missing"}`,
          ...Object.entries(values).map(([name, value]) => `- ${name} := ${String(value)}`),
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_monitor_live_points",
    {
      title: "Monitor Live PLC Points",
      description: "Poll a list of AutoShop points over Modbus TCP and return timestamped samples. Useful for trend snapshots and commissioning checks.",
      inputSchema: monitorPointsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ connection, points, pointTablePath, intervalMs, iterations, response_format }) => {
      const loaded = await loadPointDefinitions({ points, pointTablePath });
      const samples = await monitorModbusPoints(
        {
          connection,
          points: loaded.points,
        },
        intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS,
        iterations ?? DEFAULT_MONITOR_ITERATIONS,
      );

      const payload = {
        connection,
        source: loaded.sourceDescription,
        interval_ms: intervalMs,
        iterations,
        samples,
      };

      const markdownLines = [
        "",
        `- Target: ${connection.host}:${connection.port}`,
        `- Interval: ${intervalMs} ms`,
        `- Iterations: ${iterations}`,
      ];
      for (const sample of samples) {
        markdownLines.push(`- ${sample.timestamp}`);
        for (const [name, value] of Object.entries(sample.values)) {
          markdownLines.push(`  - ${name}: ${String(value)}`);
        }
      }

      const { text, structuredContent } = formatResult(
        response_format,
        "Live PLC Monitor",
        payload,
        markdownLines,
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );
}

function buildBundleReadme(
  projectName: string,
  blockName: string | undefined,
  stPath: string | undefined,
  ladderPath: string | undefined,
  pointArtifacts: { jsonPath: string; csvPath: string } | undefined,
  validation: { isValid: boolean; errors: string[]; warnings: string[] },
  communication: ProjectBundleSpec["communication"],
  notes: string | undefined,
): string {
  const lines = [
    `# ${projectName}`,
    "",
    "This folder is a generated AutoShop engineering bundle.",
    "",
    "## What is inside",
    ...(stPath ? [`- ST source: \`${stPath}\`${blockName ? ` for block \`${blockName}\`` : ""}`] : []),
    ...(ladderPath ? [`- Ladder logic: \`${ladderPath}\``] : []),
    ...(pointArtifacts
      ? [
          `- Point table JSON: \`${pointArtifacts.jsonPath}\``,
          `- Point table CSV: \`${pointArtifacts.csvPath}\``,
        ]
      : []),
    "",
    "## Suggested import flow",
    "1. Open AutoShop and create or open your target project.",
    "2. Import or paste the generated ST source into the matching POU.",
    "3. Import the point table into your tag or communication mapping workflow.",
    "4. Compile inside AutoShop and verify addresses against the live PLC.",
    "",
    "## Point table validation",
    `- Valid: ${validation.isValid ? "yes" : "no"}`,
    ...validation.errors.map((error) => `- Error: ${error}`),
    ...validation.warnings.map((warning) => `- Warning: ${warning}`),
  ];

  if (communication) {
    lines.push("", "## Communication", `- Protocol: ${communication.protocol}`);
    if (communication.host) {
      lines.push(`- Suggested host: ${communication.host}`);
    }
    if (communication.port) {
      lines.push(`- Suggested port: ${communication.port}`);
    }
    if (communication.unitId !== undefined) {
      lines.push(`- Suggested unit ID: ${communication.unitId}`);
    }
  }

  if (notes) {
    lines.push("", "## Notes", notes);
  }

  return `${lines.join("\n")}\n`;
}
