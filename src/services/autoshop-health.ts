import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_DIR } from "../constants.js";
import { AutoShopHealthCheck } from "../types.js";
import { analyzeCallGraph } from "./autoshop-analysis.js";
import { listBlocks, parseVariableTables, scanProject } from "./autoshop-project.js";
import { readProjectCommunicationConfig } from "./autoshop-runtime.js";
import { ensureDirectory, resolveAbsolutePath } from "./validation.js";

export interface InspectProjectHealthOptions {
  projectPath: string;
  maxBlocks?: number;
  variableLimit?: number;
}

export interface InspectProjectHealthResult {
  project_path: string;
  project_name: string;
  generated_at: string;
  summary: {
    programs: number;
    ladder_blocks: number;
    st_blocks: number;
    function_blocks: number;
    variable_tables: number;
    project_files: number;
    config_files: number;
    all_files: number;
    call_edges: number;
    unresolved_calls: number;
    orphan_blocks: number;
    variable_records_sampled: number;
  };
  communication?: Awaited<ReturnType<typeof readProjectCommunicationConfig>>;
  checks: AutoShopHealthCheck[];
  orphan_blocks: string[];
  largest_blocks: Array<{
    name: string;
    language: string;
    sizeBytes: number;
  }>;
  warnings: string[];
}

export interface ExportProjectSnapshotOptions extends InspectProjectHealthOptions {
  outputDirectory?: string;
}

export interface ExportProjectSnapshotResult {
  project_path: string;
  output_directory: string;
  artifacts: string[];
  health: InspectProjectHealthResult;
}

export async function inspectProjectHealth(options: InspectProjectHealthOptions): Promise<InspectProjectHealthResult> {
  const projectPath = resolveAbsolutePath(options.projectPath);
  const maxBlocks = Math.min(Math.max(options.maxBlocks ?? 250, 1), 1000);
  const variableLimit = Math.min(Math.max(options.variableLimit ?? 500, 1), 5000);
  const scan = await scanProject({ projectPath, includeFiles: false });
  const blocks = await listBlocks({ projectPath, language: "all", limit: maxBlocks, offset: 0 });
  const graph = await analyzeCallGraph({ projectPath, maxBlocks });
  const variables = await parseVariableTables({ projectPath, limit: variableLimit, offset: 0 });
  const communication = await readProjectCommunicationConfig(projectPath);
  const checks: AutoShopHealthCheck[] = [];
  const warnings = [...scan.warnings, ...graph.warnings, ...variables.warnings];

  pushCheck(checks, "project_files", scan.counts.project_files > 0 ? "ok" : "error", scan.counts.project_files > 0
    ? `Found ${scan.counts.project_files} AutoShop project file(s).`
    : "No .hcp/.hcpp project file was found in this project directory.", { count: scan.counts.project_files });
  pushCheck(checks, "folder_index", scan.folder_index.exists ? "ok" : "warning", scan.folder_index.exists
    ? `folder.txt index found with ${scan.folder_index.entries.length} entries.`
    : "folder.txt was not found; block categories may be inferred only from file extensions.", { entries: scan.folder_index.entries.length });
  pushCheck(checks, "program_blocks", scan.counts.programs > 0 ? "ok" : "error", scan.counts.programs > 0
    ? `Found ${scan.counts.programs} program block(s).`
    : "No program blocks were found.", { programs: scan.counts.programs });
  pushCheck(checks, "call_graph", graph.unresolved_calls.length === 0 ? "ok" : "warning", graph.unresolved_calls.length === 0
    ? `Resolved all ${graph.edges.length} extracted CALL edge(s).`
    : `${graph.unresolved_calls.length} CALL target(s) were not resolved to block files.`, { unresolved: graph.unresolved_calls });
  pushCheck(checks, "communication_config", communication?.ip ? "ok" : "warning", communication?.ip
    ? `Project config contains PLC IP ${communication.ip}.`
    : "No PLC IP was found in project config.ini.", { ip: communication?.ip ?? "" });
  pushCheck(checks, "variable_tables", scan.counts.variable_tables > 0 ? "ok" : "warning", scan.counts.variable_tables > 0
    ? `Found ${scan.counts.variable_tables} variable table file(s).`
    : "No variable table files were found.", { variable_tables: scan.counts.variable_tables });

  const orphanBlocks = graph.entry_blocks
    .filter((block) => block.toUpperCase() !== "MAIN")
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  pushCheck(checks, "orphan_blocks", orphanBlocks.length === 0 ? "ok" : "warning", orphanBlocks.length === 0
    ? "No uncalled entry blocks were detected."
    : `${orphanBlocks.length} block(s) have no incoming resolved CALL edge. Verify whether they are event/task entry blocks or unused code.`, { blocks: orphanBlocks.slice(0, 50) });

  const indexedPaths = new Set(scan.folder_index.entries.filter((entry) => entry.kind === "FILE" && entry.path).map((entry) => path.normalize(entry.path ?? "").toLowerCase()));
  const unindexedBlocks = blocks.blocks.filter((block) => !indexedPaths.has(path.normalize(block.path).toLowerCase()));
  pushCheck(checks, "folder_index_alignment", unindexedBlocks.length === 0 ? "ok" : "warning", unindexedBlocks.length === 0
    ? "All scanned block files are represented in folder.txt."
    : `${unindexedBlocks.length} scanned block file(s) are not represented in folder.txt.`, { files: unindexedBlocks.slice(0, 50).map((block) => block.name) });

  const largestBlocks = blocks.blocks
    .slice()
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, 10)
    .map((block) => ({ name: block.name, language: block.language, sizeBytes: block.sizeBytes }));

  return {
    project_path: projectPath,
    project_name: scan.project_name,
    generated_at: new Date().toISOString(),
    summary: {
      ...scan.counts,
      call_edges: graph.edges.length,
      unresolved_calls: graph.unresolved_calls.length,
      orphan_blocks: orphanBlocks.length,
      variable_records_sampled: variables.records.length,
    },
    communication,
    checks,
    orphan_blocks: orphanBlocks,
    largest_blocks: largestBlocks,
    warnings,
  };
}

