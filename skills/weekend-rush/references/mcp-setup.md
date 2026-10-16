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

Supported operations: `status`, `stations`, `tickets`, `search`, `detail`, `around`, `weather`, `route`, `information-sources`, `information-lookup`. Up to 30 queries run sequentially per batch, with error results for individual failures and no simulated replacement data. Calls are cached only within the process; starting a new batch does not share its in-memory cache. Group related calls to avoid repeating paid/quota-limited requests. `around` accepts `{ city, anchorId, keywords, radius? }` where `anchorId` must identify an already-confirmed POI; radius defaults to 1,000 meters. The adapter validates up to six nearby detail records and returns at most three.

`information-sources` reports four reserved source ports: `meal-price`, `hotel-rate`, `admission`, and `opening-hours`. All are **disconnected by default**. `information-lookup` accepts `{ kind, city, date, placeId? or placeName?, ...providerSpecificFields }`; a disconnected port returns `SOURCE_NOT_CONNECTED`, never a sample quote. To connect a provider, inject `{ informationProviders: { [kind]: { name, query } } }` into `createLiveService`; the provider must return dated, sourced evidence according to [the data contract](data-contract.md). No FlyAI, venue website, Meituan, or hotel partner API is currently called by these ports. This preserves the integration surface without implying API access or requesting extra credentials today.

```json
{
  "queries": [
    { "id": "city-stations", "operation": "stations", "input": { "city": "上海" } },
    { "id": "find-places", "operation": "search", "input": { "city": "上海", "keywords": "建筑 街区" } }
  ]
}
```

Each result has `ok` and either `result` or `code`/`error`. For `detail`, input is `{ "city": "上海", "id": "SELECTED_POI_ID" }`. For `tickets`, use `date`, `fromCity`, `toCity`, `fromStationCode`, `toStationCode`. For `route`, use verified `origin`/`destination` objects with `id`, `name`, `location`, plus `city` and `pace` (`coverage`/`gentle`). Dates must be within the provider's current 15-day window; station membership and POI city are checked. Query timestamps identify freshness, not a booking or future service guarantee.

Route results preserve ordered steps from the selected AMap option. Multiple lines in one segment are alternatives. A transit route-level distance is not assigned to an individual transit option; unknown total distance and fare remain null. POI detail may include business area, alias, rating, reference consumption, opening text, and safe HTTPS photo links. Reference consumption is not a quoted price, and opening text is not a date-specific check.

The validation and HTML-rendering helpers have no npm runtime dependencies. Repository tests use fixtures and do not contact either provider.
