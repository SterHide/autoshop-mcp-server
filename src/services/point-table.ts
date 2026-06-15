import fs from "node:fs/promises";
import path from "node:path";
import { PointDefinition } from "../types.js";
import { pointsToCsv } from "./format.js";
import { ensureDirectory, resolveAbsolutePath, validatePointTable } from "./validation.js";

export interface PointSourceInput {
  points?: PointDefinition[];
  pointTablePath?: string;
}

export async function loadPointDefinitions(input: PointSourceInput, baseDir = process.cwd()): Promise<{
  points: PointDefinition[];
  sourceDescription: string;
}> {
  if (input.points && input.points.length > 0) {
    return {
      points: input.points,
      sourceDescription: "inline points",
    };
  }

  if (!input.pointTablePath) {
    return {
      points: [],
      sourceDescription: "empty point set",
    };
  }

  const fullPath = resolveAbsolutePath(input.pointTablePath, baseDir);
  const text = await fs.readFile(fullPath, "utf8");
  const ext = path.extname(fullPath).toLowerCase();

  if (ext === ".json") {
    const parsed = JSON.parse(text) as unknown;
    const points = Array.isArray(parsed)
      ? (parsed as PointDefinition[])
      : isRecord(parsed) && Array.isArray(parsed.points)
        ? (parsed.points as PointDefinition[])
        : [];
    return {
      points,
      sourceDescription: fullPath,
    };
  }

  if (ext === ".csv") {
    const points = parsePointCsv(text);
    return {
      points,
      sourceDescription: fullPath,
    };
  }

  throw new Error(`Unsupported point table file extension "${ext}". Use .json or .csv.`);
}

export async function writePointArtifacts(
  outputDirectory: string,
  points: PointDefinition[],
): Promise<{
  jsonPath: string;
  csvPath: string;
}> {
  await ensureDirectory(outputDirectory);

  const jsonPath = path.join(outputDirectory, "points.json");
  const csvPath = path.join(outputDirectory, "points.csv");

  await fs.writeFile(jsonPath, `${JSON.stringify(points, null, 2)}\n`, "utf8");
  await fs.writeFile(csvPath, pointsToCsv(points), "utf8");

  return { jsonPath, csvPath };
}

export async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export function summarizePointValidation(points: PointDefinition[]): string[] {
  const report = validatePointTable(points);
  const lines = [`- Total points: ${points.length}`, `- Valid: ${report.isValid ? "yes" : "no"}`];
  if (report.errors.length > 0) {
    lines.push("- Errors:");
    for (const error of report.errors) {
      lines.push(`  - ${error}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push("- Warnings:");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  return lines;
}

function parsePointCsv(csv: string): PointDefinition[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const points: PointDefinition[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    points.push({
      name: row.name,
      area: row.area as PointDefinition["area"],
      address: Number.parseInt(row.address, 10),
      dataType: row.dataType as PointDefinition["dataType"],
      comment: row.comment || undefined,
      initialValue: parseInitialValue(row.initialValue),
    });
  }

  return points;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }
  cells.push(current);
  return cells;
}

function parseInitialValue(raw: string): string | number | boolean | undefined {
  if (raw === "") {
    return undefined;
  }

  const trimmed = raw.trim();
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
