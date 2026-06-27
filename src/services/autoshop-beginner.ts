import path from "node:path";
import { AutoShopBlockInfo, AutoShopCommunicationConfig, AutoShopVariableRecord } from "../types.js";
import { analyzeCallGraph } from "./autoshop-analysis.js";
import { listBlocks, parseVariableTables, readBlock, scanProject } from "./autoshop-project.js";
import { readProjectCommunicationConfig } from "./autoshop-runtime.js";
import { resolveAbsolutePath } from "./validation.js";

export interface ExplainProjectForBeginnerOptions {
  projectPath: string;
  maxBlocks?: number;
  variableLimit?: number;
}

export interface ExplainBlockForBeginnerOptions {
  projectPath: string;
  blockName: string;
  maxStrings?: number;
}

export interface BeginnerProjectExplanation {
  project_path: string;
  project_name: string;
  generated_at: string;
  beginner_summary: string[];
  read_this_first: string[];
  structure: {
    program_count: number;
    ladder_blocks: number;
    st_blocks: number;
    function_blocks: number;
    variable_tables: number;
    likely_entry_block: string;
  };
  communication?: AutoShopCommunicationConfig;
  program_flow: {
    main_calls: Array<{
      order: number;
      block: string;
      resolved: boolean;
      plain_meaning: string;
    }>;
    other_entry_blocks: string[];
    unresolved_calls: string[];
  };
  program_areas: Array<{
    area: string;
    blocks: string[];
    plain_meaning: string;
  }>;
  variable_hints: Array<{
    file: string;
    text: string;
    address?: string;
    plain_meaning: string;
  }>;
  next_questions: string[];
  glossary: Record<string, string>;
  warnings: string[];
}

export interface BeginnerBlockExplanation {
  project_path: string;
  block: {
    name: string;
    file: string;
    language: string;
    category: string;
  };
  role: string;
  language_explanation: string;
  beginner_summary: string[];
  calls: Array<{
    block: string;
    plain_meaning: string;
  }>;
  instruction_hints: Array<{
    instruction: string;
    plain_meaning: string;
  }>;
  symbol_hints: Array<{
    symbol: string;
    plain_meaning: string;
  }>;
  comments: string[];
  suggested_next_steps: string[];
  preview: string;
  warnings: string[];
}

export async function explainProjectForBeginner(options: ExplainProjectForBeginnerOptions): Promise<BeginnerProjectExplanation> {
  const projectPath = resolveAbsolutePath(options.projectPath);
  const maxBlocks = clamp(options.maxBlocks ?? 250, 1, 1000);
  const variableLimit = clamp(options.variableLimit ?? 80, 1, 500);
  const [scan, blocks, graph, variables, communication] = await Promise.all([
    scanProject({ projectPath, includeFiles: false }),
    listBlocks({ projectPath, language: "all", limit: maxBlocks, offset: 0 }),
    analyzeCallGraph({ projectPath, maxBlocks }),
    parseVariableTables({ projectPath, limit: variableLimit, offset: 0 }),
    readProjectCommunicationConfig(projectPath),
  ]);

  const mainCalls = graph.edges
    .filter((edge) => edge.from.toUpperCase() === "MAIN")
    .map((edge, index) => ({
      order: index + 1,
      block: edge.to,
      resolved: edge.resolved,
      plain_meaning: describeBlockName(edge.to),
    }));
  const otherEntryBlocks = graph.entry_blocks.filter((block) => block.toUpperCase() !== "MAIN");

  return {
    project_path: projectPath,
    project_name: scan.project_name,
    generated_at: new Date().toISOString(),
    beginner_summary: [
      `这个工程可以先从 MAIN 看起。MAIN 通常像“总目录”，负责按顺序调用初始化、主流程、模式选择、数据处理等子程序。`,
      `工程里共有 ${scan.counts.programs} 个程序块，其中 ${scan.counts.ladder_blocks} 个是梯形图块，${scan.counts.st_blocks} 个是 ST 文本块。`,
      mainCalls.length > 0
        ? `MAIN 里提取到 ${mainCalls.length} 个 CALL 调用。对小白来说，先按 MAIN 的调用顺序逐个读子程序，比直接搜索全部变量更容易。`
        : "没有从 MAIN 提取到 CALL 调用。建议先读取 MAIN 块，看它是否使用了其他方式组织流程。",
      communication?.ip
        ? `工程配置里能看到 PLC IP：${communication.ip}。这通常是下载、在线监控或上位通讯时会用到的地址。`
        : "工程配置里没有提取到 PLC IP，需要在 AutoShop 通讯配置里确认。",
    ],
    read_this_first: unique(["MAIN", ...mainCalls.map((call) => call.block), ...otherEntryBlocks]).slice(0, 20),
    structure: {
      program_count: scan.counts.programs,
      ladder_blocks: scan.counts.ladder_blocks,
      st_blocks: scan.counts.st_blocks,
      function_blocks: scan.counts.function_blocks,
      variable_tables: scan.counts.variable_tables,
      likely_entry_block: graph.entry_blocks.includes("MAIN") ? "MAIN" : graph.entry_blocks[0] ?? "unknown",
    },
    communication,
    program_flow: {
      main_calls: mainCalls,
      other_entry_blocks: otherEntryBlocks,
      unresolved_calls: graph.unresolved_calls,
    },
    program_areas: summarizeProgramAreas(blocks.blocks),
    variable_hints: summarizeVariableHints(variables.records),
    next_questions: [
      "先解释 MAIN 每一行 CALL 的作用。",
      "按设备动作顺序说明每个 SBR 子程序负责什么。",
      "找出启动、停止、急停、复位、报警相关变量。",
      "解释某一个具体块，比如 autoshop_explain_block_for_beginner 读取 SBR_B0_主程序。",
      "把程序流程整理成设备动作时序表。",
    ],
    glossary: beginnerGlossary(),
    warnings: [...scan.warnings, ...graph.warnings, ...variables.warnings],
  };
}

