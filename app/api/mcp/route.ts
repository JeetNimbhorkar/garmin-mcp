import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { garminGetJson, garminDownloadActivity } from "../../../lib/garmin/client";
import {
  rangeEndpoints,
  dailyEndpoints,
  noArgumentEndpoints,
  endpointCatalog,
} from "../../../lib/garmin/endpoints";

// This file is app/api/mcp/route.ts. The imports above point to
// PROJECT_ROOT/lib/garmin/*.ts (three parent directories up).

function validateDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error(`Invalid calendar date: ${s}`);
  }
  return s;
}

function validateRange(start: string, end: string): void {
  validateDate(start);
  validateDate(end);
  if (start > end) throw new Error("start_date must be on or before end_date.");
}

function textResult(data: unknown) {
  const output = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text: output ?? "null" }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Garmin API error";
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Garmin API error: ${message}` }],
  };
}

const dateSchema = z.string().describe("Calendar date, YYYY-MM-DD");
const idSchema = z.number().int().positive().describe("Garmin activity ID");

const handler = createMcpHandler((server) => {
  server.registerTool(
    "ping",
    {
      description: "Test authenticated MCP connection without calling Garmin.",
      inputSchema: z.object({ message: z.string().max(200).default("hello") }),
    },
    async ({ message }) => textResult(`Authenticated Garmin MCP works. You sent: ${message}`)
  );

  // Every dedicated range wrapper in the Garmin-maintained Python client.
  for (const endpoint of rangeEndpoints) {
    server.registerTool(
      endpoint.name,
      {
        description: `${endpoint.description}. Both start_date and end_date are inclusive YYYY-MM-DD dates. Narrow the range if Garmin returns too much data.`,
        inputSchema: z.object({
          start_date: dateSchema,
          end_date: dateSchema,
        }),
      },
      async ({ start_date, end_date }) => {
        try {
          validateRange(start_date, end_date);
          const path = endpoint.path
            .replace("{start}", start_date)
            .replace("{end}", end_date);
          const query: Record<string, string> = {};
          if ("queryMode" in endpoint && endpoint.queryMode === "dateRange") {
            query.startDate = start_date;
            query.endDate = end_date;
          }
          if ("query" in endpoint) Object.assign(query, endpoint.query);
          return textResult(await garminGetJson(path, query));
        } catch (error) {
          return errorResult(error);
        }
      }
    );
  }

  // Every dedicated daily wrapper in the Garmin-maintained Python client.
  for (const endpoint of dailyEndpoints) {
    server.registerTool(
      endpoint.name,
      {
        description: `${endpoint.description}. Date format YYYY-MM-DD.`,
        inputSchema: z.object({ date: dateSchema }),
      },
      async ({ date }) => {
        try {
          validateDate(date);
          const path = endpoint.path.replace("{date}", date);
          const query: Record<string, string> = {};
          if ("queryMode" in endpoint && endpoint.queryMode === "date") query.date = date;
          return textResult(await garminGetJson(path, query));
        } catch (error) {
          return errorResult(error);
        }
      }
    );
  }

  // Profile settings and heart-rate-zone configuration.
  for (const endpoint of noArgumentEndpoints) {
    server.registerTool(
      endpoint.name,
      {
        description: endpoint.description,
        inputSchema: z.object({}),
      },
      async () => {
        try {
          return textResult(await garminGetJson(endpoint.path));
        } catch (error) {
          return errorResult(error);
        }
      }
    );
  }

  server.registerTool(
    "garmin_get_menstrual_cycle_day_view",
    {
      description: "Get menstrual cycle day view for the requested date and today's date.",
      inputSchema: z.object({ date: dateSchema, today_date: dateSchema }),
    },
    async ({ date, today_date }) => {
      try {
        validateDate(date);
        validateDate(today_date);
        return textResult(await garminGetJson(
          `/periodichealth-service/menstrualcycle/dayview/${date}`,
          { todayDate: today_date }
        ));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "garmin_search_activities",
    {
      description: "List and search Garmin activities. Use pagination to avoid oversized responses.",
      inputSchema: z.object({
        start: z.number().int().min(0).default(0).describe("Zero-based paging offset"),
        limit: z.number().int().min(1).max(100).default(20),
        start_date: dateSchema.optional(),
        end_date: dateSchema.optional(),
        activity_type: z.string().max(80).optional(),
      }),
    },
    async ({ start, limit, start_date, end_date, activity_type }) => {
      try {
        if (start_date) validateDate(start_date);
        if (end_date) validateDate(end_date);
        if (start_date && end_date) validateRange(start_date, end_date);
        return textResult(await garminGetJson(
          "/activitylist-service/activities/search/activities",
          {
            start,
            limit,
            startDate: start_date,
            endDate: end_date,
            activityType: activity_type,
          }
        ));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "garmin_get_activity",
    {
      description: "Get metadata and full JSON details for a Garmin activity ID.",
      inputSchema: z.object({ activity_id: idSchema }),
    },
    async ({ activity_id }) => {
      try {
        return textResult(await garminGetJson(`/activity-service/activity/${activity_id}`));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "garmin_get_activity_workouts",
    {
      description: "Get workouts associated with one Garmin activity ID.",
      inputSchema: z.object({ activity_id: idSchema }),
    },
    async ({ activity_id }) => {
      try {
        return textResult(await garminGetJson(`/activity-service/activity/${activity_id}/workouts`));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "garmin_download_activity",
    {
      description: "Get a numbered base64 chunk of the Garmin activity ZIP (up to 15 MB total). Begin with chunk_index 0, then retrieve each subsequent chunk and concatenate decoded bytes in order. This returns binary data, not parsed FIT metrics.",
      inputSchema: z.object({ activity_id: idSchema, chunk_index: z.number().int().min(0).default(0) }),
    },
    async ({ activity_id, chunk_index }) => {
      try {
        return textResult(await garminDownloadActivity(activity_id, chunk_index));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "garmin_list_available_endpoints",
    {
      description: "List all Garmin Personal API read-only endpoints implemented as dedicated tools, including their HTTP paths. Other documented GET endpoints can be accessed with garmin_get_raw_endpoint.",
      inputSchema: z.object({}),
    },
    async () => textResult({
      source: "Garmin's official connect-personal-api-python dedicated wrapper list",
      dedicated_endpoint_count: endpointCatalog.length,
      endpoints: endpointCatalog,
      note: "For GET endpoints without a dedicated wrapper, use garmin_get_raw_endpoint. Garmin's Swagger catalog may contain more endpoints.",
    })
  );

  server.registerTool(
    "garmin_get_raw_endpoint",
    {
      description: "Read an additional Garmin Personal API GET endpoint documented in Garmin's Swagger that does not yet have a dedicated tool. Pass ONLY the Garmin-relative path beginning with /, plus query parameters. No external hosts, write methods, authentication paths or redirects are permitted. Do not guess endpoint paths.",
      inputSchema: z.object({
        path: z.string().min(2).max(300).describe("Documented GET path such as /some-service/resource; no full URL and no query string"),
        query: z.record(z.string(), z.string().max(250)).optional().describe("URL query parameters, as string values"),
      }),
    },
    async ({ path, query }) => {
      try {
        return textResult(await garminGetJson(path, query ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
});

// Preserve the original, verified Auth0 enforcement from Phase 2.
async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const issuer = process.env.AUTH0_ISSUER?.replace(/\/$/, "");
  const audience = process.env.AUTH0_AUDIENCE;
  const allowedSub = process.env.AUTH0_ALLOWED_SUB;
  if (!issuer || !audience || !allowedSub) return undefined;

  try {
    const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(bearerToken, jwks, {
      issuer: `${issuer}/`,
      audience,
      algorithms: ["RS256"],
    });
    if (payload.sub !== allowedSub) return undefined;
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (!scopes.includes("read:garmin")) return undefined;
    return {
      token: bearerToken,
      scopes,
      clientId: typeof payload.azp === "string" ? payload.azp : (payload.sub ?? "unknown"),
    };
  } catch {
    return undefined;
  }
}

const protectedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ["read:garmin"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { protectedHandler as GET, protectedHandler as POST, protectedHandler as DELETE };
