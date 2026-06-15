import fs from "node:fs/promises";
import path from "node:path";
import { PointArea, PointDataType, PointDefinition, ValidationReport } from "../types.js";

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function resolveAbsolutePath(input: string, baseDir = process.cwd()): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(baseDir, input);
}

export function validatePointTable(points: PointDefinition[]): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenNames = new Set<string>();
  const areaAddressSeen = new Map<string, string>();

  for (const point of points) {
    if (!VALID_NAME.test(point.name)) {
      errors.push(`Invalid point name "${point.name}". Use letters, digits, and underscores; start with a letter or underscore.`);
    }

    if (seenNames.has(point.name)) {
      errors.push(`Duplicate point name "${point.name}".`);
    }
    seenNames.add(point.name);

    if (!Number.isInteger(point.address) || point.address < 0) {
      errors.push(`Point "${point.name}" has invalid address ${point.address}. Use a non-negative integer.`);
    }

    if (!isValidArea(point.area)) {
      errors.push(`Point "${point.name}" has unsupported area "${point.area}".`);
    }

    if (!isValidDataType(point.dataType)) {
      errors.push(`Point "${point.name}" has unsupported data type "${point.dataType}".`);
    }

    const key = `${point.area}:${point.address}`;
    if (areaAddressSeen.has(key)) {
      warnings.push(`Points "${areaAddressSeen.get(key)}" and "${point.name}" share the same address ${key}. Verify this is intended.`);
    } else {
      areaAddressSeen.set(key, point.name);
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function isValidArea(value: string): value is PointArea {
  return value === "coil" || value === "discrete_input" || value === "holding_register" || value === "input_register";
}

export function isValidDataType(value: string): value is PointDataType {
  return value === "bool" || value === "int16" || value === "uint16" || value === "int32" || value === "uint32" || value === "float32" || value === "raw16" || value === "raw32";
}

export function pointWidthInRegisters(dataType: PointDataType): number {
  switch (dataType) {
    case "bool":
    case "int16":
    case "uint16":
    case "raw16":
      return 1;
    case "int32":
    case "uint32":
    case "float32":
    case "raw32":
      return 2;
    default:
      return 1;
  }
}

export function pointFormatHint(point: PointDefinition): string {
  const width = pointWidthInRegisters(point.dataType);
  return `${point.area}@${point.address}${width > 1 ? ` (${width} regs)` : ""}`;
}
