import { z } from "zod";

export const responseFormatSchema = z.enum(["markdown", "json"]).default("markdown");

export const pointDefinitionSchema = z.object({
  name: z.string().min(1).max(120).describe("Point symbol name, for example StartButton or MotorRun."),
  area: z.enum(["coil", "discrete_input", "holding_register", "input_register"]).describe("Modbus area for the point."),
  address: z.number().int().min(0).describe("Zero-based Modbus address."),
  dataType: z.enum(["bool", "int16", "uint16", "int32", "uint32", "float32", "raw16", "raw32"]).describe("Data type used when decoding or encoding the point value."),
  comment: z.string().max(300).optional().describe("Optional engineering comment."),
  initialValue: z.union([z.string(), z.number(), z.boolean()]).optional().describe("Optional default value, also used by write tools unless overridden in the source file."),
}).strict();

export const stVariableSchema = z.object({
  name: z.string().min(1).max(120),
  dataType: z.string().min(1).max(120),
  comment: z.string().max(300).optional(),
  initialValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
}).strict();

export const stOperationSchema = z.object({
  op: z.enum(["assign", "if", "elseif", "else", "end_if", "call", "comment", "blank"]),
  target: z.string().optional(),
  expression: z.string().optional(),
  condition: z.string().optional(),
  call: z.string().optional(),
  args: z.record(z.string()).optional(),
  text: z.string().optional(),
}).strict();

export const ladderElementSchema = z.object({
  kind: z.enum(["contact_no", "contact_nc", "coil", "set_coil", "reset_coil", "timer_on", "counter_up", "compare", "move", "call"]),
  tag: z.string().min(1).max(120).optional(),
  target: z.string().min(1).max(120).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  preset: z.union([z.string(), z.number()]).optional(),
  expression: z.string().max(300).optional(),
  instance: z.string().min(1).max(120).optional(),
  args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  comment: z.string().max(300).optional(),
}).strict();

export const ladderRungSchema = z.object({
  name: z.string().max(120).optional(),
  comment: z.string().max(300).optional(),
  elements: z.array(ladderElementSchema).min(1),
}).strict();

export const generateLadderInputSchema = z.object({
  programName: z.string().min(1).max(120),
  rungs: z.array(ladderRungSchema).min(1),
  includeEquivalentSt: z.boolean().default(true),
  outputDirectory: z.string().optional(),
  response_format: responseFormatSchema,
}).strict();

export const modbusConnectionSchema = z.object({
  host: z.string().min(1).describe("PLC IP address or hostname."),
  port: z.number().int().min(1).max(65535).default(502).describe("Modbus TCP port."),
  unitId: z.number().int().min(0).max(255).default(1).describe("Modbus unit identifier, usually 1."),
  timeoutMs: z.number().int().min(200).max(30000).default(3000).describe("Socket timeout in milliseconds."),
}).strict();

export const bootstrapInputSchema = z.object({
  response_format: responseFormatSchema,
}).strict();

export const detectOpenInstancesInputSchema = z.object({
  response_format: responseFormatSchema,
}).strict();

export const scanActiveProjectInputSchema = z.object({
  includeFiles: z.boolean().default(false).describe("Include the full top-level file list in the response."),
  response_format: responseFormatSchema,
}).strict();

export const capabilitySelfTestInputSchema = z.object({
  projectPath: z.string().min(1).optional().describe("Optional AutoShop project directory. Defaults to the project shown in the active AutoShop window."),
  installPath: z.string().min(1).optional().describe("Optional AutoShop install directory. Defaults to the running AutoShop executable directory or the standard install path."),
  response_format: responseFormatSchema,
}).strict();

export const instructionCatalogInputSchema = z.object({
  installPath: z.string().min(1).optional().describe("Optional AutoShop install directory containing AIAssistantELinkCmd.xml."),
  query: z.string().min(1).max(120).optional().describe("Optional instruction name filter, for example PID, MC_, Modbus, or CALL."),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
  response_format: responseFormatSchema,
}).strict();

export const analyzeCallGraphInputSchema = z.object({
  projectPath: z.string().min(1).optional().describe("AutoShop project directory. Defaults to the project shown in the active AutoShop window."),
  maxBlocks: z.number().int().min(1).max(1000).default(250).describe("Maximum program blocks to inspect."),
  response_format: responseFormatSchema,
}).strict();

export const scanProjectInputSchema = z.object({
  projectPath: z.string().min(1).describe("AutoShop project directory, for example D:\\\\Project\\\\PLC\\\\111."),
  includeFiles: z.boolean().default(false).describe("Include the full top-level file list in the response."),
  response_format: responseFormatSchema,
}).strict();

export const listProgramBlocksInputSchema = z.object({
  projectPath: z.string().min(1).optional().describe("Optional AutoShop project directory. Defaults to the project shown in the active AutoShop window."),
  language: z.enum(["LD", "ST", "FB", "all"]).default("all").describe("Filter by block file type."),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  response_format: responseFormatSchema,
}).strict();

