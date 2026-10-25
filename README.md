# Garmin Connect Personal MCP (read-only)

A personal Garmin Connect MCP server for **ChatGPT**, hosted on **Vercel** and protected by **Auth0 OAuth**. The server uses Garmin's **official Garmin Connect Personal API** and your own Personal API key. It makes Garmin health and training data queryable in natural language, including basic server-side analyses. **No workout, calendar, or account writes are implemented.**

> This is a personal project, not an official Garmin product. Garmin is a trademark of Garmin Ltd. This project is **not** the same as the unofficial Garmin Connect session-based integration.

## Status

- ChatGPT → Vercel MCP and Auth0 OAuth: verified with authenticated `ping` and unauthenticated-access rejection.
- Garmin API-key → bearer-token exchange and `garmin_get_profile`: verified with real data.
- 24 dedicated official Python-client-equivalent data operations: registered; several categories tested successfully. **Not every operation individually verified**.
- `garmin_get_raw_endpoint` allows additional *known, documented* Garmin Personal API GET routes that have no dedicated wrapper. This is **not automatic endpoint discovery**.
- Server-side analytics: **corrected in Phase 5.1** for daily resting-HR extraction, separate duration semantics, and compact recovery details. Live validation is still required after deployment.
- **Complete Swagger parity is not claimed.** See [Coverage limitations](#coverage-limitations).

## Architecture

```text
ChatGPT (MCP client)
    │ OAuth / read:garmin
    ▼
Vercel Next.js /api/mcp
    ├── Auth0 JWT verification + single-user allowlist
    ├── registered MCP tools
    ├── lib/garmin/analysis.ts    (aggregation without fabricating values)
    ├── lib/garmin/endpoints.ts   (official Python-client wrapper inventory)
    └── lib/garmin/client.ts      (safe GET + token exchange + response limits)
              │ Garmin Personal API key (server-side secret)
              ▼
    personal.connectapi.garmin.com
```

The MCP endpoint is `https://garmin-mcp-nu.vercel.app/api/mcp` for this deployment. Do not add API keys or bearer tokens to GitHub or to prompts.

## Project structure

```text
app/
  api/mcp/route.ts                    # MCP tools + existing Auth0 authorization
  api/health/route.ts                 # Existing health check (unchanged)
  .well-known/oauth-protected-resource/route.ts # OAuth metadata (unchanged)
lib/garmin/
  client.ts                           # Garmin token exchange / HTTP GET / activity ZIP
  endpoints.ts                        # 24 official-client-equivalent endpoint definitions
  analysis.ts                         # NEW: trend, recovery and activity analyses
README.md                             # This document
```

## Credentials and configuration

Set in Vercel → Settings → Environment Variables (Production):

| Variable | Description |
|---|---|
| `AUTH0_ISSUER` | Auth0 issuer URL (`https://...auth0.com`) |
| `AUTH0_AUDIENCE` | OAuth audience, matching the MCP resource identifier |
| `AUTH0_ALLOWED_SUB` | Single permitted Auth0 user ID (`auth0|...`) |
| `GARMIN_PERSONAL_API_KEY` | Official Garmin Connect Personal API key |

Use an Auth0 OAuth client with the `read:garmin` scope. The server checks JWT signature, issuer, audience, user ID and scope. Do not weaken this layer to troubleshoot Garmin issues.

## Tool inventory

### Infrastructure / discovery

- `ping`: OAuth and MCP connectivity test.
- `garmin_list_available_endpoints`: show all 24 dedicated endpoint definitions.
- `garmin_get_raw_endpoint`: read other **documented** GET resources on Garmin's Personal API host. Fixed host, GET-only, strict URL validation, redirects prohibited, size limits. Does not magically enumerate APIs and must not be used for auth/token paths.

### Dedicated Garmin Personal API operations (24)

| Tool | Data |
|---|---|
| `garmin_get_stress` | Date-range stress summaries |
| `garmin_get_steps` | Date-range step counts |
| `garmin_get_hydration` | Date-range hydration |
| `garmin_get_weight_goals` | Date-range weight goals |
| `garmin_get_weight_measurements` | Date-range weigh-ins |
| `garmin_get_sleep_summaries` | Date-range sleep summaries |
| `garmin_get_body_battery` | Date-range Body Battery reports |
| `garmin_get_daily_summaries` | Date-range daily health summaries |
| `garmin_get_hrv_summaries` | Date-range HRV summaries |
| `garmin_get_wellness_activity_summaries` | Date-range wellness activities |
| `garmin_get_food_logs` | Daily food logs |
| `garmin_get_sleep` | Detailed daily sleep |
| `garmin_get_heart_rate` | Detailed daily heart rate |
| `garmin_get_hrv` | Daily HRV |
| `garmin_get_menstrual_cycle_summary` | Cycle summary (if available) |
| `garmin_get_fitness_age` | Fitness age |
| `garmin_get_spo2` | Daily SpO2 |
| `garmin_get_profile` | Garmin profile settings |
| `garmin_get_heart_rate_zones` | Configured HR zones |
| `garmin_get_menstrual_cycle_day_view` | Cycle day view (if available) |
| `garmin_search_activities` | Paginated activity search |
| `garmin_get_activity` | Detailed activity |
| `garmin_get_activity_workouts` | Workouts attached to an activity |
| `garmin_download_activity` | Chunked activity ZIP file bytes (not FIT parsing) |

The 24 operations mirror the publicly documented wrapper list at <https://github.com/garmin/connect-personal-api-python#endpoint-wrappers> as of **2026-10-25**. The client may lag behind Garmin's full Swagger inventory.

### Analysis tools (new)

| Tool | What it does | Important limitation |
|---|---|---|
| `garmin_analyze_daily_trends` | Daily averages and trends for `resting_hr` (up to 31 days from individual daily-heart-rate records); `steps`, `stress`, `hrv` up to 90 days | Aggregates only recognized source fields and clearly reports observation counts; **HRV trend is not a medical assessment** |
| `garmin_recovery_snapshot` | Collects sleep, HRV, heart rate and Body Battery for one date with per-source success/failure | Factual composite, **not** a proprietary Garmin Training Readiness score or scientifically validated substitute |
| `garmin_analyze_activities` | Summarizes up to 30 activities/page: distance, duration, calculated pace, HR, elevation and training effect where present | Depends on field names; page totals are not assumed to be complete history |

**Tool count after release:** 24 dedicated Garmin reads + 3 core tools (`ping`, catalog, raw GET) + 3 analysis tools = **30 registered MCP tools**.

## Example ChatGPT prompts

- “Call `garmin_recovery_snapshot` for 2026-10-20 and show me what is known versus missing.”
- “Call `garmin_analyze_daily_trends` for `resting_hr`, 2026-10-01 to 2026-10-25. Report average and whether enough observations exist for a trend.”
- “Call `garmin_analyze_daily_trends` for `hrv` for the last 30 days. Don't equate missing values to zero.”
- “Call `garmin_analyze_activities` for my last 20 runs and show distance and average pace.”
- “Use `garmin_search_activities` to find an activity, then `garmin_get_activity` to inspect details. Do not infer running dynamics unless returned.”
- “List `garmin_list_available_endpoints` so I can see the official wrapper coverage.”

## Updating GitHub using the web UI

1. Create `lib/garmin/analysis.ts` from the provided release file. Commit it first.
2. Replace **all** contents of `app/api/mcp/route.ts` with the provided release file. Commit.
3. Replace **all** contents of `README.md` with this README. Commit.
4. Keep `lib/garmin/client.ts`, `lib/garmin/endpoints.ts`, package dependencies, Auth0 settings and OAuth metadata unchanged. The release includes copies of `client.ts` and `endpoints.ts` purely for convenience/reference, not because a replacement is required.
5. In Vercel confirm the latest Production deployment shows **Ready**. Intermediate commits may temporarily fail if the new import has not been created first.
6. In ChatGPT → your custom app → **Refresh tools**. Test the three new analysis tools. The existing app name and Auth0 identity can remain as they are.

If the final deployment fails, inspect Vercel build logs and share the exact **non-secret** error. Do not paste tokens, JWTs, API keys or full profile JSON.

## Coverage limitations

**We cannot honestly claim 100% official API coverage yet**. Garmin's Python client explicitly says its dedicated wrappers may lag behind the Swagger API. The public Swagger landing page does not expose a machine-readable full inventory in the browsable content reviewed for this release, and your account's endpoint permissions may differ. Accordingly:

1. **Verified catalog parity:** all 24 published official Python-client wrappers are represented.
2. **Additional documented GETs:** can be called through `garmin_get_raw_endpoint`, if the exact path and permitted query parameters are known.
3. **Not certified:** all Swagger GETs, any read-only POST routes, APIs requiring separate permissions, or data that Garmin Connect displays but does not expose through Personal API.
4. **Advanced metrics:** dedicated training readiness, VO2max history, race predictions, lactate threshold, acute/chronic load, running dynamics, etc. are only available if **documented permitted endpoints** expose them, or if they appear in existing returned payloads. No invented endpoints are used.
5. **Workout writes:** intentionally excluded; we keep the MCP strictly read-only.
6. **Analysis:** `analysis.ts` recognizes common Garmin field names, and unknown layouts are represented as missing; Garmin payload versions may require field-map refinement after live testing.
7. **Activity files:** binary ZIP downloads are chunked but FIT/TCX parsing is not implemented. This can be added separately once an acceptable read-only parser and storage/size strategy have been verified.
8. **Long-range data:** large requests can exceed Garmin/Vercel or MCP response limits. Chunk histories into smaller intervals, and do not infer absent records represent zero activity.

### Gap audit checklist

- Obtain the actual authorized Swagger/OpenAPI operation inventory directly from Garmin Developer Portal when available.
- Compare `path + method` against the 24-item `endpoints.ts` table.
- Classify **GET**, read-only **POST**, **write**, **requires additional permission**, and **undocumented**.
- Add explicit wrappers for missing authorized read endpoints after validating response shapes and access.
- Test each wrapper with your own account and track the result in a coverage matrix (no sensitive response bodies in public GitHub).

## Inspiration and attribution

- Garmin official [connect-personal-api-python](https://github.com/garmin/connect-personal-api-python) — **authoritative behavioral reference** for key → bearer token exchange and the 24 documented read wrappers; Apache-2.0 licensed. This TypeScript project is an independent implementation rather than a Python translation or vendored source.
- [Bartolome69/garmin-mcp](https://github.com/Bartolome69/garmin-mcp) — **feature inspiration** for helpful high-level activity and recovery summaries. This project uses a distinct, unofficial Garmin Connect session-based approach; we have not copied it, imported its dependencies, used its credentials flow, or enabled its write tools.
- Garmin [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/) and [Swagger documentation](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/).

## Privacy and safety

Read-only data access still reveals health and activity information to the authenticated ChatGPT client when invoked. Use plugin permissions appropriate to your comfort and never expose the Vercel URL with unsecured routes. A Garmin API token is cached **only in serverless process memory**, never committed to GitHub or returned by MCP tools. Serverless memory is ephemeral and token exchange occurs again when needed. This project offers descriptive trends only; it is not a diagnostic or medical device.

## Phase 5.1 accuracy fixes (2026-10-25)

- **Resting HR trends** now use Garmin's documented `/wellness-service/wellness/dailyHeartRate?date=...` endpoint. Each date is fetched separately, five requests concurrently at most, with a 31-day limit per call. Null readings and failed requests are explicitly reported. Larger retrospective comparisons should be divided into monthly intervals. This fixes the mismatch where 20 daily-summary records yielded zero recognized resting-HR values.
- **Activity duration** is now three separate values: `duration_minutes` (Garmin `duration`/`timerDuration`), `moving_duration_minutes`, and `elapsed_duration_minutes`. `total_duration_minutes` sums **only** the `duration` values. Missing duration is null, not substituted by moving time. Totals for each type report coverage counts and should not be conflated. Running/walking/hiking pace is calculated from Garmin duration; cycling/suitable sports receive speed in km/h; swimming and strength receive neither synthetic running pace nor irrelevant speed. Garmin fields vary across sports and firmware; check against raw activities.
- **Recovery snapshot** recognizes a nested `sleepScores.overall.value` and common stage-duration fields when returned, and replaces full raw Body Battery timeseries with a compact statistical summary. Fields that are not present remain null; no score is invented.

> A passing local calculation test is not the same as validating production Garmin records. Run the Phase 5.1 test checklist after deployment. The documented 24 wrapper operations and Auth0 protection have not changed.
