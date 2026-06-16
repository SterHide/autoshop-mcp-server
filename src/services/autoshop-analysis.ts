import { AutoShopCallGraphEdge, AutoShopCallGraphNode } from "../types.js";
import { listBlocks, readBlock } from "./autoshop-project.js";

export interface AnalyzeCallGraphOptions {
  projectPath: string;
  maxBlocks?: number;
}

export interface AnalyzeCallGraphResult {
  project_path: string;
  scanned_blocks: number;
  total_blocks: number;
  truncated: boolean;
  entry_blocks: string[];
  nodes: AutoShopCallGraphNode[];
  edges: AutoShopCallGraphEdge[];
  unresolved_calls: string[];
  warnings: string[];
}

export async function analyzeCallGraph(options: AnalyzeCallGraphOptions): Promise<AnalyzeCallGraphResult> {
  const maxBlocks = Math.min(Math.max(options.maxBlocks ?? 250, 1), 1000);
  const listed = await listBlocks({
    projectPath: options.projectPath,
    language: "all",
    limit: maxBlocks,
    offset: 0,
  });

  const nodes: AutoShopCallGraphNode[] = listed.blocks.map((block) => ({
    blockName: block.blockName,
    file: block.name,
    language: block.language,
    category: block.category,
  }));
  const byName = new Map<string, AutoShopCallGraphNode>();
  for (const node of nodes) {
    byName.set(normalizeBlockName(node.blockName), node);
    byName.set(normalizeBlockName(node.file), node);
  }

  const edges: AutoShopCallGraphEdge[] = [];
  const warnings: string[] = [];
  for (const block of listed.blocks) {
    try {
      const source = await readBlock({
        projectPath: options.projectPath,
        blockName: block.name,
        includeRawStrings: false,
        maxStrings: 1000,
      });
      for (const call of source.summary.calls) {
        const target = byName.get(normalizeBlockName(call)) ?? byName.get(normalizeBlockName(`${call}.LD`));
        edges.push({
          from: block.blockName,
          to: call,
          resolved: Boolean(target),
          targetFile: target?.file,
        });
      }
    } catch (error) {
      warnings.push(`Skipped ${block.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const incoming = new Set(edges.filter((edge) => edge.resolved).map((edge) => normalizeBlockName(edge.to)));
  const entryBlocks = nodes
    .filter((node) => node.blockName.toUpperCase() === "MAIN" || !incoming.has(normalizeBlockName(node.blockName)))
    .map((node) => node.blockName);

  const unresolvedCalls = unique(edges.filter((edge) => !edge.resolved).map((edge) => edge.to));
  if (listed.has_more) {
    warnings.push(`Call graph was truncated at ${maxBlocks} blocks. Increase maxBlocks to scan more.`);
  }

  return {
    project_path: listed.project_path,
    scanned_blocks: listed.blocks.length,
    total_blocks: listed.total_count,
    truncated: listed.has_more,
    entry_blocks: unique(entryBlocks),
    nodes,
    edges,
    unresolved_calls: unresolvedCalls,
    warnings,
  };
}

function normalizeBlockName(value: string): string {
  return value.replace(/\.(LD|ST|FB)$/iu, "").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}
