# 周末特种兵行程助手

当前优先完善 **AI 客户端内的懒人规划 Skill**：[安装与验收](docs/Skill-懒人版验收.md)。本机手动查询网页的状态见 [真实版本进度](docs/真实版本验收.md)，离线原型见 [第一轮验收指南](docs/验收指南.md)。

用户只需说“这周末杭州去上海，看看建筑、吃点好的，别太累”，Skill 使用宿主大模型提取意向、主动推荐并查询吃住玩与交通，生成详细行程。随后说“第二天轻松点”“换掉这个景点”即可提出调整；不要求用户先提供景点列表或车次号。

可查看 [完整公开地点案例](docs/examples/intent-trip-v1.html) 与 [第二天调整版](docs/examples/intent-trip-v2.html)。它们是开发验收快照，餐宿金额为预留，未知信息已标出，不能当作当前实际订单或最新查询。

面向 AI 应用产品经理作品集的周末旅行规划项目：支持 AI 客户端使用的 Skill、本机真实 MCP 数据与规则规划页面，以及无需 Key 的离线演示。真实网页当前使用确定性规则生成草案，没有调用大模型。

## 现在包含什么

- `skills/weekend-rush/`：可分发 Skill、确定性数据适配与行程校验脚本、接口说明。
- Skill 包含可独立安装的查询桥、行程卡渲染、快捷调整提示和自己的依赖锁文件；校验和渲染本身不需 npm 依赖。
- `live/`、`server/`：本机真实数据版，查询精确区间的直达往返车次、手动确认地图 POI、查询路线、比较两套节奏、重新计算并保留最近三轮结果。
- `demo/`：离线交互原型，包含两种行程取舍以及延误/体力变化后的版本比较。示例车次、POI、时间和价格均为演示数据。
- `tests/`：Node.js 内置测试，覆盖精确站点、查询乘车日、跨夜/跨年、座席状态、地点歧义、预算、重叠和已完成事项保护。
- `docs/`：产品范围、流程及评测方法。
- `执行进度-v0.3.md`：各阶段状态和实际验证边界。
- `docs/acceptance-scenarios.md`：完整 T01–T12 对话验收清单。
- `configs/mcp-servers.example.json`：本地 MCP 配置形状。用个人私有配置替换占位 Key，不要把有效 Key 提交到仓库。

## 本地运行

需要 Node.js 22 或更高版本。真实版本先安装固定依赖，并在本机配置高德 Web 服务 Key（环境变量 `AMAP_MAPS_API_KEY`）。Windows 也可读取当前用户环境变量。每位使用者使用自己的 Key。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

访问 http://127.0.0.1:4173 。依次读取真实车站、查询并选择往返有票席别，选择目的地火车站主体、住宿参考点和 1–6 个游览地点，再生成方案。时间与金额均可修改；修改后需重新生成。

无 Key 演示可运行 `npm run demo`（请先停止占用同端口的真实服务器），或在真实服务器访问 `/demo`。离线演示不读取 Key、不查询外部接口。验收命令为 `npm test` 与 `npm run check:secrets`；测试使用脱敏样例，本机 HTTP 测试需允许回环连接。

## 使用真实数据

上面的 `npm start` 已通过本机后端启动两个 MCP，无需再手动配置 AI 客户端。以下是独立安装 Skill 的方式，适用于需要在 AI 客户端对话规划和重排的场景。

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

真实网页仅支持一个目的城市、相邻两天一晚、同一对车站的 G/D 直达往返；住处接驳时间由用户估算。日期限当天起 15 天内。规划采用贪心规则，不保证全局最优，也尚未支持途中以当前位置、已完成活动重排。上一轮结果仅保留在当前页面内存，刷新即清除。

Key 仅用于后端 MCP 子进程，不返回浏览器，不写入项目；本机接口限制回环地址与同源 JSON 请求。车次缓存 60 秒、地点搜索 2 分钟、详情/路线 5 分钟、天气 10 分钟，页面展示原查询时间。高德调用按至少 1.1 秒间隔串行执行，额度不足时明确报错。

GitHub 首发及魔搭打包仍属于后续发布阶段；本地已配置目标远程地址，尚未确认远程仓库或推送发布。当前为本地预览版，尚未完成外部用户试用。

## 许可

本项目原创内容使用 MIT 许可。12306 MCP 与高德 MCP 为外部依赖，分别遵循各自的上游许可与服务条款。
详细来源见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
