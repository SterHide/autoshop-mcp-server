import net from "node:net";
import { DEFAULT_MODBUS_PORT, DEFAULT_MODBUS_TIMEOUT_MS } from "../constants.js";
import { ModbusConnectionSpec, ModbusReadRequest, ModbusValue, ModbusWriteRequest, PointDefinition } from "../types.js";
import { pointWidthInRegisters, isValidArea } from "./validation.js";

type PendingRequest = {
  txId: number;
  resolve: (value: Buffer) => void;
  reject: (reason?: Error) => void;
  timer: NodeJS.Timeout;
};

export class ModbusTcpClient {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending: PendingRequest | null = null;
  private transactionId = 0;

  async connect(connection: ModbusConnectionSpec): Promise<void> {
    if (this.socket) {
      return;
    }

    const port = connection.port ?? DEFAULT_MODBUS_PORT;
    const timeoutMs = connection.timeoutMs ?? DEFAULT_MODBUS_TIMEOUT_MS;

    this.socket = net.createConnection({ host: connection.host, port });
    this.socket.setNoDelay(true);
    this.socket.setTimeout(timeoutMs);

    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });

    this.socket.on("timeout", () => {
      this.failPending(new Error("Modbus TCP connection timed out."));
      this.close();
    });

    this.socket.on("error", (error) => {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    });

    this.socket.on("close", () => {
      this.failPending(new Error("Modbus TCP connection closed."));
      this.socket = null;
      this.buffer = Buffer.alloc(0);
    });

    await new Promise<void>((resolve, reject) => {
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        if (!this.socket) {
          return;
        }
        this.socket.off("connect", onConnect);
        this.socket.off("error", onError);
      };

      if (!this.socket) {
        reject(new Error("Failed to create Modbus TCP socket."));
        return;
      }

      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
    });
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  async readPoint(point: PointDefinition, connection: ModbusConnectionSpec): Promise<ModbusValue> {
    await this.connect(connection);
    const timeoutMs = connection.timeoutMs ?? DEFAULT_MODBUS_TIMEOUT_MS;

    if (!isValidArea(point.area)) {
      throw new Error(`Unsupported point area "${point.area}".`);
    }

    if (point.dataType === "bool") {
      if (point.area === "coil") {
        return await this.readBit(0x01, point.address, timeoutMs);
      }
      if (point.area === "discrete_input") {
        return await this.readBit(0x02, point.address, timeoutMs);
      }
      const value = await this.readRegister(point.address, timeoutMs);
      return value !== 0;
    }

    const registerCount = pointWidthInRegisters(point.dataType);
    const values = await this.readRegistersByArea(point.area, point.address, registerCount, timeoutMs);
    return decodeRegisters(point.dataType, values);
  }

  async writePoint(point: PointDefinition, value: ModbusValue, connection: ModbusConnectionSpec): Promise<void> {
    await this.connect(connection);
    const timeoutMs = connection.timeoutMs ?? DEFAULT_MODBUS_TIMEOUT_MS;

    if (point.dataType === "bool") {
      if (point.area !== "coil") {
        throw new Error(`Boolean point "${point.name}" can only be written to a coil area.`);
      }
      await this.writeSingleCoil(point.address, Boolean(value), timeoutMs);
      return;
    }

    if (point.area !== "holding_register") {
      throw new Error(`Numeric point "${point.name}" can only be written to holding registers.`);
    }

    const registers = encodeRegisters(point.dataType, value);
    if (registers.length === 1) {
      await this.writeSingleRegister(point.address, registers[0], timeoutMs);
      return;
    }

    await this.writeMultipleRegisters(point.address, registers, timeoutMs);
  }

  private async readBit(functionCode: 0x01 | 0x02, address: number, timeoutMs: number): Promise<boolean> {
    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(1, 2);
    const response = await this.request(functionCode, payload, timeoutMs);
    const byteCount = response.readUInt8(0);
    if (byteCount < 1) {
      return false;
    }
    return (response.readUInt8(1) & 0x01) === 0x01;
  }

  private async readRegister(address: number, timeoutMs: number): Promise<number> {
    const values = await this.readRegistersByArea("holding_register", address, 1, timeoutMs);
    return values[0] ?? 0;
  }

  private async readRegistersByArea(area: "holding_register" | "input_register" | "coil" | "discrete_input", address: number, count: number, timeoutMs: number): Promise<number[]> {
    const functionCode = area === "holding_register" ? 0x03 : area === "input_register" ? 0x04 : area === "coil" ? 0x01 : 0x02;
    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(count, 2);
    const response = await this.request(functionCode, payload, timeoutMs);
    const byteCount = response.readUInt8(0);
    const registers: number[] = [];

    if (functionCode === 0x01 || functionCode === 0x02) {
      for (let index = 0; index < count; index += 1) {
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        const byte = response.readUInt8(1 + byteIndex) ?? 0;
        registers.push((byte >> bitIndex) & 0x01);
      }
      return registers;
    }

    for (let offset = 0; offset < byteCount; offset += 2) {
      registers.push(response.readUInt16BE(1 + offset));
    }
    return registers;
  }

  private async writeSingleCoil(address: number, value: boolean, timeoutMs: number): Promise<void> {
    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(value ? 0xff00 : 0x0000, 2);
    await this.request(0x05, payload, timeoutMs);
  }

  private async writeSingleRegister(address: number, value: number, timeoutMs: number): Promise<void> {
    const payload = Buffer.alloc(4);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(value & 0xffff, 2);
    await this.request(0x06, payload, timeoutMs);
  }

  private async writeMultipleRegisters(address: number, values: number[], timeoutMs: number): Promise<void> {
    const byteCount = values.length * 2;
    const payload = Buffer.alloc(5 + byteCount);
    payload.writeUInt16BE(address, 0);
    payload.writeUInt16BE(values.length, 2);
    payload.writeUInt8(byteCount, 4);
    values.forEach((value, index) => {
      payload.writeUInt16BE(value & 0xffff, 5 + index * 2);
    });
    await this.request(0x10, payload, timeoutMs);
  }

  private async request(functionCode: number, payload: Buffer, timeoutMs: number): Promise<Buffer> {
    if (!this.socket) {
      throw new Error("Modbus TCP client is not connected.");
    }
    if (this.pending) {
      throw new Error("Only one Modbus request can be in flight at a time.");
    }

    const txId = (this.transactionId += 1) & 0xffff;
    const frame = Buffer.alloc(7 + 1 + payload.length);
    frame.writeUInt16BE(txId, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(payload.length + 2, 4);
    frame.writeUInt8(1, 6);
    frame.writeUInt8(functionCode, 7);
    payload.copy(frame, 8);

    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("Modbus TCP request timed out."));
      }, timeoutMs);

      this.pending = {
        txId,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
        timer,
      };

      this.socket?.write(frame);
    });
  }

  private drain(): void {
    while (this.pending && this.buffer.length >= 7) {
      const packetLength = this.buffer.readUInt16BE(4) + 6;
      if (this.buffer.length < packetLength) {
        return;
      }

      const packet = this.buffer.subarray(0, packetLength);
      this.buffer = this.buffer.subarray(packetLength);

      const pending = this.pending;
      this.pending = null;

      if (packet.readUInt16BE(0) !== pending.txId) {
        pending.reject(new Error("Modbus TCP transaction id mismatch."));
        continue;
      }

      const functionCode = packet.readUInt8(7);
      if ((functionCode & 0x80) === 0x80) {
        const exceptionCode = packet.readUInt8(8);
        pending.reject(new Error(`Modbus exception ${exceptionCode} on function ${functionCode & 0x7f}.`));
        continue;
      }

      pending.resolve(packet.subarray(8));
    }
  }

  private failPending(error: Error): void {
    if (this.pending) {
      this.pending.reject(error);
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }
}

