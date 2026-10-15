# MCP setup

Use MCP-capable AI software that supports local stdio servers. Install Node.js 22 or newer. Add the MCP servers using the host's MCP settings and the settings shape in [`configs/mcp-servers.example.json`](../../../configs/mcp-servers.example.json).

- 12306: `npx -y 12306-mcp@0.3.10`
- Gaode: `npx -y @amap/amap-maps-mcp-server@0.0.8` with `AMAP_MAPS_API_KEY` set in the local process environment.

The example configuration contains a placeholder. Configure the variable from the host UI or a private local environment, and keep real keys out of command history, the repository, and shared issues. Each user uses their own Gaode key and must enable the Web service platform. Keep the npm package versions fixed when reproducing a result.

The project validation helpers have no runtime npm dependencies. Run `npm test` from the repository root to verify deterministic logic using fixtures; this does not contact either provider.
