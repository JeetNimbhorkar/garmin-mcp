import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  server.registerTool(
    "ping",
    {
      description:
        "Test the authenticated Garmin MCP connection.",
      inputSchema: z.object({
        message: z.string().max(200).default("hello"),
      }),
    },
    async ({ message }) => ({
      content: [
        {
          type: "text",
          text: `Authenticated Garmin MCP works. You sent: ${message}`,
        },
      ],
    })
  );
});

async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  const issuer = process.env.AUTH0_ISSUER?.replace(/\/$/, "");
  const audience = process.env.AUTH0_AUDIENCE;
  const allowedSub = process.env.AUTH0_ALLOWED_SUB;

  if (!issuer || !audience || !allowedSub) {
    return undefined;
  }

  try {
    const jwks = createRemoteJWKSet(
      new URL(`${issuer}/.well-known/jwks.json`)
    );

    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `${issuer}/`,
      audience,
      algorithms: ["RS256"],
    });

    if (payload.sub !== allowedSub) {
      return undefined;
    }

    const scopes =
      typeof payload.scope === "string"
        ? payload.scope.split(" ")
        : [];

    if (!scopes.includes("read:garmin")) {
      return undefined;
    }

    return {
      token: bearerToken,
      scopes,
      clientId: typeof payload.azp === "string"
        ? payload.azp
        : (payload.sub ?? "unknown"),
    };
  } catch {
    return undefined;
  }
}

const protectedHandler = withMcpAuth(
  handler,
  verifyToken,
  {
    required: true,
    requiredScopes: ["read:garmin"],
    resourceMetadataPath:
      "/.well-known/oauth-protected-resource",
  }
);

export {
  protectedHandler as GET,
  protectedHandler as POST,
  protectedHandler as DELETE,
};
