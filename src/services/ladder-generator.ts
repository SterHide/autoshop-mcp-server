import { CHARACTER_LIMIT } from "../constants.js";
import { LadderElement, LadderGenerationSpec, LadderRung } from "../types.js";

export interface LadderGenerationResult {
  ascii: string;
  equivalentSt: string;
  warnings: string[];
}

export function buildLadderFilename(spec: LadderGenerationSpec): string {
  return `${spec.programName}.ladder.md`;
}

export function buildLadderJsonFilename(spec: LadderGenerationSpec): string {
  return `${spec.programName}.ladder.json`;
}

export function generateLadderDiagram(spec: LadderGenerationSpec): LadderGenerationResult {
  const warnings: string[] = [];
  const asciiLines = [`# Ladder: ${spec.programName}`, ""];
  const stLines = [`// Equivalent ST for ladder program ${spec.programName}`];

  if (spec.rungs.length === 0) {
    warnings.push("No rungs were supplied.");
  }

  spec.rungs.forEach((rung, index) => {
    const rungName = rung.name ?? `Rung_${index + 1}`;
    asciiLines.push(`## ${rungName}`);
    if (rung.comment) {
      asciiLines.push(`// ${rung.comment}`);
    }
    asciiLines.push(renderAsciiRung(rung));
    asciiLines.push("");

    stLines.push("");
    stLines.push(`// ${rungName}${rung.comment ? ` - ${rung.comment}` : ""}`);
    stLines.push(...renderEquivalentSt(rung));
  });

  let ascii = asciiLines.join("\n");
  let equivalentSt = stLines.join("\n");

  if (ascii.length > CHARACTER_LIMIT) {
    warnings.push(`ASCII ladder output exceeded ${CHARACTER_LIMIT} characters and was truncated.`);
    ascii = `${ascii.slice(0, CHARACTER_LIMIT)}\n<!-- TRUNCATED -->`;
  }

  if (equivalentSt.length > CHARACTER_LIMIT) {
    warnings.push(`Equivalent ST output exceeded ${CHARACTER_LIMIT} characters and was truncated.`);
    equivalentSt = `${equivalentSt.slice(0, CHARACTER_LIMIT)}\n// TRUNCATED`;
  }

  return {
    ascii,
    equivalentSt,
    warnings,
  };
}

function renderAsciiRung(rung: LadderRung): string {
  const body = rung.elements.map(renderAsciiElement).join("--");
  return `|--${body}--|`;
}

function renderAsciiElement(element: LadderElement): string {
  switch (element.kind) {
    case "contact_no":
      return `[ ${element.tag ?? "NO"} ]`;
    case "contact_nc":
      return `[/ ${element.tag ?? "NC"} ]`;
    case "coil":
      return `( ${element.tag ?? element.target ?? "COIL"} )`;
    case "set_coil":
      return `(S ${element.tag ?? element.target ?? "SET"} )`;
    case "reset_coil":
      return `(R ${element.tag ?? element.target ?? "RESET"} )`;
    case "timer_on":
      return `[TON ${element.instance ?? element.tag ?? "T"} PT=${element.preset ?? "T#1s"}]`;
    case "counter_up":
      return `[CTU ${element.instance ?? element.tag ?? "C"} PV=${element.preset ?? 1}]`;
    case "compare":
      return `[CMP ${element.expression ?? "A = B"}]`;
    case "move":
      return `[MOV ${formatValue(element.value)} -> ${element.target ?? "Target"}]`;
    case "call":
      return `[CALL ${element.instance ?? element.tag ?? "Block"}]`;
    default:
      return "[UNKNOWN]";
  }
}

function renderEquivalentSt(rung: LadderRung): string[] {
  const contacts = rung.elements.filter((element) => element.kind === "contact_no" || element.kind === "contact_nc" || element.kind === "compare");
  const actions = rung.elements.filter((element) => !contacts.includes(element));
  const condition = contacts.length > 0 ? contacts.map(contactToExpression).join(" AND ") : "TRUE";
  const lines = [`IF ${condition} THEN`];

  if (actions.length === 0) {
    lines.push("    // No output/action element supplied");
  }

  for (const action of actions) {
    lines.push(`    ${actionToStatement(action)}`);
  }

  lines.push("END_IF;");
  return lines;
}

function contactToExpression(element: LadderElement): string {
  switch (element.kind) {
    case "contact_no":
      return element.tag ?? "TRUE";
    case "contact_nc":
      return `NOT ${element.tag ?? "FALSE"}`;
    case "compare":
      return element.expression ?? "TRUE";
    default:
      return "TRUE";
  }
}

function actionToStatement(element: LadderElement): string {
  const target = element.target ?? element.tag ?? "Output";
  switch (element.kind) {
    case "coil":
      return `${target} := TRUE;`;
    case "set_coil":
      return `${target} := TRUE;`;
    case "reset_coil":
      return `${target} := FALSE;`;
    case "timer_on":
      return `${element.instance ?? target}(IN := TRUE, PT := ${element.preset ?? "T#1s"});`;
    case "counter_up":
      return `${element.instance ?? target}(CU := TRUE, PV := ${element.preset ?? 1});`;
    case "move":
      return `${target} := ${formatValue(element.value)};`;
    case "call":
      return `${element.instance ?? element.tag ?? "Block"}(${formatCallArgs(element.args)});`;
    default:
      return `// Unsupported action ${element.kind}`;
  }
}

function formatCallArgs(args: LadderElement["args"]): string {
  if (!args) {
    return "";
  }
  return Object.entries(args)
    .map(([key, value]) => `${key} := ${formatValue(value)}`)
    .join(", ");
}

function formatValue(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return "0";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}
