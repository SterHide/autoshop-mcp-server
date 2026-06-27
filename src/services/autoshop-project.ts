import fs from "node:fs/promises";
import path from "node:path";
import {
  AutoShopBlockInfo,
  AutoShopFolderEntry,
  AutoShopInstructionSummary,
  AutoShopProgramLanguage,
  AutoShopProjectFile,
  AutoShopVariableRecord,
} from "../types.js";
import { decodeAutoShopText } from "./text-decoder.js";
import { resolveAbsolutePath } from "./validation.js";

const BLOCK_EXTENSIONS = new Set([".ld", ".st", ".fb"]);
const VARIABLE_EXTENSIONS = new Set([".gdt", ".gvt", ".csv", ".fbi", ".eipgvt", ".ecgvt"]);
const PROJECT_EXTENSIONS = new Set([".hcp", ".hcpp"]);
const CONFIG_EXTENSIONS = new Set([".cfg", ".dat", ".data", ".ini", ".sdt", ".svt"]);
const MAX_STRING_COUNT = 500;

export interface ScanProjectOptions {
  projectPath: string;
  includeFiles?: boolean;
}

export interface ScanProjectResult {
  project_path: string;
  project_name: string;
  project_files: AutoShopProjectFile[];
  counts: {
    programs: number;
    ladder_blocks: number;
    st_blocks: number;
    function_blocks: number;
    variable_tables: number;
    project_files: number;
    config_files: number;
    all_files: number;
  };
  folder_index: {
    exists: boolean;
    entries: AutoShopFolderEntry[];
  };
  warnings: string[];
}

export interface ListBlocksOptions {
  projectPath: string;
  language?: "LD" | "ST" | "FB" | "all";
  limit?: number;
  offset?: number;
}

export interface ListBlocksResult {
  project_path: string;
  total_count: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  blocks: AutoShopBlockInfo[];
}

export interface ReadBlockOptions {
  projectPath: string;
  blockName: string;
  includeRawStrings?: boolean;
  maxStrings?: number;
}

export interface ReadBlockResult {
  project_path: string;
  block: AutoShopBlockInfo;
  source_kind: "text" | "binary_strings";
  text_preview: string;
  raw_strings?: string[];
  summary: AutoShopInstructionSummary;
  warnings: string[];
}

export interface SearchSymbolsOptions {
  projectPath: string;
  query: string;
  fileTypes?: Array<"blocks" | "variables" | "config">;
  limit?: number;
  offset?: number;
}

export interface SearchSymbolsResult {
  project_path: string;
  query: string;
  total_count: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  warnings: string[];
  matches: Array<{
    file: string;
    path: string;
    kind: "block" | "variable" | "config";
    snippets: string[];
  }>;
}

