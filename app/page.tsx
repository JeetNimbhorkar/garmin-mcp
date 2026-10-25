export default function Home() {
  return <main style={{fontFamily:"sans-serif",padding:40}}>
    <h1>Garmin MCP — connection test</h1>
    <p>No Garmin data is connected yet.</p>
    <p>Health: <a href="/api/health">/api/health</a></p>
    <p>MCP endpoint: <code>/api/mcp</code></p>
  </main>;
}
