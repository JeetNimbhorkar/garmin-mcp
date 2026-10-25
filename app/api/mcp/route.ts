import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

// ------------------------------------------
// Garmin Personal API configuration
// ------------------------------------------

const GARMIN_BASE_URL =
  "https://personal.connectapi.garmin.com";

const GARMIN_TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";

const GARMIN_PROFILE_PATH =
  "/userprofile-service/userprofile/settings";

type GarminAccessToken = {
  access_token: string;
  expires_at: number;
};

// Cache only in memory. Serverless instances may
// discard this cache at any time.
let cachedGarminToken: GarminAccessToken | null = null;

async function garminFetch(
  url: string,
  options: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
}

// Exchange Garmin's API key for an access token.
async function getGarminAccessToken(): Promise<string> {
  const apiKey = process.env.GARMIN_PERSONAL_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GARMIN_PERSONAL_API_KEY is missing from Vercel."
    );
  }

  if (
    cachedGarminToken &&
    Date.now() < cachedGarminToken.expires_at - 60000
  ) {
    return cachedGarminToken.access_token;
  }

  const response = await garminFetch(
    `${GARMIN_BASE_URL}${GARMIN_TOKEN_PATH}`,
    {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Garmin token request failed (HTTP ${response.status}).`
    );
  }

  const data: unknown = await response.json();

  if (
    !data ||
    typeof data !== "object" ||
    !("access_token" in data) ||
    typeof data.access_token !== "string" ||
    !data.access_token
  ) {
    throw new Error(
      "Garmin token response did not include an access_token."
    );
  }

  // Garmin access tokens are JWTs. Read expiry for
  // caching, without treating the decoded data as
  // an authorization decision.
  let expiresAt = Date.now() + 5 * 60 * 1000;

  try {
    const parts = data.access_token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { exp?: unknown };

    if (typeof payload.exp === "number") {
      expiresAt = payload.exp * 1000;
    }
  } catch {
    // Keep short-lived fallback cache if the token
    // expiry cannot be decoded.
  }

  cachedGarminToken = {
    access_token: data.access_token,
    expires_at: expiresAt,
  };

  return data.access_token;
}

// Fetch a read-only Garmin Personal API resource.
async function fetchGarminProfile(): Promise<unknown> {
  const token = await getGarminAccessToken();

  const request = async (bearerToken: string) =>
    garminFetch(
      `${GARMIN_BASE_URL}${GARMIN_PROFILE_PATH}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: "application/json",
        },
      }
    );

  let response = await request(token);

  // Retry once with a new token if the cached
  // Garmin bearer token is rejected.
  if (response.status === 401) {
    cachedGarminToken = null;
    response = await request(
      await getGarminAccessToken()
    );
  }

  if (!response.ok) {
    throw new Error(
      `Garmin profile request failed (HTTP ${response.status}).`
    );
  }

  return response.json();
}

// ------------------------------------------
// MCP tools
// ------------------------------------------

const handler = createMcpHandler((server) => {
  // Existing connectivity test.
  server.registerTool(
    "ping",
    {
      description: "Test the authenticated MCP connection.",
      inputSchema: z.object({
        message: z.string().max(200).default("hello"),
      }),
    },
    async ({ message }) => ({
      content: [
        {
          type: "text" as const,
          text: `Authenticated Garmin MCP works. You sent: ${message}`,
        },
      ],
    })
  );

  // First real Garmin tool.
  server.registerTool(
    "garmin_get_profile",
    {
      description:
        "Retrieve the authenticated user's Garmin Connect profile settings through Garmin's official read-only Personal API.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const profile = await fetchGarminProfile();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown Garmin API error.";

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Garmin API error: ${message}`,
            },
          ],
        };
      }
    }
  );
});

// ------------------------------------------
// Auth0 protection — keep Phase 2 security
// ------------------------------------------

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

    const { payload } = await jwtVerify(
      bearerToken,
      jwks,
      {
        issuer: `${issuer}/`,
        audience,
        algorithms: ["RS256"],
      }
    );

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
      clientId:
        typeof payload.azp === "string"
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
