# 安装Weekend Rush Skill

本Skill用于支持Skills以及本机脚本/MCP调用的AI客户端。语言理解与规划使用客户端的大模型，不需要额外模型API。它不是打开HTML就能独立对话的网页应用。

## 1. 下载与放置

下载 [skill-v0.4.0-preview](https://github.com/991231island-wq/weekend-rush/releases/tag/skill-v0.4.0-preview) 中的 `weekend-rush-skill-v0.4.0-preview.zip`。发布页同时提供 `SHA256SUMS.txt`，用于核对下载文件是否一致。

解压后，将含有 `SKILL.md` 的 **weekend-rush** 文件夹放到客户端Skills目录。Codex默认目录为：

- Windows：`%USERPROFILE%\.codex\skills\weekend-rush`
- macOS/Linux：`~/.codex/skills/weekend-rush`

其他客户端以其安装说明为准。不要多套一层目录；最终应能在上述目录直接找到 `SKILL.md`。已有版本先自行备份，更新时使用同一版本的脚本、参考文件和依赖锁文件。

## 2. 安装本机查询依赖

安装Node.js 22或更新版本，在Skill目录执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/query-tools.mjs --input assets/check-install.json
```

自检应返回 `ok: true`、当天日期、地图Key是否已配置，以及四类未接通信息来源的状态。地图Key显示未配置不会阻止自检，但不能执行真实地图查询。自检不查询车票、地图或模型，不消耗这些服务的调用额度。

校验、版本比较与HTML渲染本身不需要npm运行依赖；MCP查询桥需要锁文件列出的依赖。无需全局安装MCP或额外的Inspector工具。已经原生配置12306/高德MCP的宿主也可以直接调用它们。

## 3. 配置高德Key

使用自己申请的高德Web服务类型Key，将本机环境变量名设置为 `AMAP_MAPS_API_KEY`。建议通过系统环境变量界面或客户端的私有凭证设置填写，避免将真实值写入项目、聊天或命令记录。Windows查询桥支持读取当前用户环境变量；macOS/Linux需让启动客户端或脚本的进程继承该变量。

配置后重新启动需要读取环境变量的客户端，再运行自检。Key仅在本机后端进程内使用，不进入行程卡。每个开源使用者自行提供Key及其服务额度；本项目不提供共享Key。

## 4. 开始规划

在AI客户端新会话中调用 `$weekend-rush`：

> 这周末从杭州去上海，两天一夜，一个人，看看建筑、吃点当地小吃，周日晚上九点前到家。预算还没定，先给我个方案和费用估计。

有明确预算、最早出门时间、住处附近地标或返程站到家的估时，也可以一并说明。用户不必提供车次号、坐标、酒店或景点清单；助手先推荐。

没有自动发现Skill时，请明确让客户端读取安装目录的 `SKILL.md`。不同客户端的自动发现机制可能不同；不能把文件放置成功等同于所有客户端均已自动启用。

后续可以说“第二天轻松一点，少走路”“这个餐馆换一家，适合一个人吃的”“我晚了一小时出发，帮我重新安排”。预算不足时仍会给完整参考计划并说明缺口；已买车票、已订住宿和已完成事项不会被默默修改。数据不齐时不会声称全部约束满足。

## 5. 核对结果

查看来源与查询时间、预算估算和未知项、返程接驳、场馆预约及酒店房价/房态。车票有票不代表已购票；预约要求不代表已有预约；高德消费参考不是最终结算价。用户自行购票预订。

`information-sources` 当前应显示餐饮价格、酒店报价、门票与日期化营业四个接入口均未连接，不是缺失安装步骤。现有功能和示例仍可运行，缺少这些报价时显式保留估算与未知。未来接入方式见 [数据契约](../skills/weekend-rush/references/data-contract.md)。
