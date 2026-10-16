# 周末快闪网页 AI 应用：配置与创空间部署

## 架构

浏览器只提供自然语言输入、行程卡展示和版本调整。Node.js 服务端从受限会话中接收请求，调用魔搭 OpenAI 兼容推理 API；模型只能调用代码内声明的站点、车次、地点、周边、路线、天气和校验工具。工具不能访问任意 URL 或执行命令。12306 与高德继续通过仓库内固定版本 MCP 适配器查询，时间与预算检查由 `trip-utils.mjs` 完成。

模型现已实测：`Qwen/Qwen3.5-35B-A3B` 的中文文本生成、OpenAI function tool call 与 `response_format: json_object` 均返回 HTTP 200。该验证确认接口形状可用，不替代创空间中的整条真实行程验收，也不代表魔搭对免费调用量提供 SLA。

## 配置

本机开发可复制 `.env.example` 为 `.env`。创空间应把敏感值配置为 Secret：

| Secret | 说明 |
| --- | --- |
| `MODELSCOPE_INFERENCE_TOKEN` | 服务器端模型推理凭证；本机可回退读取 `MODELSCOPE_API_TOKEN` |
| `AMAP_MAPS_API_KEY` | 云端专用的高德 Web 服务 Key；先核对配额、服务权限和访问限制 |
| `APP_ACCESS_CODE` | 分享给小范围体验者的独立体验码 |

以下普通变量建议明确设置：

```text
LLM_BASE_URL=https://api-inference.modelscope.cn/v1
LLM_MODEL=Qwen/Qwen3.5-35B-A3B
HOST=0.0.0.0
PORT=7860
AI_ONLY_MODE=1
PUBLIC_ORIGIN=https://你的创空间实际应用域名
APP_STATE_DIR=/mnt/workspace/weekend-rush-state
```

`PUBLIC_ORIGIN` 必须是实际浏览器访问 origin（scheme + host，可含端口，不含路径），用于 Host 与 Origin 校验及 Secure Cookie。部署后先从创空间读取最终应用 URL，再填入该变量并重启。不要预先猜域名。

## Docker

仓库 Dockerfile 使用 Node 22，安装锁定依赖，监听 `0.0.0.0:7860`，并通过 `/healthz` 做容器健康检查。创空间 Docker 运行资格需满足魔搭官方 Docker Studio 前置条件；端口要求和可用资源以创空间当前返回为准，参见[魔搭创空间 Docker 部署说明](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/SKILL.md)及[官方 Docker 文档](https://modelscope.cn/docs/studios/docker)。

本机镜像检查：

```sh
docker build -t weekend-rush-web:web-v0.1.0-preview .
docker run --rm -p 7860:7860 --env-file .env \
  -e HOST=0.0.0.0 -e PORT=7860 -e AI_ONLY_MODE=1 \
  -e PUBLIC_ORIGIN=http://127.0.0.1:7860 \
  -e APP_STATE_DIR=/mnt/workspace/weekend-rush-state \
  -v weekend-rush-state:/mnt/workspace weekend-rush-web:web-v0.1.0-preview
```

容器会创建脱敏额度计数文件；不会把提示词、地址、行程详情写入该目录。Windows 本地直接运行时可把 `APP_STATE_DIR` 留空，计数写在被 `.gitignore` 忽略的 `.cache/runtime-state/`。

## 会话与额度保护

- 体验码校验通过后，服务器创建 HttpOnly、SameSite=Lax、线上 Secure 的随机 Cookie 会话。
- 会话闲置 2 小时失效；浏览器刷新可从同一 Cookie 恢复当前行程。服务重启后会话和行程清除。
- `DELETE /api/session` 清除本浏览器会话、行程和关联任务。
- 同时最多 1 个任务运行，最多排队 2 个。
- 每个会话每天 5 次、全站每天 20 次生成或调整；全站每天最多 100 次模型请求。
- 每任务最多 12 次模型请求、60 次真实 MCP 调用、6 分钟运行时间。
- 仅 `day + 生成次数 + 模型次数 + 随机会话摘要计数` 写入 `/mnt/workspace`。目录无法读取或写入时关闭真实生成，不绕过限额。
- Docker 模式不开放 `/api/stations`、`/api/tickets` 等旧版直接查询接口；固定 HTML 示例和 `/healthz` 仍公开。
- 上游额度或服务不可用时保留上一行程，提示失败；不会切换到付费模型或付费硬件。

## 使用边界

系统不购票、不订房、不做多人或多城计划。日期超出铁路售票窗口时，仍可生成地点与市内活动参考；去返城际交通只以 3 小时时段占位，并明确没有查询车次、发车时间、余票和票价，开售后必须重新查询。天气仅显示来源返回的实际出行日期。当前餐馆只来自真实高德 POI 与周边查询，参考消费不能当成交价；住宿、门票、当日营业与预约仍需确认。餐饮/住宿预算不足不会阻止完整参考行程生成。

初始对话与调整都经模型整理；地点和车次必须能在服务端查询结果中逐项匹配。模型无法匹配真实 ID/车次时，服务端拒绝该方案并保留上一版本。UI 不展示内部推理过程，只显示查询进度、数据来源、查询时间、预算差额和变更原因。

## 当前创空间进度

2026-10-16 已确认模型推理端点、工具调用、JSON 输出成功；魔搭 Docker 硬件只读接口返回一个免费 CPU 选项 `platform/2v-cpu-8g-mem`。目标 Studio `atent2L/weekend-rush-ai` 尚不存在。发布前还需取得创空间最终 URL，并在空间 Secret 中配置云端高德 Key、体验码和模型 Token；本机 Key 不会自动上传。

## 本机真实端到端验收

2026-10-16 使用 `Qwen/Qwen3.5-35B-A3B`、12306 MCP 与本机高德测试 Key，完成杭州 → 上海两天一晚完整生成。模型使用 5 次请求，底层共调用 45 次 MCP 工具；两者均未超过单任务 12 次模型请求、60 次数据调用的上限。真实返回 12306 往返车次、上海虹桥 POI、景点与餐饮地点、公交/步行路线和天气。输出两套完整草案：多覆盖方案安排 3 个游览点、少步行方案安排 2 个；回家时间校验为 21:56，早于 22:00 截止。预算和未知费用仍按估算与待核实状态展示，车票没有购买。

本次还发现模型可能选择无法满足时限的“上海站”。现在会先检查实际车次；不满足往返时间窗时，回退到城市优选高铁枢纽并同步地点检索，再由规则选择最早可行去程、最晚可行返程和最低价有票席别。车站回退、搜索提前结束后的数据补齐、预算与天气边界都有自动回归覆盖。

模型响应在最终地点选择阶段明显较慢。此验证证明本机完整链路成功，不代表创空间冷启动耗时、可用额度或服务稳定性；部署后还需用云端 Key 和体验码再验一次。

官方文档：[ModelScope API-Inference 介绍](https://modelscope.cn/docs/model-service/API-Inference/intro) · [API-Inference 使用限制](https://modelscope.cn/docs/model-service/API-Inference/limits)。可用模型列表与额度会变化，部署当天需要重新检查免费资源和模型实际响应。
