# Garmin MCP — Vercel connectivity test

This is a **test-only** MCP server. It does not connect to Garmin or require Garmin credentials.

## Deploy
1. Put these files in a GitHub repository (replace the old Koyeb files rather than mixing them).
2. Go to https://vercel.com/new and import that repository.
3. Select **Hobby** (personal/non-commercial). Vercel should detect **Next.js**.
4. Root directory: repository root. No custom build/start commands or environment variables.
5. Deploy and open `https://YOUR-PROJECT.vercel.app/api/health`. Expect:
   `{"status":"ok","stage":"connectivity-test","garmin_connected":false}`
6. In ChatGPT's Add custom MCP server UI, if your account permits an unauthenticated custom endpoint, enter:
   `https://YOUR-PROJECT.vercel.app/api/mcp`
   Select No authentication if offered. Name it `Garmin MCP Test`.
7. Ask ChatGPT: `Use the Garmin MCP Test ping tool with message "test 123".`
   A successful response includes `Garmin MCP connection works. You sent: test 123`.

## Security
The test server is **public** and intentionally contains no Garmin data, API keys, or secrets.
**Do not add Garmin endpoints or credentials** until proper authentication is implemented and verified.
If ChatGPT rejects unauthenticated custom MCP endpoints, stop; OAuth support is needed before real data.
Do not confuse Vercel's own MCP service (`mcp.vercel.com`) with your deployed app.

## Troubleshooting
- 404: Check that the Next.js project root is the repository root.
- Build error: Check Vercel deployment logs. Dependencies use the documented MCP handler v2 API.
- Connection rejected: Check ChatGPT plugin authentication and access requirements.
- `/api/mcp` in a browser is not a valid tool invocation; use an MCP client or ChatGPT.
- You do not need the Garmin developer token during this test.

## After successful connectivity
Add secure authentication, then integrate Garmin's official Personal API read-only endpoints.
Vercel serverless instances must not rely on durable local files for Garmin tokens.
