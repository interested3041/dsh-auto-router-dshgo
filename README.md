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
- **真机适配**：本移植先在桌面跑通测试；上真机后由 dshgo 自行适配修复剩余平台差异，修复结果回传本仓库迭代。

桌面用户请直接用 [`dsh-auto-router`](https://github.com/interested3041/dsh-auto-router)；本仓库仅供 dshgo / 移动端。

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

## 功能一览（大白话）

| 功能 | 说明 |
|---|---|
| **自动挑模型** | 决策模型（默认 `deepseek-v4.1-flash` 系列）判断任务类型，转交账号里最合适的模型；判断失败就用回退模型或规则排序，不会卡住对话 |
| **推理强度自适应** | 难题开大、简单题关掉，按复杂度自动调（off/low/medium/high/max），也可手动锁定 |
| **额度用完自动换** | 429 / 额度耗尽 / 网络错误，在还没开始输出前悄悄换下一个模型；已经开始输出后失败则直接报错，不重复输出 |
| **负载均衡** | 同类问题在几个差不多好的模型间按近期用量轮流用；用量相近时优先用更强的那个，不会一直薅一个旗舰 |
| **画图** | 「画一张…」自动走图像生成接口，图片存到工作区 `.dsh-media/` 并回传链接 |
| **视频提示** | 账号没有视频模型时，直接告诉你没有 + 给替代方案，不白烧 token 去写脚本；「视频脚本 / 分镜 / 封面 / 剪辑」这类要文稿或图的请求不会被误拦 |
| **会话不跳模型** | 同一轮对话尽量固定一个模型，避免上下文缓存失效、工具调用格式漂移；长对话每 N 轮或上下文快满时重选 |
| **换账号零配置** | 换个百炼账号，模型池和冷却自动重置；配置的模型在新账号不存在就自动替代并提示 |
| **选 API 账号** | 面板顶部「当前 API 账号」下拉一键切换；可在插件里直接添加/保存/删除多个百炼账号（端点 + API Key 或凭据引用），不用先去 DSH 设置里配 |
| **面板** | 插件页能看模型池、冷却状态、最近 50 条路由记录，能改配置、刷新模型、管理并切换 API 账号 |
| **零运行时依赖** | 不需要 `node_modules` 就能安装运行，不会因缺包激活失败 |

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
- 添加 / 编辑 / 启用 / 删除多个百炼账号（端点 + API Key 或凭据引用）；
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
npm test           # 冒烟 + 分类/排序 + 路由 + 换账号 + 多账号管理 + 多厂商预设 + 均衡/档位/媒体/视频闸门/会话粘 + 额度上限，共 341 条断言
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
