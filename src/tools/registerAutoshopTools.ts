import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AUTOSHOP_AI_COMMAND_FILE, DEFAULT_AUTOSHOP_INSTALL_DIR, DEFAULT_MONITOR_INTERVAL_MS, DEFAULT_MONITOR_ITERATIONS, DEFAULT_OUTPUT_DIR, SUPPORTED_LANGUAGES, SUPPORTED_PROTOCOLS } from "../constants.js";
import {
  analyzeCallGraphInputSchema,
  bootstrapInputSchema,
  capabilitySelfTestInputSchema,
  exportProjectSnapshotInputSchema,
  detectOpenInstancesInputSchema,
  generateLadderInputSchema,
  generateStInputSchema,
  inspectProjectHealthInputSchema,
  instructionCatalogInputSchema,
  listProgramBlocksInputSchema,
  monitorPointsInputSchema,
  parseVariableTablesInputSchema,
  readBlockSourceInputSchema,
  readPointsInputSchema,
  scaffoldProjectInputSchema,
  scanActiveProjectInputSchema,
  scanProjectInputSchema,
  searchSymbolsInputSchema,
  validatePointTableInputSchema,
  writePointsInputSchema,
} from "../schemas/autoshop.js";
import { analyzeCallGraph } from "../services/autoshop-analysis.js";
import { exportProjectSnapshot, inspectProjectHealth } from "../services/autoshop-health.js";
import { listBlocks, parseVariableTables, readBlock, scanProject, searchSymbols } from "../services/autoshop-project.js";
import { detectAutoShopInstances, getActiveAutoShopInstance, getActiveAutoShopProjectPath, pathExists, readInstructionCatalog, readProjectCommunicationConfig } from "../services/autoshop-runtime.js";
import { formatResult } from "../services/format.js";
import { buildLadderFilename, buildLadderJsonFilename, generateLadderDiagram } from "../services/ladder-generator.js";
import { monitorModbusPoints, readModbusPoints, writeModbusPoints } from "../services/modbus.js";
import { loadPointDefinitions, summarizePointValidation, writeMarkdownFile, writePointArtifacts, writeTextFile } from "../services/point-table.js";
import { buildStFilename, generateStructuredTextSource, templateHelp } from "../services/st-generator.js";
import { ensureDirectory, resolveAbsolutePath, validatePointTable } from "../services/validation.js";
import { AutoShopContextSelector, PointDefinition, ProjectBundleSpec } from "../types.js";

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
          "autoshop_detect_open_instances",
          "autoshop_scan_active_project",
          "autoshop_run_capability_self_test",
          "autoshop_scan_project",
          "autoshop_list_program_blocks",
          "autoshop_read_block_source",
          "autoshop_analyze_call_graph",
          "autoshop_inspect_project_health",
          "autoshop_export_project_snapshot",
          "autoshop_search_symbols",
          "autoshop_parse_variable_tables",
          "autoshop_list_instruction_catalog",
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
          "  1. detect the open AutoShop instance or scan the active project",
          "  2. list/read program blocks, analyze the call graph, and run project health checks",
          "  3. search symbols and parse variable tables",
          "  4. export a project snapshot before larger AI-assisted changes",
          "  5. consult the AutoShop instruction catalog for available commands",
          "  6. generate ST source or ladder rungs for manual implementation",
          "  7. use Modbus TCP tools for live read/write when needed",
        ],
      );

      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_detect_open_instances",
    {
      title: "Detect Open AutoShop Instances",
      description: "Read-only detection of running AutoShop windows. Parses the main window title to find the open project path, active block, AutoShop version, process path, foreground status, and selected default instance.",
      inputSchema: detectOpenInstancesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectName, windowTitleContains, response_format }) => {
      const instances = await detectAutoShopInstances();
      const selectedInstance = await getActiveAutoShopInstance({ projectName, windowTitleContains });
      const payload = {
        count: instances.length,
        selected_instance: selectedInstance,
        instances,
      };
      const { text, structuredContent } = formatResult(
        response_format,
        "Open AutoShop Instances",
        payload,
        [
          "",
          `- Running AutoShop instances: ${instances.length}`,
          ...(instances.length === 0
            ? ["- No AutoShop window was detected."]
            : instances.map((instance) =>
                `- PID ${instance.processId}${instance.processId === selectedInstance?.processId ? " (selected)" : ""}: ${instance.productVersion ?? "unknown version"}, foreground=${instance.isForeground ? "yes" : "no"}, project=${instance.projectPath ?? "not detected"}, active=${instance.activeBlock ?? "unknown"}`,
              )),
        ],
      );
      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_scan_active_project",
    {
      title: "Scan Active AutoShop Project",
      description: "Read-only scan of the project currently shown in the open AutoShop window. This is the AutoShop counterpart to attaching to an already-open TIA project and reading its project tree.",
      inputSchema: scanActiveProjectInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, includeFiles, response_format }) => {
      const activeProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await scanProject({ projectPath: activeProjectPath, includeFiles });
      const communication = await readProjectCommunicationConfig(activeProjectPath);
      const payload = {
        active_project_path: activeProjectPath,
        communication,
        scan: result,
      };
      const { text, structuredContent } = formatResult(
        response_format,
        "Active AutoShop Project Scan",
        payload as unknown as Record<string, unknown>,
        [
          "",
          `- Active project: ${activeProjectPath}`,
          `- Programs: ${result.counts.programs} (${result.counts.ladder_blocks} LD, ${result.counts.st_blocks} ST)`,
          `- Function blocks: ${result.counts.function_blocks}`,
          `- Variable tables: ${result.counts.variable_tables}`,
          `- folder.txt index: ${result.folder_index.exists ? "found" : "not found"}`,
          ...(communication?.ip ? [`- Configured PLC IP: ${communication.ip}`] : []),
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
    "autoshop_run_capability_self_test",
    {
      title: "Run AutoShop Capability Self Test",
      description: "Read-only readiness check for this AutoShop MCP: detects running AutoShop, resolves the active project, checks key installation files, scans the project, reads communication config, and verifies the instruction catalog.",
      inputSchema: capabilitySelfTestInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, installPath, response_format }) => {
      const instances = await detectAutoShopInstances();
      const activeInstance = await getActiveAutoShopInstance({ projectPath, projectName, windowTitleContains });
      const effectiveProjectPath = projectPath ?? activeInstance?.projectPath;
      const effectiveInstallPath = installPath ?? (activeInstance?.executablePath ? path.dirname(activeInstance.executablePath) : DEFAULT_AUTOSHOP_INSTALL_DIR);
      const checks: Record<string, unknown> = {
        autoshop_process_detected: instances.length > 0,
        active_project_detected: Boolean(activeInstance?.projectPath),
        active_project_exists: Boolean(activeInstance?.projectExists),
        install_path: effectiveInstallPath,
        autoshop_exe_exists: await pathExists(path.join(effectiveInstallPath, "AutoShop.exe")),
        instruction_catalog_exists: await pathExists(path.join(effectiveInstallPath, AUTOSHOP_AI_COMMAND_FILE)),
        st_compiler_exists: await pathExists(path.join(effectiveInstallPath, "STCompiler.dll")),
        st_lang_exists: await pathExists(path.join(effectiveInstallPath, "Bin", "StLang.exe")),
      };

      let scan: Awaited<ReturnType<typeof scanProject>> | undefined;
      let communication: Awaited<ReturnType<typeof readProjectCommunicationConfig>> | undefined;
      const warnings: string[] = [];
      if (effectiveProjectPath) {
        try {
          scan = await scanProject({ projectPath: effectiveProjectPath, includeFiles: false });
          communication = await readProjectCommunicationConfig(effectiveProjectPath);
        } catch (error) {
          warnings.push(`Project scan failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        warnings.push("No projectPath was supplied and no active AutoShop project was detected.");
      }

      const catalog = await readInstructionCatalog({ installPath: effectiveInstallPath, limit: 5, offset: 0 });
      warnings.push(...catalog.warnings);

      const payload = {
        instances,
        active_instance: activeInstance,
        effective_project_path: effectiveProjectPath,
        checks,
        project_counts: scan?.counts,
        communication,
        instruction_catalog_count: catalog.total_count,
        recommended_next_tools: effectiveProjectPath
          ? ["autoshop_scan_project", "autoshop_analyze_call_graph", "autoshop_list_program_blocks", "autoshop_parse_variable_tables"]
          : ["autoshop_detect_open_instances"],
        warnings,
      };

      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Capability Self Test",
        payload as unknown as Record<string, unknown>,
        [
          "",
          `- AutoShop running: ${instances.length > 0 ? "yes" : "no"}`,
          `- Active project: ${effectiveProjectPath ?? "not detected"}`,
          `- Install path: ${effectiveInstallPath}`,
          `- Instruction catalog entries: ${catalog.total_count}`,
          ...(scan ? [`- Project blocks: ${scan.counts.programs + scan.counts.function_blocks}`, `- Variable tables: ${scan.counts.variable_tables}`] : []),
          ...(communication?.ip ? [`- Configured PLC IP: ${communication.ip}`] : []),
          ...warnings.map((warning) => `- Warning: ${warning}`),
        ],
      );
      return {
        content: [{ type: "text", text }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "autoshop_list_instruction_catalog",
    {
      title: "List AutoShop Instruction Catalog",
      description: "Read the AutoShop AI assistant instruction catalog from AIAssistantELinkCmd.xml, with filtering and pagination. Useful before generating ST or ladder material.",
      inputSchema: instructionCatalogInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ installPath, query, limit, offset, response_format }) => {
      const result = await readInstructionCatalog({ installPath, query, limit, offset });
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Instruction Catalog",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Source: ${result.source_file}`,
          `- Total: ${result.total_count}`,
          `- Showing: ${result.count} from offset ${result.offset}`,
          ...result.instructions.slice(0, 80).map((instruction) => `- ${instruction}`),
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
    "autoshop_analyze_call_graph",
    {
      title: "Analyze AutoShop Call Graph",
      description: "Read AutoShop program blocks and build a best-effort CALL graph. This helps understand MAIN/SBR execution structure before editing or generating code.",
      inputSchema: analyzeCallGraphInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, maxBlocks, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await analyzeCallGraph({ projectPath: effectiveProjectPath, maxBlocks });
      const mainEdges = result.edges.filter((edge) => edge.from.toUpperCase() === "MAIN");
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Call Graph",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Project: ${result.project_path}`,
          `- Blocks scanned: ${result.scanned_blocks}/${result.total_blocks}`,
          `- CALL edges: ${result.edges.length}`,
          `- Unresolved calls: ${result.unresolved_calls.length}`,
          `- Entry blocks: ${result.entry_blocks.slice(0, 20).join(", ") || "none"}`,
          "",
          "## MAIN calls",
          ...(mainEdges.length > 0 ? mainEdges.slice(0, 80).map((edge) => `- ${edge.to}${edge.resolved ? "" : " (unresolved)"}`) : ["- MAIN block has no extracted CALL edges."]),
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
    "autoshop_inspect_project_health",
    {
      title: "Inspect AutoShop Project Health",
      description: "Read-only project health inspection for the selected AutoShop project. Summarizes project files, folder.txt alignment, CALL graph issues, variable tables, communication config, and large or orphaned blocks.",
      inputSchema: inspectProjectHealthInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, maxBlocks, variableLimit, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await inspectProjectHealth({ projectPath: effectiveProjectPath, maxBlocks, variableLimit });
      const checkCounts = summarizeHealthChecks(result.checks);
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Project Health",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Project: ${result.project_name}`,
          `- Path: ${result.project_path}`,
          `- Checks: ${checkCounts.ok} ok, ${checkCounts.warning} warning, ${checkCounts.error} error`,
          `- Programs: ${result.summary.programs} (${result.summary.ladder_blocks} LD, ${result.summary.st_blocks} ST)`,
          `- Function blocks: ${result.summary.function_blocks}`,
          `- Variable tables: ${result.summary.variable_tables}`,
          `- CALL edges: ${result.summary.call_edges}`,
          `- Unresolved calls: ${result.summary.unresolved_calls}`,
          `- Orphan blocks: ${result.summary.orphan_blocks}`,
          ...(result.communication?.ip ? [`- Configured PLC IP: ${result.communication.ip}`] : []),
          "",
          "## Checks",
          ...result.checks.map((check) => `- [${check.severity.toUpperCase()}] ${check.id}: ${check.message}`),
          "",
          "## Largest blocks",
          ...result.largest_blocks.map((block) => `- ${block.name}: ${block.language}, ${block.sizeBytes} bytes`),
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
    "autoshop_export_project_snapshot",
    {
      title: "Export AutoShop Project Snapshot",
      description: "Export a local JSON and Markdown snapshot for the selected AutoShop project. The snapshot includes the same health checks as autoshop_inspect_project_health and is intended for review before AI-assisted changes.",
      inputSchema: exportProjectSnapshotInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, maxBlocks, variableLimit, outputDirectory, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await exportProjectSnapshot({ projectPath: effectiveProjectPath, maxBlocks, variableLimit, outputDirectory });
      const checkCounts = summarizeHealthChecks(result.health.checks);
      const { text, structuredContent } = formatResult(
        response_format,
        "AutoShop Project Snapshot",
        result as unknown as Record<string, unknown>,
        [
          "",
          `- Project: ${result.health.project_name}`,
          `- Path: ${result.project_path}`,
          `- Output directory: ${result.output_directory}`,
          `- Checks: ${checkCounts.ok} ok, ${checkCounts.warning} warning, ${checkCounts.error} error`,
          `- CALL edges: ${result.health.summary.call_edges}`,
          `- Unresolved calls: ${result.health.summary.unresolved_calls}`,
          ...result.artifacts.map((artifact) => `- Artifact: ${artifact}`),
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
    async ({ projectPath, projectName, windowTitleContains, includeFiles, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await scanProject({ projectPath: effectiveProjectPath, includeFiles });
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
      description: "List AutoShop LD, ST, and FB block files from a project directory, with pagination and language filtering. If projectPath is omitted, uses the project shown in the active AutoShop window.",
      inputSchema: listProgramBlocksInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, language, limit, offset, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await listBlocks({ projectPath: effectiveProjectPath, language, limit, offset });
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
      description: "Read one AutoShop block. If projectPath or blockName is omitted, uses the active AutoShop window/project. Text ST files are returned as source; binary LD/FB containers are summarized by extracting readable instructions, calls, comments, and symbols.",
      inputSchema: readBlockSourceInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, blockName, includeRawStrings, maxStrings, response_format }) => {
      const activeInstance = !projectPath || !blockName ? await getActiveAutoShopInstance({ projectPath, projectName, windowTitleContains }) : undefined;
      const effectiveProjectPath = projectPath ?? activeInstance?.projectPath ?? await getActiveAutoShopProjectPath({ projectName, windowTitleContains });
      const effectiveBlockName = blockName ?? activeInstance?.activeBlock;
      if (!effectiveBlockName) {
        throw new Error("No blockName was supplied and no active block was detected from the AutoShop window title.");
      }
      const result = await readBlock({ projectPath: effectiveProjectPath, blockName: effectiveBlockName, includeRawStrings, maxStrings });
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
      description: "Search readable strings in AutoShop blocks, variable tables, and config files. If projectPath is omitted, uses the active AutoShop project. Useful for finding addresses like M8000, subroutine calls, comments, and alarm text.",
      inputSchema: searchSymbolsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, query, fileTypes, limit, offset, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await searchSymbols({ projectPath: effectiveProjectPath, query, fileTypes, limit, offset });
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
      description: "Extract readable variable records from AutoShop .gdt/.gvt/.csv variable files. If projectPath is omitted, uses the active AutoShop project. AutoShop native tables are partly proprietary, so the result is a best-effort symbol and comment index.",
      inputSchema: parseVariableTablesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectPath, projectName, windowTitleContains, tableName, query, limit, offset, response_format }) => {
      const effectiveProjectPath = await resolveProjectPath({ projectPath, projectName, windowTitleContains });
      const result = await parseVariableTables({ projectPath: effectiveProjectPath, tableName, query, limit, offset });
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

async function resolveProjectPath(selector: AutoShopContextSelector): Promise<string> {
  if (selector.projectPath) {
    return selector.projectPath;
  }
  return getActiveAutoShopProjectPath(selector);
}

function summarizeHealthChecks(checks: Array<{ severity: "ok" | "warning" | "error" }>): Record<"ok" | "warning" | "error", number> {
  return checks.reduce(
    (summary, check) => {
      summary[check.severity] += 1;
      return summary;
    },
    { ok: 0, warning: 0, error: 0 },
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
