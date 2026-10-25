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

import { dailySeries, summarizeDailyRows, activityDigest, recoveryDigest, numberAt } from "../../../lib/garmin/analysis";

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

  // Higher-level read-only analytics modeled on useful ideas from Garmin MCP projects.
  // These tools use ONLY the previously verified Garmin Personal API read endpoints.
  server.registerTool(
    "garmin_analyze_daily_trends",
    {
      description: "Calculate day-by-day trends from Garmin's official read-only summaries. Supports resting heart rate, steps, stress, and HRV. Requires a limited interval; reports missing values honestly.",
      inputSchema: z.object({
        metric: z.enum(["resting_hr", "steps", "stress", "hrv"]),
        start_date: dateSchema,
        end_date: dateSchema,
      }),
    },
    async ({ metric, start_date, end_date }) => {
      try {
        validateRange(start_date, end_date);
        const days = Math.round((Date.parse(end_date)-Date.parse(start_date))/86400000)+1;
        if (days > 90) throw new Error("Trend requests are limited to 90 calendar days; divide longer periods into intervals.");
        if (metric === "resting_hr") {
          // Garmin's detailed dailyHeartRate returns restingHeartRate directly.
          // The generic dailysummaries response may not contain that field.
          // Bound fanout for Vercel execution time and Garmin rate limits.
          if (days > 31) throw new Error("Resting-HR trends are limited to 31 days per call because each day requires its own heart-rate request. Split longer periods into monthly calls.");
          const dates = Array.from({length:days}, (_,i) => new Date(Date.parse(start_date)+i*86400000).toISOString().slice(0,10));
          const rows: Array<{date:string;value:number|null}> = [];
          const errors: Array<{date:string;error:string}> = [];
          for (let i=0; i<dates.length; i+=5) {
            const batch = dates.slice(i,i+5);
            const results = await Promise.all(batch.map(async date => {
              try {
                const raw = await garminGetJson("/wellness-service/wellness/dailyHeartRate",{date});
                return {date,value:numberAt(raw,["restingHeartRate","restingHeartRateValue"]),error:null};
              } catch (e) {
                return {date,value:null,error:e instanceof Error?e.message:String(e)};
              }
            }));
            for (const result of results) {
              rows.push({date:result.date,value:result.value});
              if (result.error) errors.push({date:result.date,error:result.error});
            }
          }
          return textResult({
            metric,start_date,end_date,
            stats:summarizeDailyRows(rows,["restingHeartRate","restingHeartRateValue"]),
            source_endpoint:"/wellness-service/wellness/dailyHeartRate?date=YYYY-MM-DD",
            failed_requests:errors,
            note:"One documented daily heart-rate request per calendar day. No imputation; errors and missing values are separate."
          });
        }
        const specs = {
          steps: { path: `/usersummary-service/stats/steps/daily/${start_date}/${end_date}`, query: {}, fields: ["totalSteps", "steps", "stepCount"] },
          stress: { path: `/usersummary-service/stats/stress/daily/${start_date}/${end_date}`, query: {}, fields: ["averageStressLevel", "avgStressLevel", "stressLevel"] },
          hrv: { path: `/hrv-service/hrv/daily/${start_date}/${end_date}`, query: {}, fields: ["lastNightAvg", "avgOvernightHrv"] },
        } as const;
        const spec = specs[metric];
        const raw = await garminGetJson(spec.path, spec.query);
        return textResult({ metric, start_date, end_date, stats: dailySeries(raw, [...spec.fields]), source_endpoint: spec.path, note: "Only recognized numeric fields are aggregated; check numeric_observations before interpreting results." });
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "garmin_recovery_snapshot",
    {
      description: "Combine official Garmin sleep, HRV, heart rate and Body Battery results for one date. Factual snapshot, NOT an invented readiness score.",
      inputSchema: z.object({ date: dateSchema }),
    },
    async ({ date }) => {
      try {
        validateDate(date);
        const requests = [
          () => garminGetJson("/sleep-service/sleep/dailySleep", { date }),
          () => garminGetJson(`/hrv-service/hrv/${date}`),
          () => garminGetJson("/wellness-service/wellness/dailyHeartRate", { date }),
          () => garminGetJson("/wellness-service/wellness/bodyBattery/reports/daily", { startDate:date, endDate:date }),
        ];
        const resolved = await Promise.all(requests.map(fn=>fn().then(value=>({ok:true,value})).catch(error=>({ok:false,error:error instanceof Error?error.message:String(error)}))));
        const [sleep,hrv,heartRate,battery]=resolved.map(r=>r.ok && "value" in r ? r.value : null);
        return textResult({ ...recoveryDigest(date,sleep,hrv,heartRate,battery) as object,
          sources: ["sleep","hrv","heart_rate","body_battery"].map((name,i)=>({name,ok:resolved[i].ok,...(!resolved[i].ok && "error" in resolved[i] ? {error:resolved[i].error}: {})}))
        });
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    "garmin_analyze_activities",
    {
      description: "Summarize Garmin activities with separate recorded/timer duration, moving duration and elapsed duration; sport-appropriate pace or speed, HR and training effect. Supports pagination; does not pretend an incomplete page is a complete training history.",
      inputSchema: z.object({
        start_date: dateSchema.optional(),
        end_date: dateSchema.optional(),
        activity_type: z.string().max(80).optional(),
        start: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(30).default(20),
      }),
    },
    async ({start_date,end_date,activity_type,start,limit}) => {
      try {
        if (start_date) validateDate(start_date);
        if (end_date) validateDate(end_date);
        if (start_date && end_date) validateRange(start_date,end_date);
        const raw=await garminGetJson("/activitylist-service/activities/search/activities",{
          start,limit,startDate:start_date,endDate:end_date,activityType:activity_type
        });
        return textResult({filters:{start_date,end_date,activity_type,start,limit},analysis:activityDigest(raw,limit)});
      } catch (error) { return errorResult(error); }
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
