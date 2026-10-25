import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

export const GET = (req: Request) => {
  const issuer =
    process.env.AUTH0_ISSUER?.replace(/\/$/, "");

  if (!issuer) {
    return Response.json(
      { error: "OAuth not configured" },
      { status: 503 }
    );
  }

  return protectedResourceHandler({
    authServerUrls: [`${issuer}/`],
  })(req);
};

export const OPTIONS =
  metadataCorsOptionsRequestHandler();
