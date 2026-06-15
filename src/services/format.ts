import { PointDefinition, ResponseFormat } from "../types.js";

export function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function pointsToCsv(points: PointDefinition[]): string {
  const rows = [
    ["name", "area", "address", "dataType", "comment", "initialValue"].join(","),
    ...points.map((point) =>
      [
        escapeCsvCell(point.name),
        escapeCsvCell(point.area),
        String(point.address),
        escapeCsvCell(point.dataType),
        escapeCsvCell(point.comment ?? ""),
        escapeCsvCell(point.initialValue === undefined ? "" : String(point.initialValue)),
      ].join(","),
    ),
  ];
  return rows.join("\r\n");
}

export function formatResult<T extends Record<string, unknown>>(
  responseFormat: ResponseFormat,
  title: string,
  payload: T,
  markdownLines: string[],
): { text: string; structuredContent: T } {
  if (responseFormat === "json") {
    return { text: JSON.stringify(payload, null, 2), structuredContent: payload };
  }
  return { text: [`# ${title}`, ...markdownLines].join("\n"), structuredContent: payload };
}
