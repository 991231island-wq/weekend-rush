# 周末快闪 · Weekend Rush

把“周末想去武汉转转”这样的意向，变成一份有真实车次、地图地点和市内路线的两日行程。助手先给完整安排，再按“少走路”“晚一小时”“换家餐馆”继续调整。

> 网页 AI 应用已在本机完成真实模型、车票和地图链路验证。魔搭创空间还需配置独立云端高德 Key 与体验码；在线入口部署后会补充。已发布的 AI 客户端 Skill 继续独立维护。

## 体验与发布

- [已发布 Skill：GitHub 预览版](https://github.com/991231island-wq/weekend-rush/releases/tag/skill-v0.4.0-preview)
- [已发布 Skill：魔搭 Skills](https://modelscope.cn/skills/atent2L/weekend-rush)
- [行程示例：杭州 → 上海](docs/examples/intent-trip-v1.html) · [少走路调整版](docs/examples/intent-trip-v2.html)
- [网页应用部署配置说明](docs/ai-app-deployment.md)

网页源码、Skill 和本地真实数据适配器都在本仓库。网页版本号与 Skill 分开，网页目标版本为 `web-v0.1.0-preview`。

## 当前网页能做什么

- 用中文自由描述出发地、目的地、日期、预算和偏好；助手补齐缺少的关键条件，不要求用户先列景点或餐馆。
- 查询 12306 G/D 直达往返车票，并根据用户时间与预算选择车站、车次和有票席别。
- 搜索并核对目的地车站、游览地点、酒店位置参考；在用餐时段搜索附近餐馆并核对实际到店路线。
- 生成多覆盖与少步行两种节奏，确定性校验时间、预算、已知费用、步行及到家时限。预算不足仍保留完整参考计划。
- 通过对话换餐馆、调整出发时间、切换轻松方案；保存版本与变更原因，标记已完成活动，导出 HTML 行程卡。
- 对固定样例公开访问；真实查询需体验码。页面不收集用户自己的模型或高德密钥。

模型只负责理解意向、选择有限的查询工具和从真实结果中提出安排；车票、地点、路线由服务器查询，费用与时间由规则校验。模型不能访问任意网址或执行命令。餐饮、酒店、门票和营业状态没有实时可靠来源时会保留估算或待核实。

## 本机运行

需要 Node.js 22 或更高版本。复制 `.env.example` 为 `.env`，在本机填写：

| 配置 | 用途 |
| --- | --- |
| `APP_ACCESS_CODE` | 本机体验码；不要使用公开或重复密码 |
| `MODELSCOPE_INFERENCE_TOKEN` | 魔搭模型推理 Token；本机也会尝试读取已配置的 Windows 用户变量 `MODELSCOPE_API_TOKEN` |
| `AMAP_MAPS_API_KEY` | 本机高德 Web 服务 Key |
| `LLM_BASE_URL` | 默认 `https://api-inference.modelscope.cn/v1` |
| `LLM_MODEL` | 默认 `Qwen/Qwen3.5-35B-A3B` |

安装并启动：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

打开 http://127.0.0.1:4173 。固定样例无需体验码；新建真实行程需要体验码和已配置的模型/高德凭证。`/manual` 保留原手动查询页供本机排错；创空间 Docker 部署会禁用旧的直接查询接口。

## 魔搭创空间 Docker 配置

仓库包含 `Dockerfile`，监听 `0.0.0.0:7860`。请为创空间配置三个 Secret：

- `APP_ACCESS_CODE`
- `MODELSCOPE_INFERENCE_TOKEN`
- `AMAP_MAPS_API_KEY`（应使用单独的云端 Web 服务 Key，不复用仅供本机测试的 Key）

普通变量设为 `LLM_BASE_URL=https://api-inference.modelscope.cn/v1`、`LLM_MODEL=Qwen/Qwen3.5-35B-A3B`、`AI_ONLY_MODE=1`、`HOST=0.0.0.0`、`PORT=7860`、`APP_STATE_DIR=/mnt/workspace/weekend-rush-state`。创空间建好后，将真实公开应用域名的 origin 填入 `PUBLIC_ORIGIN`。密钥只由创空间作为运行时环境变量注入，不写进 GitHub、浏览器或镜像。

Docker 只使用免费 CPU 规格，不需要 GPU。每日全站最多 20 次规划、每会话 5 次；每次任务最多 12 次模型请求、60 次真实 MCP 工具调用、运行 6 分钟；全站每天最多 100 次模型请求。脱敏额度计数持久化到 `/mnt/workspace`，聊天与行程只留在会话内存中；计数无法持久化时会暂停真实调用。更多部署与额度说明见[配置与部署文档](docs/ai-app-deployment.md)。

## 开发与验证

```sh
npm test
npm run check:secrets
```

测试使用脱敏样例。真实车票与高德信息会变动；“查询成功”不等于车票已购买、商户已营业、酒店有房或门票已预约。出行前请回到原服务确认。

## 目录

- `live/ai.*`：对话式 AI 应用
- `server/ai-runtime.mjs`、`server/intent-agent.mjs`、`server/modelscope-client.mjs`：体验会话、配额、Agent 与魔搭推理
- `server/planner.mjs`：路线查询、时间线生成和确定性校验
- `skills/weekend-rush/`：独立分发的 Skill
- `demo/`：无需密钥的交互示例
- `tests/`：规则、接口、会话和安全测试
- `docs/`：产品边界、数据来源、验收和部署记录

原创代码采用 MIT 许可；12306 MCP 和高德 MCP 遵循各自上游许可与服务条款，见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
