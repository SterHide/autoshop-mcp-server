export type ResponseFormat = "markdown" | "json";

export type PointArea =
  | "coil"
  | "discrete_input"
  | "holding_register"
  | "input_register";

export type PointDataType =
  | "bool"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "raw16"
  | "raw32";

export type ProjectTemplate =
  | "start_stop"
  | "latch"
  | "timer"
  | "compare"
  | "custom";

export interface PointDefinition {
  name: string;
  area: PointArea;
  address: number;
  dataType: PointDataType;
  comment?: string;
  initialValue?: string | number | boolean;
}

export interface STVariable {
  name: string;
  dataType: string;
  comment?: string;
  initialValue?: string | number | boolean;
}

export interface STOperation {
  op: "assign" | "if" | "elseif" | "else" | "end_if" | "call" | "comment" | "blank";
  target?: string;
  expression?: string;
  condition?: string;
  call?: string;
  args?: Record<string, string>;
  text?: string;
}

export interface STGenerationSpec {
  blockType: "program" | "function_block" | "function";
  blockName: string;
  template?: ProjectTemplate;
  comment?: string;
  inputs?: STVariable[];
  outputs?: STVariable[];
  statics?: STVariable[];
  temps?: STVariable[];
  operations?: STOperation[];
  templateSignals?: Record<string, string>;
}

export type LadderElementKind =
  | "contact_no"
  | "contact_nc"
  | "coil"
  | "set_coil"
  | "reset_coil"
  | "timer_on"
  | "counter_up"
  | "compare"
  | "move"
  | "call";

export interface LadderElement {
  kind: LadderElementKind;
  tag?: string;
  target?: string;
  value?: string | number | boolean;
  preset?: string | number;
  expression?: string;
  instance?: string;
  args?: Record<string, string | number | boolean>;
  comment?: string;
}

export interface LadderRung {
  name?: string;
  comment?: string;
  elements: LadderElement[];
}

export interface LadderGenerationSpec {
  programName: string;
  rungs: LadderRung[];
  includeEquivalentSt?: boolean;
}

export interface ProjectBundleSpec {
  projectName: string;
  outputDirectory?: string;
  block?: STGenerationSpec;
  ladder?: LadderGenerationSpec;
  points?: PointDefinition[];
  notes?: string;
  communication?: {
    protocol: "modbus_tcp";
    host?: string;
    port?: number;
    unitId?: number;
  };
}

export interface ValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ModbusConnectionSpec {
  host: string;
  port?: number;
  unitId?: number;
  timeoutMs?: number;
}

export interface ModbusReadRequest {
  connection: ModbusConnectionSpec;
  points: PointDefinition[];
}

export interface ModbusWriteRequest extends ModbusReadRequest {
  confirmRisk?: boolean;
}

export interface ModbusSample {
  timestamp: string;
  values: Record<string, ModbusValue>;
}

export type ModbusValue = boolean | number;

export interface ToolMarkdownResult<T> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: T;
}

export type AutoShopProgramLanguage = "LD" | "ST" | "FB" | "UNKNOWN";

export interface AutoShopProjectFile {
  name: string;
  path: string;
  extension: string;
  sizeBytes: number;
  modifiedTime: string;
}

export interface AutoShopFolderEntry {
  category: "PROG" | "VAR" | "FB" | "FC" | "UNKNOWN";
  kind: "FILE" | "ROOT" | "STRUROOT" | "ENUMROOT";
  name: string;
  path?: string;
}

export interface AutoShopBlockInfo extends AutoShopProjectFile {
  blockName: string;
  language: AutoShopProgramLanguage;
  category: "PROG" | "FB" | "FC" | "UNKNOWN";
  listedInFolderIndex: boolean;
  autoShopBinary: boolean;
}

export interface AutoShopInstructionSummary {
  instructions: string[];
  calls: string[];
  comments: string[];
  symbols: string[];
}

export interface AutoShopVariableRecord {
  file: string;
  tableName: string;
  text: string;
  area?: string;
  address?: number;
  description?: string;
  sourceKind: "csv_row" | "binary_string";
}

export interface AutoShopOpenInstance {
  processId: number;
  processName: string;
  executablePath?: string;
  mainWindowTitle: string;
  productVersion?: string;
  projectPath?: string;
  projectName?: string;
  activeBlock?: string;
  projectExists: boolean;
  startedAt?: string;
}

export interface AutoShopCommunicationConfig {
  sourcePath: string;
  type?: string;
  ip?: string;
  adapterName?: string;
  ipName?: string;
}

export interface AutoShopInstructionCatalog {
  install_path: string;
  source_file: string;
  total_count: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  instructions: string[];
  warnings: string[];
}

export interface AutoShopCallGraphNode {
  blockName: string;
  file: string;
  language: AutoShopProgramLanguage;
  category: AutoShopBlockInfo["category"];
}

export interface AutoShopCallGraphEdge {
  from: string;
  to: string;
  resolved: boolean;
  targetFile?: string;
}