export async function exportProjectSnapshot(options: ExportProjectSnapshotOptions): Promise<ExportProjectSnapshotResult> {
  const health = await inspectProjectHealth(options);
  const outputDirectory = resolveAbsolutePath(options.outputDirectory ?? path.join(process.cwd(), DEFAULT_OUTPUT_DIR, `${health.project_name}-snapshot`));
  await ensureDirectory(outputDirectory);

  const jsonPath = path.join(outputDirectory, "autoshop-project-snapshot.json");
  const markdownPath = path.join(outputDirectory, "autoshop-project-snapshot.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(health, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, renderHealthMarkdown(health), "utf8");

  return {
    project_path: health.project_path,
    output_directory: outputDirectory,
    artifacts: [jsonPath, markdownPath],
    health,
  };
}

function pushCheck(
  checks: AutoShopHealthCheck[],
  id: string,
  severity: AutoShopHealthCheck["severity"],
  message: string,
  evidence?: AutoShopHealthCheck["evidence"],
): void {
  checks.push({ id, severity, message, evidence });
}

function renderHealthMarkdown(health: InspectProjectHealthResult): string {
  return [
    `# AutoShop Project Snapshot: ${health.project_name}`,
    "",
    `- Project: ${health.project_path}`,
    `- Generated: ${health.generated_at}`,
    `- Programs: ${health.summary.programs} (${health.summary.ladder_blocks} LD, ${health.summary.st_blocks} ST)`,
    `- Function blocks: ${health.summary.function_blocks}`,
    `- Variable tables: ${health.summary.variable_tables}`,
    `- CALL edges: ${health.summary.call_edges}`,
    `- Unresolved calls: ${health.summary.unresolved_calls}`,
    `- Orphan blocks: ${health.summary.orphan_blocks}`,
    ...(health.communication?.ip ? [`- PLC IP: ${health.communication.ip}`] : []),
    "",
    "## Checks",
    ...health.checks.map((check) => `- [${check.severity.toUpperCase()}] ${check.id}: ${check.message}`),
    "",
    "## Largest Blocks",
    ...health.largest_blocks.map((block) => `- ${block.name}: ${block.language}, ${block.sizeBytes} bytes`),
    "",
    "## Orphan Blocks",
    ...(health.orphan_blocks.length > 0 ? health.orphan_blocks.map((block) => `- ${block}`) : ["- none"]),
    "",
  ].join("\n");
}