export interface ParseVariablesOptions {
  projectPath: string;
  tableName?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface ParseVariablesResult {
  project_path: string;
  total_count: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  records: AutoShopVariableRecord[];
  warnings: string[];
}

export async function scanProject(options: ScanProjectOptions): Promise<ScanProjectResult> {
  const projectPath = await requireProjectDirectory(options.projectPath);
  const files = await listProjectFiles(projectPath);
  const folderEntries = await readFolderIndex(projectPath);
  const blocks = await listAllBlocks(projectPath, files, folderEntries);
  const variableTables = files.filter((file) => VARIABLE_EXTENSIONS.has(file.extension.toLowerCase()));
  const projectFiles = files.filter((file) => PROJECT_EXTENSIONS.has(file.extension.toLowerCase()));
  const configFiles = files.filter((file) => CONFIG_EXTENSIONS.has(file.extension.toLowerCase()));
  const warnings = buildProjectWarnings(projectPath, projectFiles, folderEntries);

  return {
    project_path: projectPath,
    project_name: path.basename(projectPath),
    project_files: options.includeFiles ? files : [],
    counts: {
      programs: blocks.filter((block) => block.category === "PROG").length,
      ladder_blocks: blocks.filter((block) => block.language === "LD").length,
      st_blocks: blocks.filter((block) => block.language === "ST").length,
      function_blocks: blocks.filter((block) => block.language === "FB").length,
      variable_tables: variableTables.length,
      project_files: projectFiles.length,
      config_files: configFiles.length,
      all_files: files.length,
    },
    folder_index: {
      exists: folderEntries.length > 0,
      entries: folderEntries,
    },
    warnings,
  };
}

export async function listBlocks(options: ListBlocksOptions): Promise<ListBlocksResult> {
  const projectPath = await requireProjectDirectory(options.projectPath);
  const files = await listProjectFiles(projectPath);
  const folderEntries = await readFolderIndex(projectPath);
  const language = options.language ?? "all";
  const allBlocks = await listAllBlocks(projectPath, files, folderEntries);
  const filtered = language === "all" ? allBlocks : allBlocks.filter((block) => block.language === language);
  const page = paginate(filtered, options.limit ?? 50, options.offset ?? 0);

  return {
    project_path: projectPath,
    total_count: filtered.length,
    count: page.items.length,
    offset: page.offset,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    blocks: page.items,
  };
}

export async function readBlock(options: ReadBlockOptions): Promise<ReadBlockResult> {
  const projectPath = await requireProjectDirectory(options.projectPath);
  const files = await listProjectFiles(projectPath);
  const folderEntries = await readFolderIndex(projectPath);
  const block = await findBlock(projectPath, options.blockName, files, folderEntries);
  const buffer = await fs.readFile(block.path);
  const isText = isMostlyText(buffer);
  const decodedText = isText ? decodeTextFile(buffer) : undefined;
  const rawStrings = decodedText !== undefined ? decodedText.split(/\r?\n/) : extractUtf8Strings(buffer, options.maxStrings);
  const cleaned = rawStrings.map(cleanExtractedString).filter(isUsefulExtractedString);
  const preview = decodedText ?? cleaned.join("\n");
  const summary = summarizeInstructions(cleaned);
  const warnings = block.language === "LD" || block.language === "FB"
    ? ["AutoShop LD/FB files are proprietary binary containers. This tool extracts readable instructions and symbols, not a lossless ladder source export."]
    : [];

  return {
    project_path: projectPath,
    block,
    source_kind: isText ? "text" : "binary_strings",
    text_preview: preview,
    raw_strings: options.includeRawStrings ? limitStrings(cleaned, options.maxStrings) : undefined,
    summary,
    warnings,
  };
}

export async function searchSymbols(options: SearchSymbolsOptions): Promise<SearchSymbolsResult> {
  const projectPath = await requireProjectDirectory(options.projectPath);
  const query = options.query.trim();
  if (query.length === 0) {
    throw new Error("query must not be empty.");
  }

  const selected = new Set(options.fileTypes ?? ["blocks", "variables", "config"]);
  const files = await listProjectFiles(projectPath);
  const searchable = files.filter((file) => {
    const ext = file.extension.toLowerCase();
    if (selected.has("blocks") && BLOCK_EXTENSIONS.has(ext)) {
      return true;
    }
    if (selected.has("variables") && VARIABLE_EXTENSIONS.has(ext)) {
      return true;
    }
    if (selected.has("config") && (CONFIG_EXTENSIONS.has(ext) || PROJECT_EXTENSIONS.has(ext))) {
      return true;
    }
    return false;
  });

  const matches: SearchSymbolsResult["matches"] = [];
  const warnings: string[] = [];
  for (const file of searchable) {
    const buffer = await readBufferSkippingLocked(file.path, warnings);
    if (!buffer) {
      continue;
    }
    const strings = isMostlyText(buffer) ? decodeTextFile(buffer).split(/\r?\n/) : extractUtf8Strings(buffer, MAX_STRING_COUNT);
    const snippets = strings
      .map(cleanExtractedString)
      .filter((line) => line.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);
    if (snippets.length > 0) {
      matches.push({
        file: file.name,
        path: file.path,
        kind: classifySearchFile(file),
        snippets,
      });
    }
  }

  const page = paginate(matches, options.limit ?? 50, options.offset ?? 0);
  return {
    project_path: projectPath,
    query,
    total_count: matches.length,
    count: page.items.length,
    offset: page.offset,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    warnings,
    matches: page.items,
  };
}

export async function parseVariableTables(options: ParseVariablesOptions): Promise<ParseVariablesResult> {
  const projectPath = await requireProjectDirectory(options.projectPath);
  const files = await listProjectFiles(projectPath);
  const query = options.query?.trim().toLowerCase();
  const tableName = options.tableName?.trim().toLowerCase();
  const variableFiles = files.filter((file) => {
    if (!VARIABLE_EXTENSIONS.has(file.extension.toLowerCase())) {
      return false;
    }
    return tableName ? file.name.toLowerCase().includes(tableName) : true;
  });

  const records: AutoShopVariableRecord[] = [];
  const warnings: string[] = [];
  for (const file of variableFiles) {
    const fileRecords = await parseVariableFile(file);
    records.push(...fileRecords);
  }

  const filtered = query
    ? records.filter((record) => record.text.toLowerCase().includes(query))
    : records;
  const page = paginate(filtered, options.limit ?? 100, options.offset ?? 0);

  if (records.length === 0) {
    warnings.push("No variable records were extracted. AutoShop variable files are partially proprietary; try a broader tableName or inspect .gvt/.gdt files.");
  }

  return {
    project_path: projectPath,
    total_count: filtered.length,
    count: page.items.length,
    offset: page.offset,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    records: page.items,
    warnings,
  };
}

async function requireProjectDirectory(input: string): Promise<string> {
  const fullPath = resolveAbsolutePath(input);
  const stat = await fs.stat(fullPath);
  if (!stat.isDirectory()) {
    throw new Error(`AutoShop project path must be a directory: ${fullPath}`);
  }
  return fullPath;
}

async function listProjectFiles(projectPath: string): Promise<AutoShopProjectFile[]> {
  const entries = await fs.readdir(projectPath, { withFileTypes: true });
  const files: AutoShopProjectFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(projectPath, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      name: entry.name,
      path: fullPath,
      extension: path.extname(entry.name),
      sizeBytes: stat.size,
      modifiedTime: stat.mtime.toISOString(),
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

async function readFolderIndex(projectPath: string): Promise<AutoShopFolderEntry[]> {
  const folderPath = path.join(projectPath, "folder.txt");
  try {
    const text = decodeAutoShopText(await fs.readFile(folderPath));
    return parseFolderIndex(text, projectPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function parseFolderIndex(text: string, projectPath: string): AutoShopFolderEntry[] {
  const entries: AutoShopFolderEntry[] = [];
  let category: AutoShopFolderEntry["category"] = "UNKNOWN";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line === "AutoShop" || /^\d+$/.test(line)) {
      continue;
    }
    if (line === "PROG" || line === "VAR" || line === "FB" || line === "FC") {
      category = line;
      continue;
    }

    const parts = line.split(/\t+/).filter(Boolean);
    const kind = parts[0] as AutoShopFolderEntry["kind"];
    if (kind === "ROOT" || kind === "STRUROOT" || kind === "ENUMROOT") {
      entries.push({ category, kind, name: parts[1] ?? kind });
      continue;
    }
    if (kind === "FILE" && parts[1]) {
      entries.push({
        category,
        kind,
        name: parts[1],
        path: path.join(projectPath, parts[1]),
      });
    }
  }
  return entries;
}

async function listAllBlocks(
  projectPath: string,
  files: AutoShopProjectFile[],
  folderEntries: AutoShopFolderEntry[],
): Promise<AutoShopBlockInfo[]> {
  const folderByName = new Map(folderEntries.filter((entry) => entry.kind === "FILE").map((entry) => [entry.name.toLowerCase(), entry]));
  const blockFiles = files.filter((file) => BLOCK_EXTENSIONS.has(file.extension.toLowerCase()));
  const blocks = await Promise.all(blockFiles.map(async (file) => {
    const folderEntry = folderByName.get(file.name.toLowerCase());
    return toBlockInfo(projectPath, file, folderEntry);
  }));
  return blocks.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

async function toBlockInfo(
  projectPath: string,
  file: AutoShopProjectFile,
  folderEntry?: AutoShopFolderEntry,
): Promise<AutoShopBlockInfo> {
  const buffer = await readBufferSkippingLocked(file.path);
  return {
    ...file,
    blockName: path.basename(file.name, file.extension),
    language: languageFromExtension(file.extension),
    category: blockCategory(folderEntry?.category, file.extension),
    listedInFolderIndex: Boolean(folderEntry),
    autoShopBinary: buffer ? buffer.includes(Buffer.from("AutoShop", "utf8")) : false,
  };
}

async function findBlock(
  projectPath: string,
  blockName: string,
  files: AutoShopProjectFile[],
  folderEntries: AutoShopFolderEntry[],
): Promise<AutoShopBlockInfo> {
  const normalized = blockName.trim().toLowerCase();
  const candidates = await listAllBlocks(projectPath, files, folderEntries);
  const found = candidates.find((block) =>
    block.blockName.toLowerCase() === normalized ||
    block.name.toLowerCase() === normalized ||
    block.name.toLowerCase() === `${normalized}.ld` ||
    block.name.toLowerCase() === `${normalized}.st` ||
    block.name.toLowerCase() === `${normalized}.fb`
  );
  if (!found) {
    throw new Error(`Block "${blockName}" was not found in ${projectPath}. Use autoshop_list_program_blocks first to check the exact name.`);
  }
  return found;
}

function languageFromExtension(extension: string): AutoShopProgramLanguage {
  switch (extension.toLowerCase()) {
    case ".ld":
      return "LD";
    case ".st":
      return "ST";
    case ".fb":
      return "FB";
    default:
      return "UNKNOWN";
  }
}

function categoryFromExtension(extension: string): AutoShopBlockInfo["category"] {
  return extension.toLowerCase() === ".fb" ? "FB" : "PROG";
}

function blockCategory(
  folderCategory: AutoShopFolderEntry["category"] | undefined,
  extension: string,
): AutoShopBlockInfo["category"] {
  if (folderCategory === "PROG" || folderCategory === "FB" || folderCategory === "FC") {
    return folderCategory;
  }
  return categoryFromExtension(extension);
}

function isMostlyText(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) {
      printable += 1;
    }
  }
  return printable / sample.length > 0.9;
}

function decodeTextFile(buffer: Buffer): string {
  return decodeAutoShopText(buffer);
}

function extractUtf8Strings(buffer: Buffer, maxStrings?: number): string[] {
  const strings: string[] = [];
  let current: number[] = [];

  for (const byte of buffer) {
    if (byte === 0) {
      pushCurrent();
      if (hasReachedStringLimit(strings, maxStrings)) {
        break;
      }
      continue;
    }
    current.push(byte);
  }
  pushCurrent();

  function pushCurrent(): void {
    if (current.length === 0) {
      return;
    }
    const text = Buffer.from(current).toString("utf8");
    current = [];
    if (text.trim().length >= 2) {
      strings.push(text);
    }
  }

  return limitStrings(strings, maxStrings);
}

function hasReachedStringLimit(strings: string[], maxStrings: number | undefined): boolean {
  return maxStrings !== undefined && strings.length >= maxStrings;
}

function limitStrings<T>(strings: T[], maxStrings: number | undefined): T[] {
  return maxStrings === undefined ? strings : strings.slice(0, maxStrings);
}

function cleanExtractedString(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
    .replace(/\uFFFD+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulExtractedString(value: string): boolean {
  if (value.length < 2) {
    return false;
  }
  if (/^[\W_]+$/.test(value)) {
    return false;
  }
  return /[\p{Letter}\p{Number}_]/u.test(value);
}

function summarizeInstructions(strings: string[]): AutoShopInstructionSummary {
  const instructionPattern = /\b(CALL|LD[<>=]?|LD|SET|RST|MOV|STRMOV|TONR?|TOF|OUT|AND|OR|INCP|DEC|CMP|ADD|SUB|MUL|DIV)\b[^\r\n]*/iu;
  const symbolPattern = /\b(?:[MXYSDRBTCVZ]\d+(?:\.\d+)?|K\d+|T\d+|C\d+)\b/giu;
  const commentPattern = /网络注释|注释|参数|报警|流程|模式|初始化|通讯|电机|抛光|启动|停止|故障|复位|手动|自动/;
  const instructions = unique(strings.map((line) => line.match(instructionPattern)?.[0]).filter(isString));
  const calls = unique(instructions.filter((line) => /^CALL\s+/i.test(line)).map((line) => line.replace(/^CALL\s+/i, "").trim()));
  const comments = unique(strings.filter((line) => commentPattern.test(line)));
  const symbols = unique(strings.flatMap((line) => line.match(symbolPattern) ?? []));

  return {
    instructions,
    calls,
    comments,
    symbols,
  };
}

async function parseVariableFile(file: AutoShopProjectFile): Promise<AutoShopVariableRecord[]> {
  const buffer = await fs.readFile(file.path);
  const records: AutoShopVariableRecord[] = [];
  const tableName = path.basename(file.name, file.extension);
  const ext = file.extension.toLowerCase();

  if (ext === ".csv") {
    const text = decodeTextFile(buffer);
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    for (const line of lines) {
      if (line === "_var_begin" || line.startsWith("checkposition") || line.startsWith("FullName")) {
        continue;
      }
      records.push(toVariableRecord(file.name, tableName, line, "csv_row"));
    }
    return records;
  }

  const strings = extractUtf8Strings(buffer, MAX_STRING_COUNT)
    .map(cleanExtractedString)
    .filter((line) => isUsefulExtractedString(line) && isLikelyVariableText(line));
  for (const text of unique(strings, MAX_STRING_COUNT)) {
    records.push(toVariableRecord(file.name, tableName, text, "binary_string"));
  }
  return records;
}

function toVariableRecord(
  file: string,
  tableName: string,
  text: string,
  sourceKind: AutoShopVariableRecord["sourceKind"],
): AutoShopVariableRecord {
  const address = text.match(/\b([MXYSDRBTCVZ])(\d+)(?:\.\d+)?\b/i);
  const description = text.replace(/^[\u0001-\u001F\W]*[A-Z]?\d+[\u0001-\u001F\W]*/i, "").trim() || undefined;
  return {
    file,
    tableName,
    text,
    area: address?.[1]?.toUpperCase(),
    address: address?.[2] ? Number.parseInt(address[2], 10) : undefined,
    description,
    sourceKind,
  };
}

function isLikelyVariableText(value: string): boolean {
  return /\b[MXYSDRBTCVZ]\d+(?:\.\d+)?\b/i.test(value) ||
    /[\u4e00-\u9fff]/u.test(value) ||
    /^[A-Za-z_][\w\u4e00-\u9fff]{1,80}$/.test(value);
}

function classifySearchFile(file: AutoShopProjectFile): "block" | "variable" | "config" {
  const ext = file.extension.toLowerCase();
  if (BLOCK_EXTENSIONS.has(ext)) {
    return "block";
  }
  if (VARIABLE_EXTENSIONS.has(ext)) {
    return "variable";
  }
  return "config";
}

function buildProjectWarnings(
  projectPath: string,
  projectFiles: AutoShopProjectFile[],
  folderEntries: AutoShopFolderEntry[],
): string[] {
  const warnings: string[] = [];
  if (projectFiles.length === 0) {
    warnings.push(`No .hcp/.hcpp project files were found in ${projectPath}. Verify this is the AutoShop project root.`);
  }
  if (folderEntries.length === 0) {
    warnings.push("folder.txt was not found or did not contain an AutoShop index. Block categories may be inferred only from file extensions.");
  }
  warnings.push("No public AutoShop Openness-style API was confirmed. This MCP uses read-only project-file analysis plus protocol communication.");
  return warnings;
}

function paginate<T>(items: T[], requestedLimit: number, requestedOffset: number): {
  items: T[];
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
} {
  const limit = Math.min(Math.max(requestedLimit, 1), 500);
  const offset = Math.max(requestedOffset, 0);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    offset,
    hasMore: nextOffset < items.length,
    nextOffset: nextOffset < items.length ? nextOffset : undefined,
  };
}

async function readBufferSkippingLocked(filePath: string, warnings?: string[]): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && (error.code === "EBUSY" || error.code === "EPERM" || error.code === "EACCES")) {
      warnings?.push(`Skipped locked file: ${path.basename(filePath)} (${error.code}). AutoShop is likely holding it open right now.`);
      return undefined;
    }
    throw error;
  }
}

function unique<T>(values: T[], limit?: number): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
    if (limit !== undefined && result.length >= limit) {
      break;
    }
  }
  return result;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
