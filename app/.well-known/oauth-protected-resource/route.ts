import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

const RESOURCE_URL =
  "https://garmin-mcp-nu.vercel.app/api/mcp";

const issuer =
  process.env.AUTH0_ISSUER?.replace(/\/$/, "");

export const GET = (req: Request) => {
  if (!issuer) {
    return Response.json(
      { error: "OAuth not configured" },
      { status: 503 }
    );
  }

  return protectedResourceHandler({
    authServerUrls: [issuer + "/"],
    resourceUrl: RESOURCE_URL,
  })(req);
};

export const OPTIONS =
  metadataCorsOptionsRequestHandler();