export async function explainBlockForBeginner(options: ExplainBlockForBeginnerOptions): Promise<BeginnerBlockExplanation> {
  const projectPath = resolveAbsolutePath(options.projectPath);
  const source = await readBlock({
    projectPath,
    blockName: options.blockName,
    includeRawStrings: false,
    maxStrings: options.maxStrings,
  });
  const block = source.block;
  const calls = source.summary.calls.slice(0, 50).map((call) => ({
    block: call,
    plain_meaning: describeBlockName(call),
  }));
  const instructionHints = summarizeInstructionHints(source.summary.instructions);
  const symbolHints = summarizeSymbolHints(source.summary.symbols);
  const comments = source.summary.comments.slice(0, 30);

  return {
    project_path: projectPath,
    block: {
      name: block.blockName,
      file: block.name,
      language: block.language,
      category: block.category,
    },
    role: describeBlockRole(block),
    language_explanation: describeLanguage(block.language),
    beginner_summary: [
      `${block.blockName} 的角色：${describeBlockRole(block)}`,
      `这个块是 ${describeLanguage(block.language)}`,
      calls.length > 0
        ? `它会继续调用 ${calls.length} 个子程序。读程序时可以把这些 CALL 当成“下一层目录”。`
        : "没有提取到 CALL 调用，说明这个块可能主要是直接执行触点、线圈、赋值、定时或运算逻辑。",
      symbolHints.length > 0
        ? `提取到 ${symbolHints.length} 个常见地址符号。小白可以先区分 X/Y/M/D/T/C 这些地址类型。`
        : "没有提取到明显地址符号，可能是二进制块可读信息有限，或变量使用了符号名。",
    ],
    calls,
    instruction_hints: instructionHints,
    symbol_hints: symbolHints,
    comments,
    suggested_next_steps: [
      calls.length > 0 ? `继续解释被调用的第一个块：${calls[0].block}` : `搜索 ${block.blockName} 里出现的关键变量。`,
      "把这个块里的 X 输入、Y 输出、M 中间位、D 数据寄存器分别列出来。",
      "结合变量表，说明这些地址对应实际按钮、电机、气缸、传感器或参数。",
    ],
    preview: source.text_preview.slice(0, 4000),
    warnings: source.warnings,
  };
}

function summarizeProgramAreas(blocks: AutoShopBlockInfo[]): BeginnerProjectExplanation["program_areas"] {
  const groups = new Map<string, string[]>();
  for (const block of blocks) {
    const area = inferAreaName(block.blockName);
    const list = groups.get(area) ?? [];
    list.push(block.blockName);
    groups.set(area, list);
  }
  return [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0], "zh-Hans-CN"))
    .slice(0, 12)
    .map(([area, names]) => ({
      area,
      blocks: names.slice(0, 20),
      plain_meaning: describeArea(area),
    }));
}

