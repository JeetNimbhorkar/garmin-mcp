export async function GET() {
  return Response.json({ status: "ok", stage: "connectivity-test", garmin_connected: false });
}
