#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerAutoshopTools } from "./tools/registerAutoshopTools.js";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

registerAutoshopTools(server);

async function run(): Promise<void> {
  const transportMode = process.env.TRANSPORT?.toLowerCase() ?? "stdio";

  if (transportMode === "http") {
    await runHttpServer();
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} running over stdio`);
}

async function runHttpServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, "127.0.0.1", () => {
    console.error(`${SERVER_NAME} running on http://127.0.0.1:${port}/mcp`);
  });
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
