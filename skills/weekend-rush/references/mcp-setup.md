# MCP setup

Use an AI client that can load Skills and call MCP tools or local scripts. Install Node.js 22+. The host model understands intent and writes/revises the itinerary; this Skill does not require a separate model API key. Each user supplies their own Gaode Web-service Key in `AMAP_MAPS_API_KEY`.

## Native MCP tools

When the host already has rail/map tools configured, use those directly. For local stdio servers the settings shape is:

```json
{
  "mcpServers": {
    "rail": { "command": "npx", "args": ["-y", "12306-mcp@0.3.10"] },
    "amap": { "command": "npx", "args": ["-y", "@amap/amap-maps-mcp-server@0.0.8"] }
  }
}
```

Configure the map Key through the host's private environment settings, not this JSON or chat. Do not modify client configuration without authorization.

- 12306: `npx -y 12306-mcp@0.3.10`
- Gaode: `npx -y @amap/amap-maps-mcp-server@0.0.8` with `AMAP_MAPS_API_KEY` set in the local process environment.

The example configuration contains a placeholder. Configure the variable from the host UI or a private local environment, and keep real keys out of command history, the repository, and shared issues. Each user uses their own Gaode key and must enable the Web service platform. Keep the npm package versions fixed when reproducing a result.

## Self-contained script fallback

If native tools are absent but the AI host can run Node scripts, install the included pinned packages from this Skill directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/query-tools.mjs --input queries.json
```

The query bridge launches both MCPs on demand and closes them after the batch. On Windows it can read the current user's `AMAP_MAPS_API_KEY` environment variable when it is missing from the inherited process environment. It never returns the Key. Do not add secrets to query JSON. Network/sandbox permissions still follow the host's rules.

Supported operations: `status`, `stations`, `tickets`, `search`, `detail`, `weather`, `route`. Up to 30 queries run sequentially per batch, with error results for individual failures and no simulated replacement data. Calls are cached only within the process; starting a new batch does not share its in-memory cache. Group related calls to avoid repeating paid/quota-limited requests.

```json
{
  "queries": [
    { "id": "city-stations", "operation": "stations", "input": { "city": "上海" } },
    { "id": "find-places", "operation": "search", "input": { "city": "上海", "keywords": "建筑 街区" } }
  ]
}
```

Each result has `ok` and either `result` or `code`/`error`. For `detail`, input is `{ "city": "上海", "id": "SELECTED_POI_ID" }`. For `tickets`, use `date`, `fromCity`, `toCity`, `fromStationCode`, `toStationCode`. For `route`, use verified `origin`/`destination` objects with `id`, `name`, `location`, plus `city` and `pace` (`coverage`/`gentle`). Dates must be within the provider's current 15-day window; station membership and POI city are checked. Query timestamps identify freshness, not a booking or future service guarantee.

The validation and HTML-rendering helpers have no npm runtime dependencies. Repository tests use fixtures and do not contact either provider.