export const readBlockSourceInputSchema = z.object({
  projectPath: z.string().min(1).optional().describe("Optional AutoShop project directory. Defaults to the project shown in the active AutoShop window."),
  blockName: z.string().min(1).max(240).optional().describe("Block name or file name. Defaults to the active block shown in the AutoShop window, for example MAIN."),
  includeRawStrings: z.boolean().default(false).describe("Include extracted strings from binary AutoShop block containers."),
  maxStrings: z.number().int().min(1).max(1000).default(300),
  response_format: responseFormatSchema,
}).strict();

export const searchSymbolsInputSchema = z.object({
  projectPath: z.string().min(1).optional().describe("Optional AutoShop project directory. Defaults to the project shown in the active AutoShop window."),
  query: z.string().min(1).max(120).describe("Symbol, address, instruction, or Chinese comment text to search for."),
  fileTypes: z.array(z.enum(["blocks", "variables", "config"])).optional().describe("File groups to search. Defaults to blocks, variables, and config."),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  response_format: responseFormatSchema,
}).strict();

export const parseVariableTablesInputSchema = z.object({
  projectPath: z.string().min(1).optional().describe("Optional AutoShop project directory. Defaults to the project shown in the active AutoShop window."),
  tableName: z.string().min(1).max(120).optional().describe("Optional table/file name filter, for example 变量表, M_地址变量, or VarList."),
  query: z.string().min(1).max(120).optional().describe("Optional text/address filter inside extracted variable records."),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
  response_format: responseFormatSchema,
}).strict();

export const validatePointTableInputSchema = z.object({
  points: z.array(pointDefinitionSchema).optional().describe("Inline point definitions."),
  pointTablePath: z.string().optional().describe("Path to a JSON or CSV point table."),
  response_format: responseFormatSchema,
}).strict().superRefine((value, ctx) => {
  if ((!value.points || value.points.length === 0) && !value.pointTablePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either points or pointTablePath.",
      path: ["points"],
    });
  }
});

export const generateStInputSchema = z.object({
  blockType: z.enum(["program", "function_block", "function"]).default("program"),
  blockName: z.string().min(1).max(120),
  template: z.enum(["start_stop", "latch", "timer", "compare", "custom"]).optional(),
  comment: z.string().max(500).optional(),
  inputs: z.array(stVariableSchema).optional(),
  outputs: z.array(stVariableSchema).optional(),
  statics: z.array(stVariableSchema).optional(),
  temps: z.array(stVariableSchema).optional(),
  operations: z.array(stOperationSchema).optional(),
  templateSignals: z.record(z.string()).optional(),
  outputPath: z.string().optional().describe("Optional .st file path to write the generated source."),
  response_format: responseFormatSchema,
}).strict();

export const scaffoldProjectInputSchema = z.object({
  projectName: z.string().min(1).max(150),
  outputDirectory: z.string().min(1).describe("Directory where the scaffolded AutoShop bundle should be written."),
  block: generateStInputSchema.omit({ outputPath: true, response_format: true }).optional(),
  ladder: generateLadderInputSchema.omit({ outputDirectory: true, response_format: true }).optional(),
  points: z.array(pointDefinitionSchema).optional(),
  pointTablePath: z.string().optional(),
  notes: z.string().max(2000).optional(),
  communication: z.object({
    protocol: z.literal("modbus_tcp"),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    unitId: z.number().int().min(0).max(255).optional(),
  }).strict().optional(),
  response_format: responseFormatSchema,
}).strict();

export const readPointsInputSchema = z.object({
  connection: modbusConnectionSchema,
  points: z.array(pointDefinitionSchema).optional(),
  pointTablePath: z.string().optional(),
  response_format: responseFormatSchema,
}).strict().superRefine((value, ctx) => {
  if ((!value.points || value.points.length === 0) && !value.pointTablePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either points or pointTablePath.",
      path: ["points"],
    });
  }
});

export const writePointsInputSchema = z.object({
  connection: modbusConnectionSchema,
  points: z.array(pointDefinitionSchema).optional(),
  pointTablePath: z.string().optional(),
  confirmRisk: z.boolean().default(false).describe("Must be true before writing to a live PLC."),
  response_format: responseFormatSchema,
}).strict().superRefine((value, ctx) => {
  if ((!value.points || value.points.length === 0) && !value.pointTablePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either points or pointTablePath.",
      path: ["points"],
    });
  }
});

export const monitorPointsInputSchema = z.object({
  connection: modbusConnectionSchema,
  points: z.array(pointDefinitionSchema).optional(),
  pointTablePath: z.string().optional(),
  intervalMs: z.number().int().min(200).max(60000).default(1000),
  iterations: z.number().int().min(1).max(100).default(5),
  response_format: responseFormatSchema,
}).strict().superRefine((value, ctx) => {
  if ((!value.points || value.points.length === 0) && !value.pointTablePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either points or pointTablePath.",
      path: ["points"],
    });
  }
});
