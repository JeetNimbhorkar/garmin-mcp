import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// Connectivity test only. No Garmin data or credentials.
const handler = createMcpHandler((server) => {
  server.registerTool(
    "ping",
    {
      description: "Test that ChatGPT can invoke this MCP server. No Garmin data is accessed.",
      inputSchema: z.object({
        message: z.string().max(200).default("hello"),
      }),
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `Garmin MCP connection works. You sent: ${message}` }],
    })
  );
});

export { handler as GET, handler as POST, handler as DELETE };
