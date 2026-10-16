# 周末特种兵行程助手 · Weekend Rush

**说出大致意向，获得完整两日行程，再用一句话按喜好调整。**

本次发布对象是 **AI 客户端内使用的 Skill：v0.4.0-preview**。预览版尚未完成外部用户试用；网页AI应用将单独开发部署。

- [Skill预览版与安装包](https://github.com/991231island-wq/weekend-rush/releases/tag/skill-v0.4.0-preview)
- [魔搭 Skills 中文发布页](https://modelscope.cn/skills/atent2L/weekend-rush)（同一 `v0.4.0-preview`，自动同步关闭）
- [完整安装说明](docs/install-skill.md) · [版本说明](docs/releases/skill-v0.4.0-preview.md)
- [广州白云区—武汉完整参考行程](docs/examples/广州白云-武汉-2026-10-17至18-完整参考行程.md)
- [Skill源码](skills/weekend-rush) · [功能验收与边界](docs/Skill-懒人版验收.md)

需要Node.js 22+，以及能加载Skill并执行本机脚本或调用MCP的AI客户端。解压后，将含 `SKILL.md` 的 `weekend-rush` 文件夹放入客户端Skills目录；Codex通常使用 `~/.codex/skills/weekend-rush`。在该目录执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/query-tools.mjs --input assets/check-install.json
```

自检只显示本机配置和预留信息来源状态，不调用地图、铁路或模型。真实地图查询需每位使用者自行在本机配置高德Web服务Key（`AMAP_MAPS_API_KEY`）；模型使用宿主客户端，不需额外模型API。然后在新会话中使用 `$weekend-rush` 并描述意向。不同客户端的发现机制以其说明为准，未自动发现时可明确让其读取安装目录的 `SKILL.md`。

## 用户能做什么

| 功能 | 实际行为 |
| --- | --- |
| 完整行程推荐 | 已确定目的城市、两天一晚、单人公共交通；主动安排吃住玩、交通和休息 |
| 真实查询 | G/D直达车票、高德地点详情、公交/步行指引、附近候选和预报日期内天气 |
| 一句话调整 | 替换地点、少走路、晚出发等，重新查询受影响路线并保护已完成事项 |
| 费用与时间提醒 | 区分查得价格、估算和未知；预算不足仍给完整参考行程，原预算不变 |
| 本地行程卡 | 展示时间线、来源与待确认项；调整按钮复制请求，实际修改在AI客户端发生 |

## 项目与开发说明

本机手动查询网页的历史状态见 [真实版本进度](docs/真实版本验收.md)，离线原型见 [第一轮验收指南](docs/验收指南.md)。

用户只需说“这周末杭州去上海，看看建筑、吃点好的，别太累”，Skill 使用宿主大模型提取意向、主动推荐并查询吃住玩与交通，生成详细行程。随后说“第二天轻松点”“换掉这个景点”即可提出调整；不要求用户先提供景点列表或车次号。

可查看 [完整公开地点案例](docs/examples/intent-trip-v1.html) 与 [第二天调整版](docs/examples/intent-trip-v2.html)。它们是开发验收快照，餐宿金额为预留，未知信息已标出，不能当作当前实际订单或最新查询。

面向 AI 应用产品经理作品集的周末旅行规划项目：支持 AI 客户端使用的 Skill、本机真实 MCP 数据与规则规划页面，以及无需 Key 的离线演示。真实网页当前使用确定性规则生成草案，没有调用大模型。

## 现在包含什么

- `skills/weekend-rush/`：可分发 Skill、确定性数据适配与行程校验脚本、接口说明。
- Skill 包含可独立安装的查询桥、行程卡渲染、快捷调整提示和自己的依赖锁文件；校验和渲染本身不需 npm 依赖。
- `live/`、`server/`：本机真实数据版，查询精确区间的直达往返车次、手动确认地图 POI、查询并展开有序公共交通/步行指引、按已确认地点搜索有限的周边候选、展示地点扩展字段与日期匹配天气，再比较两套节奏并重算。
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

开放时间、预约结果、住宿与餐饮金额并非由当前两个 MCP 完整提供，行程会将其标为需核实或估算。查询桥已为餐饮价格、酒店报价、门票和日期化营业信息保留独立接入口；`information-sources` 可查看接通状态，默认四类均未接通，`information-lookup` 不会伪造返回。适配契约见 [数据契约](skills/weekend-rush/references/data-contract.md)，后续可接入的官方与授权渠道见[吃住门票营业信息来源调研](docs/吃住门票营业信息来源调研-2026-10-16.md)。首版不购票、不预订，也不保证预算在信息不全时成立。

真实网页仅支持一个目的城市、相邻两天一晚、同一对车站的 G/D 直达往返；住处接驳时间由用户估算。日期限当天起 15 天内。规划采用贪心规则，不保证全局最优，也尚未支持途中以当前位置、已完成活动重排。上一轮结果仅保留在当前页面内存，刷新即清除。

Key 仅用于后端 MCP 子进程，不返回浏览器，不写入项目；本机接口限制回环地址与同源 JSON 请求。车次缓存 60 秒、地点搜索 2 分钟、详情/路线 5 分钟、天气 10 分钟，页面展示原查询时间。高德调用按至少 1.1 秒间隔串行执行，额度不足时明确报错。

本次GitHub版本只分发Skill；仓库中的网页源码仍属于开发/联调部分，没有发布独立在线AI网页。魔搭部署与外部用户试用属于后续阶段；历史进度文档保留当时状态，以本README与本次版本说明为准。

执行 `node scripts/package-skill.mjs` 可生成仅含Skill的发布包及SHA256校验文件（Windows使用内置Compress-Archive，其他系统需zip命令）。打包采用文件白名单，不含网页、node_modules、个人配置和查询日志。

## 许可

本项目原创内容使用 MIT 许可。12306 MCP 与高德 MCP 为外部依赖，分别遵循各自的上游许可与服务条款。
详细来源见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