function summarizeVariableHints(records: AutoShopVariableRecord[]): BeginnerProjectExplanation["variable_hints"] {
  return records
    .filter((record) => record.area || /[\u4e00-\u9fff]/u.test(record.text))
    .slice(0, 40)
    .map((record) => ({
      file: record.file,
      text: record.text,
      address: record.area && record.address !== undefined ? `${record.area}${record.address}` : undefined,
      plain_meaning: record.area ? describeAddress(`${record.area}${record.address ?? ""}`) : "这是从变量表里提取到的符号或中文说明，需要结合上下文确认含义。",
    }));
}

function summarizeInstructionHints(instructions: string[]): BeginnerBlockExplanation["instruction_hints"] {
  return unique(instructions)
    .slice(0, 80)
    .map((instruction) => ({
      instruction,
      plain_meaning: describeInstruction(instruction),
    }));
}

function summarizeSymbolHints(symbols: string[]): BeginnerBlockExplanation["symbol_hints"] {
  return unique(symbols)
    .slice(0, 80)
    .map((symbol) => ({
      symbol,
      plain_meaning: describeAddress(symbol),
    }));
}

function inferAreaName(blockName: string): string {
  if (blockName.toUpperCase() === "MAIN") {
    return "MAIN 主入口";
  }
  const keyword = [
    "初始化",
    "主程序",
    "模式",
    "流程",
    "数据",
    "采集",
    "处理",
    "报警",
    "通讯",
    "配方",
    "按钮",
    "气缸",
    "电机",
    "轴",
  ].find((value) => blockName.includes(value));
  if (keyword) {
    return keyword;
  }
  const match = blockName.match(/^([A-Za-z]+_[A-Za-z0-9]+)/);
  return match?.[1] ?? "未归类";
}

function describeArea(area: string): string {
  if (area.includes("MAIN")) {
    return "程序入口，通常负责把各个子程序串起来。";
  }
  if (area.includes("初始化")) {
    return "上电或启动前的初始状态、参数、复位逻辑。";
  }
  if (area.includes("主程序")) {
    return "设备正常运行时的核心逻辑。";
  }
  if (area.includes("模式")) {
    return "自动、手动、调试、停止等模式切换逻辑。";
  }
  if (area.includes("流程")) {
    return "按步骤推进的动作顺序或工艺流程。";
  }
  if (area.includes("报警")) {
    return "故障、报警、保护和停机条件。";
  }
  if (area.includes("通讯")) {
    return "PLC 与触摸屏、上位机、伺服或远程模块之间的数据交换。";
  }
  if (area.includes("数据") || area.includes("采集") || area.includes("处理")) {
    return "采集传感器或工艺数据，并整理成后续逻辑要用的状态。";
  }
  return "按块名自动归类的程序区域，需要结合 MAIN 调用顺序和变量进一步确认。";
}

function describeBlockRole(block: AutoShopBlockInfo): string {
  if (block.blockName.toUpperCase() === "MAIN") {
    return "主程序入口，建议从这里开始读。它通常像目录一样调用各个子程序。";
  }
  if (block.category === "FB" || block.language === "FB" || block.blockName.toUpperCase().startsWith("FB_")) {
    return "功能块，通常是可复用的设备或动作逻辑，比如按钮、气缸、电机控制。";
  }
  if (block.blockName.toUpperCase().startsWith("SBR")) {
    return `子程序，通常由 MAIN 或其他子程序通过 CALL 调用。${describeBlockName(block.blockName)}`;
  }
  return `${block.category} 程序块。${describeBlockName(block.blockName)}`;
}

function describeBlockName(blockName: string): string {
  const name = path.basename(blockName, path.extname(blockName));
  const hints = [
    ["初始化", "大概率负责上电初始化、复位默认值或清状态。"],
    ["主程序", "大概率是某个设备或工位的主运行逻辑。"],
    ["模式", "大概率负责自动、手动、停止、调试等模式选择。"],
    ["流程", "大概率负责步骤顺序、动作节拍或工艺流程。"],
    ["数据采集", "大概率负责读取传感器、状态或工艺数据。"],
    ["数据处理", "大概率负责把采集到的数据换算、筛选或生成判断条件。"],
    ["报警", "大概率负责故障判断、报警保持或复位。"],
    ["通讯", "大概率负责触摸屏、上位机、伺服或远程模块通讯。"],
    ["配方", "大概率负责工艺参数、产品参数或配方切换。"],
    ["按钮", "大概率负责按钮输入、保持、沿触发或人机操作。"],
    ["气缸", "大概率负责气缸动作、到位检测和互锁。"],
    ["电机", "大概率负责电机启停、运行条件和保护。"],
    ["轴", "大概率负责伺服轴、运动轴或补偿逻辑。"],
  ].find(([keyword]) => name.includes(keyword));
  return hints?.[1] ?? "需要结合调用关系、变量表和块内指令确认具体作用。";
}

