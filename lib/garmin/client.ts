// Garmin Connect Personal API transport. Server-side only.
// The Personal API key and bearer token must never be returned to an MCP client.

const BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const MAX_JSON_BYTES = 350_000;
const MAX_BINARY_BYTES = 15_000_000;
const BINARY_CHUNK_BYTES = 48_000;

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | undefined;

export class GarminApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GarminApiError";
  }
}

async function getToken(forceRefresh = false): Promise<string> {
  const apiKey = process.env.GARMIN_PERSONAL_API_KEY?.trim();
  if (!apiKey) throw new GarminApiError("GARMIN_PERSONAL_API_KEY is missing from Vercel.");

  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const response = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers: { Authorization: `ApiKey ${apiKey}`, Accept: "*/*" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new GarminApiError(`Garmin token request failed (HTTP ${response.status}).`);
  }

  const value = (await response.text()).trim();
  const parts = value.split(".");
  if (parts.length !== 3) throw new GarminApiError("Unexpected Garmin token format.");
  let expiresAt: number;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || !("exp" in payload) ||
        typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      throw new Error("Invalid exp");
    }
    expiresAt = payload.exp * 1000;
  } catch {
    throw new GarminApiError("Garmin token is missing a valid JWT expiration.");
  }
  cachedToken = { value, expiresAt };
  return value;
}

function safePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") ||
      path.includes("#") || path.includes("\\") || path.includes("%") ||
      !/^\/[A-Za-z0-9_./-]+$/.test(path) || path.split("/").some(x => x === ".." || x === ".")) {
    throw new GarminApiError("Invalid Garmin API path: use an absolute relative path without URL/query/encoding/traversal.");
  }
  if (/token|auth|credential|secret|apikey|api-key/i.test(path)) {
    throw new GarminApiError("Authentication and credential endpoints are blocked.");
  }
  return path;
}

function buildUrl(path: string, query: Record<string, string | number | boolean | undefined> = {}): URL {
  const url = new URL(`${BASE_URL}${safePath(path)}`);
  if (Object.keys(query).length > 15) throw new GarminApiError("Too many query parameters (max 15).");
  for (const [name, value] of Object.entries(query)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name.length > 60) {
      throw new GarminApiError("Invalid query parameter name.");
    }
    if (value !== undefined) {
      const text = String(value);
      if (text.length > 250) throw new GarminApiError("Query parameter value is too long.");
      url.searchParams.set(name, text);
    }
  }
  return url;
}

async function request(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<Response> {
  const url = buildUrl(path, query);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt === 1);
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json, */*" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    });
    if (response.status === 401 && attempt === 0) {
      cachedToken = undefined;
      continue;
    }
    if (!response.ok) {
      throw new GarminApiError(`Garmin GET ${url.pathname} failed (HTTP ${response.status}).`);
    }
    return response;
  }
  throw new GarminApiError("Garmin rejected the refreshed token.");
}

export async function garminGetJson(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): Promise<unknown> {
  const response = await request(path, query);
  const type = response.headers.get("content-type") ?? "";
  if (/application\/zip|application\/octet-stream/i.test(type)) {
    throw new GarminApiError("This endpoint returns a binary file. Use garmin_download_activity for activity ZIPs.");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_JSON_BYTES) {
    await response.body?.cancel();
    throw new GarminApiError(`Response exceeds ${MAX_JSON_BYTES} bytes. Request fewer dates or smaller pages.`);
  }
  // Limit streamed bytes too, because Content-Length may be absent or inaccurate.
  const reader = response.body?.getReader();
  if (!reader) return null;
  const pieces: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new GarminApiError(`Response exceeds ${MAX_JSON_BYTES} bytes. Request fewer dates or smaller pages.`);
    }
    pieces.push(value);
  }
  const body = Buffer.concat(pieces).toString("utf8");
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // Some future documented GET endpoints may return plain text.
    return body;
  }
}

export async function garminDownloadActivity(id: number, chunkIndex: number): Promise<{ activity_id: number; mime_type: string; base64_chunk: string; total_bytes: number; chunk_index: number; total_chunks: number; chunk_bytes: number }> {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new GarminApiError("chunk_index must be a nonnegative integer.");
  if (!Number.isSafeInteger(id) || id < 1) throw new GarminApiError("Activity ID must be a positive integer.");
  const response = await request(`/download-service/files/activity/${id}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BINARY_BYTES) {
    await response.body?.cancel();
    throw new GarminApiError(`Activity ZIP is larger than ${MAX_BINARY_BYTES} bytes. File exceeds the safety ceiling for serverless download.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new GarminApiError("Empty activity ZIP response.");
  const pieces: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BINARY_BYTES) {
      await reader.cancel();
      throw new GarminApiError(`Activity ZIP is larger than ${MAX_BINARY_BYTES} bytes. File exceeds the safety ceiling for serverless download.`);
    }
    pieces.push(value);
  }
  if (!bytes) throw new GarminApiError("Garmin returned an empty activity ZIP.");
  const file = Buffer.concat(pieces);
  const totalChunks = Math.ceil(file.length / BINARY_CHUNK_BYTES);
  if (chunkIndex >= totalChunks) throw new GarminApiError(`chunk_index out of range; total chunks: ${totalChunks}.`);
  const chunk = file.subarray(chunkIndex * BINARY_CHUNK_BYTES, (chunkIndex + 1) * BINARY_CHUNK_BYTES);
  return { activity_id: id, mime_type: "application/zip", total_bytes: bytes, chunk_index: chunkIndex, total_chunks: totalChunks, chunk_bytes: chunk.length, base64_chunk: chunk.toString("base64") };
}
