# Garmin Personal MCP — Koyeb Cloud Deployment

**What you get:** Cloud-hosted read-only MCP access to Garmin's official Personal API, using [Mason-Levyy/garmin-personal-mcp](https://github.com/Mason-Levyy/garmin-personal-mcp) as the underlying Garmin integration. This repository supplies a Docker image and a protective, secret-URL gateway. No Garmin password is needed.

> **Security caveat:** The secret in the URL is a bearer credential. It is an easy personal-use setup, NOT full OAuth. Anyone who obtains your entire MCP URL could read your Garmin health data. Keep the URL private, never paste it in public issues/screenshots, do not enable access logging, and rotate the URL token if exposed. Some infrastructure may still log paths despite application logging being disabled. OAuth via a compatible gateway is preferable for stronger security. Do not use this as a multiuser service.

> **Verification caveat:** The application code is syntax-checked, but an end-to-end deployment was not possible to test without your Garmin key, Koyeb account, and package installation. The upstream package and MCP client may evolve. Start with the test below.

## Step 1: Create your Garmin Personal API key

1. Open [Garmin Connect](https://connect.garmin.com/) and sign in.
2. Go to **Settings → Personal API** ([Garmin instructions](https://developer.garmin.com/gc-developer-program/personal/personal-api/)).
3. Create a Personal API key, select the lifetime and save it privately. It is shown once.
4. **Never** put this key in GitHub or this chat.

## Step 2: Generate a private endpoint token

On your Windows PC in a terminal with Python installed:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(32))"
```

Save the output in your password manager. This is separate from your Garmin API key. If you do not have Python, use another cryptographically secure random generator (at least 32 URL-safe characters).

## Step 3: Upload the project to private GitHub

1. Extract this ZIP.
2. Create a **private** GitHub repository, e.g. `garmin-koyeb-mcp`.
3. Upload all files in the extracted folder (Dockerfile, app.py, requirements.txt, README.md, .dockerignore, .gitignore, .env.example). Ensure the files are at repository root, not inside a nested directory.
4. Do **not** create a real `.env` in GitHub. The `.env.example` contains placeholders only.

## Step 4: Deploy to Koyeb

1. Open [Koyeb](https://app.koyeb.com/), sign up and connect GitHub.
2. Create a **Web Service** and select the private repository.
3. Choose **Dockerfile** build method; Dockerfile path: `Dockerfile`.
4. Choose the **Free** instance if available on your account, one instance, the supported free region. Check that the displayed price is $0 before deploying.
5. Expose port **8000** as HTTP and route `/` to it. Do not expose internal port `8491`.
6. Add these environment variables in Koyeb's private environment/secrets settings:

   | Name | Value |
   | --- | --- |
   | `GARMIN_PERSONAL_API_KEY` | Your Garmin Personal API key |
   | `MCP_ACCESS_TOKEN` | The random token from Step 2 |
   | `PORT` | `8000` |

7. Configure health check path `/health` (HTTP GET) if Koyeb asks.
8. Deploy. Koyeb will build the Docker image and provide an HTTPS hostname, e.g. `https://my-garmin-xyz.koyeb.app`.

Koyeb's current GitHub deployment guide: https://www.koyeb.com/docs/build-and-deploy/deploy-with-git

**Important:** The Garmin server runs on loopback `127.0.0.1:8491`. Only the gateway is public. The gateway responds to MCP only at `/mcp/<your-token>`; other paths return 404. `/health` contains no Garmin data.

## Step 5: Check deployment

Open `https://<your-Koyeb-host>/health` in your browser. Expected:

```json
{"status":"ok"}
```

This establishes only that the gateway and MCP listener started; it does not prove the Garmin API key works or that ChatGPT can use it.

To check protection, request `https://<your-Koyeb-host>/mcp/not-the-token` — expected HTTP 404.

## Step 6: Connect to ChatGPT

1. On **ChatGPT web**, open **Plugins** → `+` → **Add custom MCP server**.
2. Enter a label like `My Garmin`.
3. Set server URL to **exactly**:

   `https://<your-Koyeb-host>/mcp/<your-random-MCP_ACCESS_TOKEN>`

4. Select **No authentication** for the ChatGPT connection. **This does not mean the server is public**: the secret URL functions as access control, and the service rejects other URLs. This simpler method is less secure than standards-based OAuth; assess whether it is acceptable for your personal health data.
5. Review the risk warning, create/install the connection, and inspect the discovered tools.
6. In a normal text chat, @mention/select the plugin and ask: `Use My Garmin to show my HRV for the last 7 days.`

**Note:** ChatGPT custom MCP capabilities are plan- and workspace-dependent. This does not require Work mode, but your account must support creating and using a custom MCP connection. Mobile Voice invocation is not assured.

## What Garmin data is covered?

The upstream project exposes tools documented at https://github.com/Mason-Levyy/garmin-personal-mcp . These include: daily wellness summary, steps, stress, hydration, Body Battery, heart rate, SpO2, wellness activities, sleep and sleep history, HRV and HRV history, weight and goals, nutrition log, searchable activities, activity details/splits/workout metadata, heart rate zones, fitness age, profile, and several other officially documented features.

The project relies on the upstream project to maintain endpoint mappings; it does not dynamically ingest future Garmin Swagger endpoints. **"Everything" therefore means every endpoint supported by the upstream library today**, not a guarantee of access to every metric Garmin Connect displays or future endpoints Garmin adds. Garmin's Personal API is read-only. `garmin_download_activity` writes an activity archive to the server filesystem and is not itself a method of downloading files to ChatGPT; ephemeral hosting means that saved server file is not durable.

For very long historical comparisons, ask the model to query smaller chunks if needed. The model's context window and output limits still apply.

## Cost and limitations

- Koyeb Free instances can scale to zero after idle periods; cold starts and response latency are possible.
- Free instance memory/CPU, build policy, regional availability and payment-verification requirements may change. Confirm in Koyeb's dashboard that cost is zero.
- Token cache on an ephemeral instance may disappear after a cold start; the upstream library can exchange the stored API key for a new bearer token again.
- Rotating `MCP_ACCESS_TOKEN` requires updating the ChatGPT server URL.
- Rotating/renewing `GARMIN_PERSONAL_API_KEY` requires updating the Koyeb environment variable and redeploying/restarting.
- Do not share the full URL or your secrets in chat messages.
- The server doesn't implement full OAuth; for more robust security use a standards-compliant OAuth gateway.

## Troubleshooting

- Koyeb build fails: read the pip install error in build logs; upstream dependency versions might have changed.
- `/health` doesn't respond: confirm `PORT=8000`, Dockerfile build, exposed HTTP port 8000, and deployment logs.
- ChatGPT cannot discover tools: inspect the MCP URL, secret, and Koyeb logs; free-tier cold starts may cause timeout.
- Garmin returns invalid key: regenerate/update your Garmin Personal API key.
- `400 Invalid Host header`: upstream MCP Host checks have changed; check upstream docs and update proxy or `--allowed-host` appropriately.
- For a privacy concern: revoke Garmin key and rotate `MCP_ACCESS_TOKEN` immediately.

## Local optional test (requires Docker)

```bash
docker build -t garmin-koyeb-mcp .
docker run --rm -p 8000:8000 -e GARMIN_PERSONAL_API_KEY=YOUR_KEY -e MCP_ACCESS_TOKEN=YOUR_LONG_RANDOM_TOKEN garmin-koyeb-mcp
```

In a second terminal: `curl http://localhost:8000/health`.

## Upstream sources

- Garmin Personal API: https://developer.garmin.com/gc-developer-program/personal/personal-api/
- Garmin OpenAPI/Swagger: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
- Garmin SDK: https://github.com/garmin/connect-personal-api-python
- MCP implementation: https://github.com/Mason-Levyy/garmin-personal-mcp
- ChatGPT MCP guide: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
