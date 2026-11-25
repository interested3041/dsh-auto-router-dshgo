<div align="center">

# dsh-auto-router-dshgo

**移动端(dshgo)多厂商智能路由 · 一个 API key，自动帮你挑模型**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A50.2.0-1f6feb)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

在 DSH 的模型列表里选 **`bailian-auto`（智能路由 Auto Router）**，
插件就用你的账号（默认百炼，也支持硅基流动 / OpenRouter / 火山方舟 / 智谱等），按问题类型自动挑最合适的模型来回答，不用你手动切来切去。

</div>

---

## 移动端（dshgo）说明

本仓库是桌面版 [`dsh-auto-router`](https://github.com/interested3041/dsh-auto-router) 的**移动端移植**，面向 **dshgo 引擎 ≥ 0.2.2-rc.1**。路由 / 均衡 / 额度 / 多厂商逻辑与桌面版一致，另做了移动端兜底：

- **文件系统降级**：移动端若无可写 fs，生成的图片改为内嵌 data URI 显示，不整轮报错；状态持久化失败时退化为内存态。
- **环境兜底**：`os.homedir()` / `process.env` 在移动端不可用时自动回落，不崩溃。
- **宿主依赖软链**：proot 下插件目录解析不到宿主 `/opt/dsh/node_modules` 里的 `@deepseek-ai/*` 运行时包，安装后跑一次 `scripts/link-host-deps.sh` 即可（见下「移动端（dshgo / proot）安装与自检」）。
- **真机适配**：本移植先在桌面跑通测试；上真机后由 dshgo 自行适配修复剩余平台差异，修复结果回传本仓库迭代。真机记录见安装章节。

桌面用户请直接用 [`dsh-auto-router`](https://github.com/interested3041/dsh-auto-router)；本仓库仅供 dshgo / 移动端。

### 0.7.2 学生 300 元券保护（2026-11-25）

- **新增 `allowCouponIneligibleModels`，默认 `false`**：阿里云百炼端点上，学生认证 300 元券不能抵扣的模型族默认不进候选池，避免 Omni/语音/图像等调用直接扣现金、把余额扣成负数导致停机。
- 默认排除 Omni 全模态、语音、OCR/翻译/角色/研究、向量排序、万相/Happy/图像和云市场三方模型；普通对话模型不受影响。
- 只作用于百炼端点；硅基流动、OpenRouter 等其它厂商不套用这份排除表。
- 面板「模型池与限额」新增中文开关，默认不勾选；需要这些能力时由用户自己打开，费用按现金结算。

### 0.6.0 缓存、路由与原地更新（2026-11-24）

- **不再重装更新**：插件面板「更新到 vX」会下载 GitHub Release，校验版本后用 detached 脚本执行「停宿主 → 替换 lib → 重启」；`node_modules`、账号、`state.json`/`prefs.json` 全部保留。页面若没自动回来，在 DSH 里点一次「重启引擎」即可。
- **不再依赖 PowerShell**：手机/proot 没有 `pwsh`，旧版检查更新永远不会成功；现在用 Node `fetch` 查 GitHub API，并明确显示网络错误。
- **缓存可见**：浮窗「上次决策」显示「输入 X / 输出 Y / 缓存 Z%」，日志每条记录也显示输入与缓存 token；同会话固定同一模型，避免换模型导致缓存归零。
- **可用模型池 + 成本护栏**：决策模型只看到当前可用、未冷却、未超限、未连续失败且落在本轮价格带内的模型（简单 3 / 普通 4 / 复杂 8 / 深度 12 ¥/百万 token）；坏模型停用 6 小时，不再每轮重试。
- **回退链**：`INVALID_REQUEST` 在未输出前可切换，配置的 fallback 永远追加在最后；会话粘性加成本/能力护栏，复杂任务可升级、简单任务可降级。
- **任务分类以规则为准**：决策模型只负责选模型，不再把数学比较标成代码；浮窗过滤标题/摘要/工具续写等后台调用。

### 0.5.0 界面与账号（2026-11-24）

- 连接/账号统一显示「**显示名: provider id**」（如 `PackyCode: cc-switch-packy-code`）；`CC_SWITCH_*` 这类凭据引用不再出现在下拉和连接卡。
- 插件面板与聊天浮窗共用同一账号状态：任一处切换，另一处立刻同步，不会各选一个账号。
- 浮窗的排序/刷新点了就有反馈（成功提示或失败原因），刷新时显示「刷新中…」。
- 浮窗顶部新增「上次决策」：任务 → 决策模型 → 执行模型，附来源、策略、尝试次数、决策/回答 token、成功失败与判断理由，另有近 8 次迷你趋势。
- 删除「继承旧 key 台账」：各 key 独立记账，不跨 key 合并。
- 窄屏（宽度小于 720）默认收起为「智能路由」小胶囊，点开看完整卡片。

## 这个插件是干什么的

你有一个 API key（百炼、硅基流动、OpenRouter、火山方舟、智谱……任选），里面能访问很多模型：写作的、写代码的、推理的、画图的、语音的……
平时你得自己猜「这个问题该用哪个模型」，很麻烦，还容易盯着一个贵的模型一直用。

装上这个插件后，DSH 的模型列表里会多出一个 **`bailian-auto`**。选它之后，你正常提问就行：

- 插件先让一个「决策模型」快速判断这是什么任务（写作 / 代码 / 推理 / 翻译 / 看图 / 闲聊）；
- 然后自动转交给**你账号里**最适合的那个模型去回答；
- 难题自动开大推理强度，简单问题关掉推理，省钱省时；
- 某个模型额度用完 / 报错 / 限流，自动悄悄换下一个，你不用管；
- 同一类问题会在几个差不多好的模型之间轮流用，不会盯着一个最强的薅；用量相近时优先用更强的那个。

**全程只用你这一个 API key 下的模型，不会跳到别的 key、别的账号。**

## 适配范围（重要）

- **现在适配**：任何「一个 API key 下能访问多个模型」的 OpenAI 兼容平台——阿里云百炼（默认）、硅基流动、OpenRouter、火山方舟、智谱开放平台、Moonshot、DeepSeek 官方，以及其它通用 OpenAI 兼容网关。**不绑定百炼**。
- **自动识别**：插件按你填的接口地址自动认出是哪家平台（也可在面板「厂商预设」里手动指定），并套用该平台正确的思考参数写法。
- **不会凭空造模型**：插件只认你账号 `GET /models` 真实返回的模型。账号里没有的（比如 gpt）不会出现，也不会被路由到。

## 支持的平台

| 平台 | 默认接口地址 | 凭据环境变量 | 思考参数写法 |
| --- | --- | --- | --- |
| 阿里云百炼（默认） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `BAILIAN_API_KEY` / `DASHSCOPE_API_KEY` / `ALIYUN_API_KEY` | `enable_thinking` + `thinking_budget` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `SILICONFLOW_API_KEY` | `enable_thinking` |
| OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | `reasoning_effort` |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_API_KEY` / `VOLCENGINE_API_KEY` | `reasoning_effort` |
| 智谱开放平台 | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEY` / `BIGMODEL_API_KEY` | `enable_thinking` |
| Moonshot | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` | 不下发思考参数 |
| DeepSeek 官方 | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` | `reasoning_effort` |
| 通用 OpenAI 兼容 | 你自己的网关地址 | 你配置的那个 | `reasoning_effort` |

换平台只需改接口地址 + 对应 key（或在面板选厂商预设），其余路由 / 均衡 / 额度 / 自检逻辑完全通用。

## 使用前提

> **⚠️ Base URL 必须和 API Key 是同一计费方案配套的，否则会 401；各地域、各业务空间的 Key 不互通。**

阿里云百炼的 OpenAI 兼容端点有四类，按你的 Key 类型选对的那一个：

| 域名 | 适用的 Key |
|---|---|
| `https://dashscope.aliyuncs.com/compatible-mode/v1` | 跨业务空间的**共享域名** Key |
| `https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1` | **仅限**该业务空间自己的 Key |
| `trial.{region}.maas.aliyuncs.com` | 试用空间 Key |
| Token Plan / Coding Plan 专属域名 | 仅限交互式工具，**不适用于**本插件的普通对话路由 |

本插件会扫描 profile 里所有指向阿里云（`aliyuncs.com`）的 OpenAI 兼容接入，**自动沿用**第一个能解析出凭据的那个端点 + Key，你不需要重复填。它不绑定任何特定包名，也不依赖 `llm-pi-ai` 之类的外部插件。

本机当前用的是**业务空间专属域名** `ws-0ha4etpemr33xny3.cn-beijing.maas.aliyuncs.com`，
所以 `BAILIAN_API_KEY` 必须是**这个业务空间**的 Key；如果填成跨空间的共享 Key 或 dashscope Key，会 401。

凭据查找顺序：接入自带的凭据引用 → `BAILIAN_API_KEY` → `DASHSCOPE_API_KEY` → `ALIYUN_API_KEY`
（DSH 凭据服务优先，其次启动环境变量）。

## 视觉能力怎么判定

面板「视觉」列是三态：

- **✓ / ✗**：来自内置目录或自定义模型池里的显式 `vision` 声明，属于“已核实”；
- **—**：目录里没有这个模型（多为账号 `/models` 同步来的新 id），只能按 id 关键词
  （`vl` / `vision` / `qvq` / `omni` / `ocr`）推断，标为“未核实”；
- 运行时学习：图片请求成功记为确认可用；模型明确拒绝图片则记 veto，不再当视觉模型推荐。

## 功能一览（大白话）

| 功能 | 说明 |
|---|---|
| **自动挑模型** | 决策模型（默认 `deepseek-v4.1-flash` 系列）判断任务类型，转交账号里最合适的模型；判断失败就用回退模型或规则排序，不会卡住对话 |
| **推理强度自适应** | 难题开大、简单题关掉，按复杂度自动调（off/low/medium/high/max），也可手动锁定 |
| **额度用完自动换** | 429 / 额度耗尽 / 网络错误，在还没开始输出前悄悄换下一个模型；已经开始输出后失败则直接报错，不重复输出 |
| **负载均衡** | 同类问题在几个差不多好的模型间按近期用量轮流用；用量相近时优先用更强的那个，不会一直薅一个旗舰 |
| **画图** | 「画一张…」自动走图像生成接口，图片存到工作区 `.dsh-media/` 并回传链接 |
| **学生券保护** | 默认不让学生 300 元券不能抵扣的全模态/语音/图像/向量/三方模型进池；需要时可在面板打开，费用现金结算 |
| **视频提示** | 账号没有视频模型时，直接告诉你没有 + 给替代方案，不白烧 token 去写脚本；「视频脚本 / 分镜 / 封面 / 剪辑」这类要文稿或图的请求不会被误拦 |
| **会话不跳模型** | 同一轮对话尽量固定一个模型，避免上下文缓存失效、工具调用格式漂移；长对话每 N 轮或上下文快满时重选 |
| **换账号零配置** | 换个百炼账号，模型池和冷却自动重置；配置的模型在新账号不存在就自动替代并提示 |
| **选 API 账号** | 面板顶部「当前 API 账号」下拉一键切换；可在插件里直接添加/保存/删除多厂商账号（端点 + API Key 或凭据引用），不用先去 DSH 设置里配 |
| **面板** | 插件页能看模型池、冷却状态、最近 50 条路由记录，能改配置、刷新模型、管理并切换 API 账号 |
| **运行时依赖由宿主提供** | 插件自身不带 `node_modules`，运行时用宿主自带的 `@deepseek-ai/dsh-llm` / `dsh-home-paths` / `schemastery`；桌面宿主天然可解析，移动端 proot 需补一次软链 |

## 学生认证 300 元券（重要）

如果你用的是阿里云「云工开物」学生认证 300 元抵扣金，先看这一节：

- **券没丢，也不是所有模型都能抵**。2026-07-14 之后领取的 300 元券，官方明确有 8 类商品不支持抵扣：三方直供模型、Happy 系列、万相、向量排序、垂类、百聆语音、千问语音、千问全模态。官方页面给的是示例，**最终以账单里的「商品名称」为准**。
- **插件默认不路由这些模型**。`allowCouponIneligibleModels=false` 时，`buildPool` 会按下列前缀把它们挡在候选池外，面板「查看被排除的模型」会标注「学生券不抵扣」：
  - 全模态：`qwen3.5-omni*`、`qwen3.8-omni*`、`qwen3-omni*`、`qwen3-s2s*`
  - 语音：`qwen3-asr*`、`qwen3-tts*`、`qwen-audio*`、`fun-asr*`、`fun-cosyvoice*`、`cosyvoice*`
  - 垂类/OCR/翻译/角色/研究：`qwen-mt*`、`qwen3.5-ocr*`、`qwen-vl-ocr*`、`qwen3.8-livetranslate*`、`qwen3.5-livetranslate*`、`qwen3-livetranslate*`、`qwen-flash-character*`、`qwen-plus-character*`、`qwen-doc-turbo*`、`gui-plus*`、`qwen-deep-research*`、`qwen-deep-search-planning*`、`tongyi-xiaomi-analysis*`
  - 向量/排序：`qwen3.7-text-embedding*`、`qwen3.7-text-rerank*`、`qwen3-vl-embedding*`、`qwen3-vl-rerank*`、`tongyi-embedding-vision*`
  - 图像/视频/万相/Happy：`wan2.7*`、`wan3.0*`、`happyhorse*`、`qwen-image*`、`z-image*`
  - 云市场三方：`vanchin/*`、`siliconflow/*`、`MiniMax/*`、`kimi/*`、`ZHIPU/*`、`stepfun/*`、`unisound/*`、`antdigital/*`、`Xing/*`、`xiaomi/*`、`cmaas-*`
- **想用这些模型怎么办**：面板「模型池与限额」勾选「允许使用『学生 300 元券不抵扣』的模型（默认关闭）」，或把 `allowCouponIneligibleModels` 设为 `true`。打开后插件不再替你挡，产生的费用按现金结算。
- **只对百炼生效**：硅基流动、OpenRouter、火山方舟等其它端点不会套用这份排除表。
- **券是代金券，不是现金余额**：后付费会冻结当月消费，现金余额不足时，即使券里还有钱也可能停机；已经欠费停机的账户，券不能直接补欠费，需要先充值结清。
- 官方规则：[账单查询与费用管理](https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management)、[云工开物 300 元券说明](https://help.aliyun.com/zh/model-studio/introduction-to-yungongkaiwu)、[欠费处理](https://help.aliyun.com/zh/user-center/timely-handling-of-arrears)。

> 如果券是 **2026-07-14 之前**领取的，排除规则可能不同，请先按账单「商品名称」核对，不要直接照这份清单停用。插件默认仍按保护策略排除，需要时再打开开关。

## 安装

```sh
# 本地目录（开发/自用，link 方式）
dsh plugin --profile web add link:/path/to/dsh-auto-router-dshgo

# GitHub 仓库
dsh plugin --profile web add github:interested3041/dsh-auto-router-dshgo

# 本地已 clone 的目录
dsh plugin --profile web add /path/to/dsh-auto-router-dshgo
```

安装后**重启** `dsh web` / Desktop（宿主插件的新模块版本需要重启加载）。

### 移动端（dshgo / proot）安装与自检

手机 DSH App 的引擎跑在 proot 里，宿主运行时包在 `/opt/dsh/node_modules`，
而插件目录 `/root/.dsh/plugins/<name>` 向上查找时够不到那里。只装不补链，启动日志会是：

```text
dsh: warning: 1 entry did not activate
auto-router-dshgo (dsh-auto-router-dshgo): failed to import: Error [ERR_MODULE_NOT_FOUND]:
Cannot find package '@deepseek-ai/dsh-llm' imported from /root/.dsh/plugins/dsh-auto-router-dshgo/lib/adapter.js
```

完整安装（在 proot 的 bash 里执行，走 git 拉取而不是推包）：

```sh
git clone https://github.com/interested3041/dsh-auto-router-dshgo /root/.dsh/plugins/dsh-auto-router-dshgo
dsh plugin --profile web add /root/.dsh/plugins/dsh-auto-router-dshgo
sh /root/.dsh/plugins/dsh-auto-router-dshgo/scripts/link-host-deps.sh
```

然后在 App 里 **停引擎 → 起引擎**（或重开 App）。验证两点：

- 模型选择面板出现 **智能路由 Auto Router**；
- 新一次启动日志（`$DSH_HOME/dsh-app/diagnostics.md`）不再出现 `entry did not activate`。

真机记录（2026-11-23，DSH App 1.0.16 / dsh 0.2.2-rc.1 / proot Ubuntu 24.04 arm64）：
未补链时启动报 `ERR_MODULE_NOT_FOUND` 且 `1 entry did not activate`；补
`dsh-llm`、`dsh-home-paths`、`schemastery` 三条软链后导入链复测 `adapter OK / index OK`，
重启后新一次启动无告警，模型列表正常出现「智能路由 Auto Router」并可直接选中。

## 配置

三种方式等价：插件页面板、profile 的 `cordis.patch.yml`、或凭据服务/环境变量。

| 字段 | 默认 | 说明 |
|---|---|---|
| `decisionModel` | `deepseek-v4.1-flash-1017` | 决策模型；**不在当前账号时自动替代** |
| `fallbackModel` | `deepseek-v4.1-flash-1017` | 决策失败时的回退执行模型 |
| `decisionTimeoutMs` | `12000` | 决策超时，超时即回退 |
| `maxAttempts` | `4` | 单请求最多尝试的模型数 |
| `taskRoutes` | 内置表 | 各任务类型的**首选**模型（其后的由打分决定） |
| `models` | `[]` | 自定义执行模型池（JSON），可覆盖视觉/上下文/标签 |
| `excludeModels` | `[]` | 排除规则，支持 `前缀*` 通配 |
| `allowCouponIneligibleModels` | `false` | 是否允许「学生 300 元券不抵扣」模型进池；默认关闭，仅百炼端点生效 |
| `balanceStrategy` | `balanced` | `balanced` 按 token 轮转；`quality` 始终用最优 |
| `balanceWindow` | `6` | 参与轮转的候选个数 |
| `balanceBand` | `0` | 分数保护带（0=关闭），避免旗舰与低价小模型混排 |
| `balanceWindowHours` | `24` | 用量统计窗口，超期自然衰减 |
| `thinkingEffort` | `auto` | 思考档位策略：auto / off / low / medium / high / max |
| `enableDecision` | `true` | 关闭后仅按启发式规则路由 |
| `quotaCooldownMinutes` | `30` | 额度耗尽/不可调用模型的冷却时长 |
| `rateLimitCooldownSeconds` | `120` | 限流/网络类失败的冷却时长 |
| `enableMediaRouting` | `true` | 图像生成意图是否走 `/images/generations` |
| `stickySession` | `true` | 同一会话固定首选模型；关闭后每请求按均衡轮转 |
| `sessionTurnLimit` | `8` | 同会话每 N 轮允许重选一次，避免长会话钉死单个模型 |
| `autoSyncPool` / `poolSyncIntervalHours` | `true` / `24` | 模型池自动同步 |
| `accounts` | `[]` | 已保存的百炼账号列表（名称 + 端点 + API Key 或凭据引用），面板可增删改 |
| `activeAccountId` | `''` | 当前账号 id；空 = 用默认接口/自动沿用 profile 连接 |

### 改决策模型 / 候选池

- **只换决策模型**：面板「决策模型」填任意你账号里存在的 id，保存即生效；
- **只调某类任务的候选**：面板「各任务类型候选模型」按优先级填 id，逗号或换行分隔；
- **整体换池**：在「自定义模型池」粘贴 JSON 数组，`[{ "id": "...", "vision": true, "tags": ["code"] }]`；
- **想让某类任务只用固定模型**：`balanceStrategy=quality` + 该类候选只填一个 id。

### 选 / 换 API 账号

- **顶部下拉**：面板顶部「当前 API 账号」可在「默认接口/自动沿用」「已保存账号」「profile 已有连接」之间一键切换，切换后自动重新同步模型池并重置冷却。
- **插件内多账号管理**：在「API 账号管理」里添加账号（名称 + 接口地址 + 凭据）。凭据二选一：直接填 **API Key**，或只填**凭据引用**（环境变量名，走 DSH 凭据服务/环境）。可编辑、启用、删除；编辑时 Key 留空即保留原 Key。
- **profile 连接**：面板「阿里云连接」仍列出 profile 里所有阿里云兼容接入，点「切到这个账号」即切换。
- 旧账号的模型池与冷却会自动清空；配置的模型在新账号不存在时自动替代并提示，配置值本身不被改写。

> **Key 安全**：直接填的 API Key 以 `secret` 形式存于本机 profile 配置，面板只打码显示末四位（`••••xxxx`），**绝不写入 `state.json`、日志或跨 RPC 传输**。想让 Key 完全不落 profile，就用「凭据引用」型账号或环境变量。

## 面板里能做什么（0.3.0 现状）

- 顶部「当前 API 账号」下拉，一键切换账号；
- 添加 / 编辑 / 启用 / 删除多厂商账号（端点 + API Key 或凭据引用）；
- 看账号识别到多少模型、多少能对话、多少视觉模型；
- 看每个模型的**本地冷却状态（启发式，非真实配额）**、连败、调用次数；
- 改决策模型 / 回退模型 / 冷却时长 / 均衡策略 / 推理档位；
- 按任务类型设候选模型优先级；
- 一键刷新模型列表、解除冷却；
- 看最近 50 条路由决策（任务类型、决策来源、尝试链、原因）。

> 说明：面板里的「冷却状态」是插件根据失败/限流做的**本地启发式判断**，不是百炼后台的真实剩余配额。

## 路线图

**已落地**（0.4.0 / 0.5.0）：分类展开面板、每模型额度上限、一键完整性自检、多厂商适配（见上表）。
**本仓库即 dshgo 移动端移植**：v0.1.0 已发布（engine ≥0.2.2-rc.1），路由逻辑与桌面版 [`dsh-auto-router`](https://github.com/interested3041/dsh-auto-router) 一致，真机适配进行中。

**后续计划**（尚未实现）：

- **真机适配回传**：移动端剩余平台差异由 dshgo 自行适配修复后回传本仓库迭代；
- **更多厂商预设**：按社区反馈补充端点识别与思考参数写法；
- **路由可解释性**：面板展示每次决策的候选打分与降级原因明细。

## 测试

```sh
npm install
npm run build      # tsc（宿主 + 客户端两套 tsconfig）+ 校验 client.js 为经典脚本（不含 ESM 语法）
npm test           # 冒烟 + 分类/排序 + 路由 + 换账号 + 多账号管理 + 多厂商预设 + 均衡/档位/媒体/视频闸门/会话粘 + 额度上限 + 学生券默认关闭/opt-in
npm run test:live  # 用本机真实凭据与端点跑通完整链路（会计费，按需）
```

`lib/client.js` 必须能被浏览器当作**经典脚本**求值（它通过 `window.__ModuleLoader__.load({...})` 自注册），构建后会强制校验，防止 `SyntaxError: Unexpected token 'export'` 再次发生。

## 目录结构

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：注册适配器、RPC 服务、池同步定时器 |
| `src/adapter.ts` | `bailian-auto` 虚拟模型（元数据 + 思考档位阶梯） |
| `src/router.ts` | 路由核心：决策、额度冷却、静默回退、媒体分发、会话粘模型、能力学习 |
| `src/decision.ts` | 输入分析、复杂度与档位映射、候选构建、视频闸门、决策 Prompt |
| `src/pool.ts` | 模型池构建、按任务排序、token 均衡轮转、媒体池 |
| `src/classify.ts` | 由模型 id 推断端点类别 / 视觉 / 规模 / 任务亲和度 |
| `src/wire.ts` | harness ⇄ OpenAI 兼容 wire 的消息与流转换 |
| `src/http.ts` | chat-completions（流式）、`/models`、`/images/generations`、错误分类 |
| `src/media.ts` | 图像生成落盘与 Markdown 回传 |
| `src/store.ts` | 本地状态：池、冷却、用量、会话绑定、能力学习 |
| `src/connection.ts` | 从 profile 已有接入发现并沿用连接 |
| `src/service.ts` / `src/remote.ts` | RPC 服务与通用 codec 透传 |
| `src/vendors.ts` | 多厂商预设、端点自动识别、思考参数风格 |
| `src/home.ts` | DSH home 路径解析（移动端兜底） |
| `src/client.ts` | Web 配置 + 状态面板（经典脚本 bundle） |

## 已知限制

- **语音合成/识别不可用**：本网关 HTTP 面未提供（`/audio/speech` 404、chat 带 `voice` 返回 400、omni 忽略 audio），这些端点只登记不路由；
- `wan2.7-image` 等模型可能返回 `403 AccessDenied.Unpurchased`，会按额度类失败冷却并换下一个；
- `/models` 里存在但实际不可调用的模型会以 `UNKNOWN_MODEL` 进入 30 分钟冷却；
- 图像输入依赖模型真实支持；不支持时会记录并停止把它作为视觉模型推荐；
- **视频生成未接入**：账号若没有视频模型，插件只做能力说明与替代方案（零 token），不调用任何视频接口；视频接口多为异步任务 + 轮询，计划在后续版本接入；
- **状态文件只保证单进程**：`state.json` 采用 tmp + rename 原子写，没有跨进程锁；同一 `DSH_HOME` 下同时跑多个 DSH 进程时，后写者会覆盖先写者的冷却/会话绑定。多进程场景请分开 `DSH_HOME`。

## License

[MIT](LICENSE) © 2026 interested3041
