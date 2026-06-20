import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AUTOSHOP_AI_COMMAND_FILE, AUTOSHOP_PROCESS_NAME, DEFAULT_AUTOSHOP_INSTALL_DIR } from "../constants.js";
import { AutoShopCommunicationConfig, AutoShopContextSelector, AutoShopInstructionCatalog, AutoShopOpenInstance } from "../types.js";
import { decodeAutoShopText } from "./text-decoder.js";
import { resolveAbsolutePath } from "./validation.js";

const execFileAsync = promisify(execFile);

interface RawAutoShopProcess {
  Id?: number;
  ProcessName?: string;
  Path?: string;
  MainWindowTitle?: string;
  StartTime?: string;
  IsForeground?: boolean;
}

export async function detectAutoShopInstances(): Promise<AutoShopOpenInstance[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const script = `
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$foregroundPid = 0
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AutoShopMcpWin32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
  $foregroundWindow = [AutoShopMcpWin32]::GetForegroundWindow()
  [uint32]$pidOut = 0
  [void][AutoShopMcpWin32]::GetWindowThreadProcessId($foregroundWindow, [ref]$pidOut)
  $foregroundPid = [int]$pidOut
} catch {}
$items = Get-Process -Name '${AUTOSHOP_PROCESS_NAME}' -ErrorAction SilentlyContinue | ForEach-Object {
  $started = $null
  try { $started = $_.StartTime.ToString('o') } catch {}
  [pscustomobject]@{
    Id = $_.Id
    ProcessName = $_.ProcessName
    Path = $_.Path
    MainWindowTitle = $_.MainWindowTitle
    StartTime = $started
    IsForeground = ($_.Id -eq $foregroundPid)
  }
}
$json = ConvertTo-Json -InputObject @($items) -Depth 5 -Compress
if ([string]::IsNullOrWhiteSpace($json)) { '[]' } else { $json }
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const parsed = parseProcessJson(stdout);
    const instances = await Promise.all(parsed.map(toOpenInstance));
    return instances.sort(compareInstances);
  } catch {
    return [];
  }
}

export async function getActiveAutoShopInstance(selector: AutoShopContextSelector = {}): Promise<AutoShopOpenInstance | undefined> {
  const instances = await detectAutoShopInstances();
  return selectAutoShopInstance(instances, selector);
}

export async function getActiveAutoShopProjectPath(selector: AutoShopContextSelector = {}): Promise<string> {
  const instances = await detectAutoShopInstances();
  const active = selectAutoShopInstance(instances, selector);
  if (!active) {
    const selection = describeSelector(selector);
    const choices = instances
      .map((instance) => `${instance.projectName ?? "unknown"} (PID ${instance.processId}, ${instance.projectPath ?? "no project path"})`)
      .join("; ");
    throw new Error(`No open AutoShop project matched ${selection}. Available projects: ${choices || "none"}. Use autoshop_detect_open_instances first, then pass an exact projectName or projectPath.`);
  }
  if (!active.projectPath) {
    throw new Error("No open AutoShop project was detected. Open a project in AutoShop or pass projectPath explicitly.");
  }
  if (!active.projectExists) {
    throw new Error(`AutoShop window reports project path "${active.projectPath}", but that directory was not found.`);
  }
  return active.projectPath;
}

export function selectAutoShopInstance(
  instances: AutoShopOpenInstance[],
  selector: AutoShopContextSelector = {},
): AutoShopOpenInstance | undefined {
  const normalizedSelectorPath = selector.projectPath ? path.normalize(selector.projectPath).toLowerCase() : undefined;
  const selectorProjectName = selector.projectName?.trim().toLowerCase();
  const selectorTitle = selector.windowTitleContains?.trim().toLowerCase();
  const envProjectPath = process.env.AUTOSHOP_PROJECT_PATH ? path.normalize(process.env.AUTOSHOP_PROJECT_PATH).toLowerCase() : undefined;
  const envProjectName = process.env.AUTOSHOP_PROJECT_NAME?.trim().toLowerCase();
  const envTitle = process.env.AUTOSHOP_WINDOW_TITLE?.trim().toLowerCase();

  const explicitMatchers: Array<(instance: AutoShopOpenInstance) => boolean> = [];
  if (normalizedSelectorPath) {
    explicitMatchers.push((instance) => Boolean(instance.projectPath && path.normalize(instance.projectPath).toLowerCase() === normalizedSelectorPath));
  }
  if (selectorProjectName) {
    explicitMatchers.push((instance) => instance.projectName?.toLowerCase() === selectorProjectName);
  }
  if (selectorTitle) {
    explicitMatchers.push((instance) => instance.mainWindowTitle.toLowerCase().includes(selectorTitle));
  }
  const explicitMatch = findFirstMatch(instances, explicitMatchers);
  if (explicitMatchers.length > 0) {
    return explicitMatch;
  }

  const environmentMatchers: Array<(instance: AutoShopOpenInstance) => boolean> = [];
  if (envProjectPath) {
    environmentMatchers.push((instance) => Boolean(instance.projectPath && path.normalize(instance.projectPath).toLowerCase() === envProjectPath));
  }
  if (envProjectName) {
    environmentMatchers.push((instance) => instance.projectName?.toLowerCase() === envProjectName);
  }
  if (envTitle) {
    environmentMatchers.push((instance) => instance.mainWindowTitle.toLowerCase().includes(envTitle));
  }
  const environmentMatch = findFirstMatch(instances, environmentMatchers);
  if (environmentMatchers.length > 0) {
    return environmentMatch;
  }

  return instances.find((instance) => instance.isForeground && instance.projectExists) ??
    instances.find((instance) => instance.isForeground) ??
    instances.find((instance) => instance.projectExists) ??
    instances[0];
}

function findFirstMatch(
  instances: AutoShopOpenInstance[],
  matchers: Array<(instance: AutoShopOpenInstance) => boolean>,
): AutoShopOpenInstance | undefined {
  for (const matcher of matchers) {
    const matched = instances.find((instance) => matcher(instance));
    if (matched) {
      return matched;
    }
  }
  return undefined;
}

function describeSelector(selector: AutoShopContextSelector): string {
  const parts = [
    selector.projectPath ? `projectPath="${selector.projectPath}"` : undefined,
    selector.projectName ? `projectName="${selector.projectName}"` : undefined,
    selector.windowTitleContains ? `windowTitleContains="${selector.windowTitleContains}"` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "the default AutoShop selection";
}

export async function readProjectCommunicationConfig(projectPath: string): Promise<AutoShopCommunicationConfig | undefined> {
  const fullProjectPath = resolveAbsolutePath(projectPath);
  const configPath = path.join(fullProjectPath, "config.ini");
  let text: string;
  try {
    text = decodeAutoShopText(await fs.readFile(configPath));
  } catch {
    return undefined;
  }

  const sections = parseIni(text);
  const comm = sections.get("comm_param");
  if (!comm) {
    return undefined;
  }

  return {
    sourcePath: configPath,
    type: comm.get("type"),
    ip: comm.get("ip"),
    adapterName: comm.get("adaptername"),
    ipName: comm.get("ipname"),
  };
}

export async function readInstructionCatalog(options: {
  installPath?: string;
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<AutoShopInstructionCatalog> {
  const installPath = resolveAbsolutePath(options.installPath ?? DEFAULT_AUTOSHOP_INSTALL_DIR);
  const sourceFile = path.join(installPath, AUTOSHOP_AI_COMMAND_FILE);
  const warnings: string[] = [];
  let instructions: string[] = [];

  try {
    const text = decodeAutoShopText(await fs.readFile(sourceFile));
    instructions = unique(
      [...text.matchAll(/<CMDINFO>([\s\S]*?)<\/CMDINFO>/g)]
        .map((match) => decodeXmlEntity(match[1]).trim())
        .filter((value) => value.length > 0),
    );
  } catch (error) {
    warnings.push(`Instruction catalog was not readable at ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const query = options.query?.trim().toLowerCase();
  const filtered = query
    ? instructions.filter((instruction) => instruction.toLowerCase().includes(query))
    : instructions;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);
  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    install_path: installPath,
    source_file: sourceFile,
    total_count: filtered.length,
    count: page.length,
    offset,
    has_more: nextOffset < filtered.length,
    next_offset: nextOffset < filtered.length ? nextOffset : undefined,
    instructions: page,
    warnings,
  };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseProcessJson(stdout: string): RawAutoShopProcess[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed) as RawAutoShopProcess | RawAutoShopProcess[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function toOpenInstance(raw: RawAutoShopProcess): Promise<AutoShopOpenInstance> {
  const titleInfo = parseAutoShopWindowTitle(raw.MainWindowTitle ?? "");
  const projectExists = titleInfo.projectPath ? await isDirectory(titleInfo.projectPath) : false;
  return {
    processId: raw.Id ?? 0,
    processName: raw.ProcessName ?? AUTOSHOP_PROCESS_NAME,
    executablePath: raw.Path || undefined,
    mainWindowTitle: raw.MainWindowTitle ?? "",
    isForeground: raw.IsForeground,
    productVersion: titleInfo.productVersion,
    projectPath: titleInfo.projectPath,
    projectName: titleInfo.projectPath ? path.basename(titleInfo.projectPath) : undefined,
    activeBlock: titleInfo.activeBlock,
    projectExists,
    startedAt: raw.StartTime || undefined,
  };
}

function compareInstances(left: AutoShopOpenInstance, right: AutoShopOpenInstance): number {
  return Number(right.isForeground) - Number(left.isForeground) ||
    Number(right.projectExists) - Number(left.projectExists) ||
    startedAtMs(right) - startedAtMs(left) ||
    right.processId - left.processId;
}

function startedAtMs(instance: AutoShopOpenInstance): number {
  if (!instance.startedAt) {
    return 0;
  }
  const value = Date.parse(instance.startedAt);
  return Number.isFinite(value) ? value : 0;
}

function parseAutoShopWindowTitle(title: string): {
  productVersion?: string;
  projectPath?: string;
  activeBlock?: string;
} {
  const withoutTitleNoise = title.trim();
  const activeBlockMatch = withoutTitleNoise.match(/\s+-\s+\[([^\]]+)\]\s*$/u);
  const activeBlock = activeBlockMatch?.[1];
  const beforeBlock = activeBlockMatch
    ? withoutTitleNoise.slice(0, activeBlockMatch.index).trim()
    : withoutTitleNoise;
  const match = beforeBlock.match(/^AutoShop\s+V(\S+)\s+(.+)$/u);
  if (!match) {
    return {};
  }
  return {
    productVersion: match[1],
    projectPath: path.normalize(match[2].trim()),
    activeBlock,
  };
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    const stat = await fs.stat(value);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = "";
  sections.set(current, new Map<string, string>());

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("//")) {
      continue;
    }
    const section = line.match(/^\[([^\]]+)\]/);
    if (section) {
      current = section[1].trim().toLowerCase();
      if (!sections.has(current)) {
        sections.set(current, new Map<string, string>());
      }
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    sections.get(current)?.set(key, value);
  }

  return sections;
}

function decodeXmlEntity(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
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
