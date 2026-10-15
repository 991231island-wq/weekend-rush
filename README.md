# 周末特种兵行程助手

当前执行状态见 [执行进度](执行进度-v0.3.md)。

面向 AI 应用产品经理作品集的周末旅行规划 Skill。它把交通与地图 MCP 查询、AI 生成方案和确定性约束校验连起来，并提供无需 Key 的离线演示。

## 现在包含什么

- `skills/weekend-rush/`：可分发 Skill、确定性数据适配与行程校验脚本、接口说明。
- `demo/`：离线交互原型，包含两种行程取舍以及延误/体力变化后的版本比较。示例车次、POI、时间和价格均为演示数据。
- `tests/`：Node.js 内置测试，覆盖精确站点、查询乘车日、跨夜/跨年、座席状态、地点歧义、预算、重叠和已完成事项保护。
- `docs/`：产品范围、流程及评测方法。
- `执行进度-v0.3.md`：各阶段状态和实际验证边界。
- `docs/acceptance-scenarios.md`：完整 T01–T12 对话验收清单。
- `configs/mcp-servers.example.json`：本地 MCP 配置形状。用个人私有配置替换占位 Key，不要把有效 Key 提交到仓库。

## 本地运行

需要 Node.js 22 或更高版本，不需要安装项目 npm 依赖。

```sh
npm test
npm run check:secrets
npm run demo
```

浏览器访问终端提示的本地地址。演示不读取环境变量，也不会请求 12306 或高德。

## 使用真实数据

1. 将 `skills/weekend-rush` 文件夹复制到客户端的 Skills 目录；Codex 默认可放在 `%CODEX_HOME%\skills\weekend-rush`，或 `~/.codex/skills/weekend-rush`。
2. 在该客户端添加 `configs/mcp-servers.example.json` 中的本地服务器设置。依赖固定为 `12306-mcp@0.3.10` 和 `@amap/amap-maps-mcp-server@0.0.8`。
3. 为当前用户在本机设置 `AMAP_MAPS_API_KEY`。使用高德 Web 服务类型 Key。每位使用者使用自己的 Key。
4. 根据 Skill 引导需求；查到的车次和 POI 需经脚本归一化和约束检查后才能进入方案。

将 Key 存在 Windows 用户环境变量或客户端的私有凭证配置中；启动前确认变量名为 `AMAP_MAPS_API_KEY`。然后即可运行：

```powershell
npx -y @amap/amap-maps-mcp-server@0.0.8
```

不要把 Key 写到这个项目、提交记录、截图或公开日志。12306 返回余票和高德路线/天气都可能变化，出行前请在原服务复核。

## 确定性 helper

输入字段见 `skills/weekend-rush/references/data-contract.md`。

```sh
node skills/weekend-rush/scripts/trip-utils.mjs normalize-tickets --input tickets.json
node skills/weekend-rush/scripts/trip-utils.mjs resolve-poi --input place.json
node skills/weekend-rush/scripts/trip-utils.mjs validate-plan --input plan.json
node skills/weekend-rush/scripts/trip-utils.mjs compare-plans --input revision.json
```

## 状态和限制

高德官方 MCP 的地点、天气、步行和公交端点已做本机样例调用；验证发现“外滩”等名称会返回多个候选，产品流程要求确认 POI 后再规划。12306 MCP 曾返回相邻车站记录，且把列车始发日期呈现为日期字段；适配器按精确电报码筛选并以用户查询日构造上车时间。当前网络样例及语义限制见 `接口验证记录.md`。

开放时间、预约结果、住宿与餐饮金额并非由当前两个 MCP 完整提供，行程会将其标为需核实或估算。首版不购票、不预订，也不保证预算在信息不全时成立。

GitHub 首发及魔搭打包属于后续发布阶段；本地项目尚未连接远程仓库。

## 许可

本项目原创内容使用 MIT 许可。12306 MCP 与高德 MCP 为外部依赖，分别遵循各自的上游许可与服务条款。
详细来源见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
