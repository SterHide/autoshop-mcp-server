import { CHARACTER_LIMIT } from "../constants.js";
import { STGenerationSpec, STOperation, STVariable } from "../types.js";

function escapeIdentifier(value: string): string {
  return value.trim();
}

function formatInitialValue(value: string | number | boolean | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toString();
  }
  return value;
}

function renderVarSection(title: string, variables?: STVariable[]): string[] {
  if (!variables || variables.length === 0) {
    return [];
  }
  const lines = [`${title}`];
  for (const variable of variables) {
    const initialValue = formatInitialValue(variable.initialValue);
    const comment = variable.comment ? ` // ${variable.comment}` : "";
    const init = initialValue === undefined ? "" : ` := ${initialValue}`;
    lines.push(`    ${escapeIdentifier(variable.name)} : ${variable.dataType}${init};${comment}`);
  }
  lines.push("END_VAR");
  return lines;
}

function renderOperations(operations: STOperation[] | undefined): string[] {
  if (!operations || operations.length === 0) {
    return ["    // No custom operations supplied"];
  }

  const lines: string[] = [];
  for (const operation of operations) {
    switch (operation.op) {
      case "assign":
        lines.push(`    ${escapeIdentifier(operation.target ?? "")} := ${operation.expression ?? "0"};`);
        break;
      case "if":
        lines.push(`    IF ${operation.condition ?? "FALSE"} THEN`);
        break;
      case "elseif":
        lines.push(`    ELSIF ${operation.condition ?? "FALSE"} THEN`);
        break;
      case "else":
        lines.push("    ELSE");
        break;
      case "end_if":
        lines.push("    END_IF;");
        break;
      case "call":
        lines.push(`    ${operation.call ?? "Call"}();`);
        break;
      case "comment":
        lines.push(`    // ${operation.text ?? ""}`);
        break;
      case "blank":
        lines.push("");
        break;
      default:
        lines.push("    // Unsupported operation");
        break;
    }
  }
  return lines;
}

function renderTemplate(template: NonNullable<STGenerationSpec["template"]>, signals: Record<string, string>): string[] {
  switch (template) {
    case "start_stop": {
      const start = signals.start ?? "Start";
      const stop = signals.stop ?? "Stop";
      const run = signals.run ?? "Run";
      const permissive = signals.permissive ?? "Permissive";
      const fault = signals.fault ?? "Fault";
      return [
        `    ${run} := (${start} OR ${run}) AND ${stop} AND ${permissive} AND NOT ${fault};`,
      ];
    }
    case "latch": {
      const setSignal = signals.set ?? "Set";
      const resetSignal = signals.reset ?? "Reset";
      const state = signals.state ?? "State";
      return [
        `    IF ${resetSignal} THEN`,
        `        ${state} := FALSE;`,
        `    ELSIF ${setSignal} THEN`,
        `        ${state} := TRUE;`,
        "    END_IF;",
      ];
    }
    case "timer": {
      const enable = signals.enable ?? "Enable";
      const done = signals.done ?? "Done";
      const elapsed = signals.elapsed ?? "Elapsed";
      const preset = signals.preset ?? "T#5s";
      return [
        `    ${elapsed} := ${preset};`,
        `    ${done} := ${enable};`,
      ];
    }
    case "compare": {
      const left = signals.left ?? "LeftValue";
      const right = signals.right ?? "RightValue";
      const out = signals.out ?? "Comparison";
      const operator = signals.operator ?? ">=";
      return [`    ${out} := ${left} ${operator} ${right};`];
    }
    default:
      return ["    // Custom template requested but not recognized"];
  }
}

export function generateStructuredTextSource(spec: STGenerationSpec): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const normalizedSignals = spec.templateSignals ?? {};
  const header: string[] = [];
  const blockKeyword = spec.blockType === "program"
    ? "PROGRAM"
    : spec.blockType === "function"
      ? "FUNCTION"
      : "FUNCTION_BLOCK";
  const endKeyword = spec.blockType === "program"
    ? "END_PROGRAM"
    : spec.blockType === "function"
      ? "END_FUNCTION"
      : "END_FUNCTION_BLOCK";

  header.push(`${blockKeyword} ${escapeIdentifier(spec.blockName)}`);
  if (spec.comment) {
    header.push(`// ${spec.comment}`);
  }

  const sections = [
    ...renderVarSection("VAR_INPUT", spec.inputs),
    ...renderVarSection("VAR_OUTPUT", spec.outputs),
    ...renderVarSection("VAR", spec.statics),
    ...renderVarSection("VAR_TEMP", spec.temps),
  ];

  const body =
    spec.template && spec.template !== "custom"
      ? renderTemplate(spec.template, normalizedSignals)
      : renderOperations(spec.operations);

  const lines = [
    ...header,
    ...sections,
    "",
    "BEGIN",
    ...body,
    "",
    endKeyword,
  ];

  let text = lines.join("\n");
  if (text.length > CHARACTER_LIMIT) {
    warnings.push(`Generated ST source exceeded ${CHARACTER_LIMIT} characters and was truncated.`);
    text = `${text.slice(0, CHARACTER_LIMIT)}\n// TRUNCATED`;
  }

  return { text, warnings };
}

export function buildStFilename(spec: STGenerationSpec): string {
  const suffix = spec.blockType === "program" ? ".st" : spec.blockType === "function" ? ".st" : ".st";
  return `${spec.blockName}${suffix}`;
}

export function templateHelp(): string {
  return [
    "start_stop: builds a permissive start/stop latch",
    "latch: simple set/reset memory bit",
    "timer: simple enable/preset/done sketch",
    "compare: compare two values using a custom operator",
    "custom: render explicit operations[]",
  ].join("\n");
}