export async function readModbusPoints(request: ModbusReadRequest): Promise<Record<string, ModbusValue>> {
  const client = new ModbusTcpClient();
  try {
    const values: Record<string, ModbusValue> = {};
    for (const point of request.points) {
      values[point.name] = await client.readPoint(point, request.connection);
    }
    return values;
  } finally {
    client.close();
  }
}

export async function writeModbusPoints(request: ModbusWriteRequest): Promise<Record<string, ModbusValue>> {
  if (request.confirmRisk !== true) {
    throw new Error("Safety check required. Set confirmRisk=true before writing to a live PLC.");
  }

  const client = new ModbusTcpClient();
  try {
    const values: Record<string, ModbusValue> = {};
    for (const point of request.points) {
      const value = point.initialValue;
      if (value === undefined) {
        throw new Error(`Point "${point.name}" is missing initialValue for write.`);
      }
      await client.writePoint(point, value as ModbusValue, request.connection);
      values[point.name] = value as ModbusValue;
    }
    return values;
  } finally {
    client.close();
  }
}

export async function monitorModbusPoints(
  request: ModbusReadRequest,
  intervalMs: number,
  iterations: number,
): Promise<Array<{ timestamp: string; values: Record<string, ModbusValue> }>> {
  const client = new ModbusTcpClient();
  try {
    const samples: Array<{ timestamp: string; values: Record<string, ModbusValue> }> = [];
    for (let index = 0; index < iterations; index += 1) {
      const values: Record<string, ModbusValue> = {};
      for (const point of request.points) {
        values[point.name] = await client.readPoint(point, request.connection);
      }
      samples.push({ timestamp: new Date().toISOString(), values });
      if (index + 1 < iterations) {
        await delay(intervalMs);
      }
    }
    return samples;
  } finally {
    client.close();
  }
}

function decodeRegisters(dataType: PointDefinition["dataType"], registers: number[]): ModbusValue {
  const hi = registers[0] ?? 0;
  const lo = registers[1] ?? 0;
  switch (dataType) {
    case "int16":
      return signed16(hi);
    case "uint16":
    case "raw16":
      return hi;
    case "int32":
      return signed32((hi << 16) | lo);
    case "uint32":
    case "raw32":
      return ((hi << 16) | lo) >>> 0;
    case "float32": {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt16BE(hi, 0);
      buffer.writeUInt16BE(lo, 2);
      return buffer.readFloatBE(0);
    }
    default:
      return hi;
  }
}

function encodeRegisters(dataType: PointDefinition["dataType"], value: ModbusValue): number[] {
  switch (dataType) {
    case "int16":
      return [normalize16(Number(value), true)];
    case "uint16":
    case "raw16":
      return [normalize16(Number(value), false)];
    case "int32":
      return split32(Number(value), true);
    case "uint32":
    case "raw32":
      return split32(Number(value), false);
    case "float32": {
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(Number(value), 0);
      return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
    }
    default:
      throw new Error(`Unsupported write data type "${dataType}".`);
  }
}

function normalize16(value: number, signed: boolean): number {
  if (signed) {
    const wrapped = ((Math.trunc(value) % 0x10000) + 0x10000) % 0x10000;
    return wrapped;
  }
  return Math.trunc(value) & 0xffff;
}

function split32(value: number, signed: boolean): number[] {
  const normalized = signed ? Math.trunc(value) : Math.trunc(value) >>> 0;
  const hi = (normalized >>> 16) & 0xffff;
  const lo = normalized & 0xffff;
  return [hi, lo];
}

function signed16(value: number): number {
  return value & 0x8000 ? value - 0x10000 : value;
}

function signed32(value: number): number {
  return value | 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