function describeLanguage(language: string): string {
  switch (language) {
    case "LD":
      return "梯形图块，适合按“条件触点 -> 输出线圈/指令”的方式阅读。";
    case "ST":
      return "结构化文本块，类似程序代码，适合按赋值、IF 判断、函数调用顺序阅读。";
    case "FB":
      return "功能块，通常封装一个可重复使用的设备、动作或算法。";
    default:
      return "未知语言块，需要结合 AutoShop 内部显示确认。";
  }
}

function describeInstruction(instruction: string): string {
  const upper = instruction.toUpperCase();
  if (upper.startsWith("CALL")) {
    return "调用另一个程序块，可以把它理解为跳到下一层子目录执行。";
  }
  if (upper.startsWith("SET")) {
    return "置位，把某个状态保持为 ON，常用于启动、允许、报警保持。";
  }
  if (upper.startsWith("RST")) {
    return "复位，把某个状态清为 OFF，常用于停止、复位、清报警。";
  }
  if (upper.startsWith("MOV") || upper.startsWith("STRMOV")) {
    return "数据传送，把一个数值或字符串写到另一个地址。";
  }
  if (upper.startsWith("TON") || upper.startsWith("TOF")) {
    return "定时器，用于延时启动、延时停止或时间判断。";
  }
  if (upper.startsWith("CMP")) {
    return "比较指令，用于判断数值大小或是否达到条件。";
  }
  if (upper.startsWith("ADD") || upper.startsWith("SUB") || upper.startsWith("MUL") || upper.startsWith("DIV")) {
    return "数学运算，用于计算参数、位置、时间或工艺数据。";
  }
  if (upper.startsWith("OUT")) {
    return "输出线圈或输出结果，通常代表某个状态被写出。";
  }
  if (upper.startsWith("LD") || upper.startsWith("AND") || upper.startsWith("OR")) {
    return "逻辑条件，类似“如果这个触点/条件成立”。";
  }
  return "常见 PLC 指令，需要结合前后触点、变量和网络注释理解。";
}

function describeAddress(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (/^X\d+/.test(upper)) {
    return "X 是外部输入点，通常来自按钮、传感器、到位开关等。";
  }
  if (/^Y\d+/.test(upper)) {
    return "Y 是外部输出点，通常控制电磁阀、继电器、指示灯、电机接触器等。";
  }
  if (/^M\d+/.test(upper)) {
    return "M 是内部辅助位，常用于程序状态、条件保持、步骤标志。";
  }
  if (/^D\d+/.test(upper)) {
    return "D 是数据寄存器，常用于参数、计数、位置、速度、触摸屏数据。";
  }
  if (/^T\d+/.test(upper)) {
    return "T 是定时器，常用于延时和时间条件。";
  }
  if (/^C\d+/.test(upper)) {
    return "C 是计数器，常用于次数统计。";
  }
  if (/^S\d+/.test(upper)) {
    return "S 常用于步进或状态流程。";
  }
  if (/^R\d+/.test(upper)) {
    return "R 通常是扩展寄存器或保持寄存器，具体含义要看机型和变量表。";
  }
  if (/^[VBZ]\d+/.test(upper)) {
    return "这是 PLC 内部地址，具体含义需要结合机型手册和变量表确认。";
  }
  return "符号或地址，需要结合变量表、注释和上下文确认实际设备含义。";
}

function beginnerGlossary(): Record<string, string> {
  return {
    MAIN: "主程序入口，通常先执行这里。",
    CALL: "调用子程序，把一段逻辑拆出去单独执行。",
    SBR: "子程序块，通常被 MAIN 或其他块调用。",
    LD: "梯形图，按触点和线圈阅读。",
    ST: "结构化文本，按代码语句阅读。",
    FB: "功能块，封装可复用逻辑。",
    X: "外部输入点。",
    Y: "外部输出点。",
    M: "内部辅助位。",
    D: "数据寄存器。",
    T: "定时器。",
    C: "计数器。",
  };
}

function unique<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
