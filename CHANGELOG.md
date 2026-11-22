# Changelog

## [0.2.2] - 2026-11-22

### 修复

- 对齐桌面 0.6.2:部署/自更新只按**宿主 exe 路径**停与重启本次宿主,不再误杀同时运行的另一版本 DSH。

## [0.2.1] - 2026-11-22

### 新增

- 对齐桌面 0.6.1:配置页「插件更新」卡显示 当前→最新 + 检查更新。
  移动端(dshgo)不做桌面式停/重启,「更新」按钮提示走手机端安装流程。

## [0.2.0] - 2026-11-22

### 新增（对齐桌面 0.6.0 大版本）

- 配置页分页：账号与连接 / 路由与策略 / 模型池与限额 / 日志与自检。
- 四种候选排序策略：智能(默认)/价格/能力/速度/薅免费额度(按桶轮转,桶大小与容差可调,全满自动进下一周期)。
- 每模型行内限额(次数/token),到上限自动路由下一个。
- 每-key token 台账 + 同接口旧 key 台账一键继承;状态文件升级 v2(自动备份 .v1.bak)。
- 用户指定模型:`/model <id>` / `@model:<id>` 前缀或面板 pin,一次性生效;日志标来源/策略/回答 token。
- 账号下拉合并去重(过滤插件自身、按接口+凭据去重);决策/回退改下拉;清空候选=价格优先。
- 测试基线 430 断言。

## [0.1.4] - 2026-11-22

### 修复

- 视觉列改三态(✓ 声明支持 / ✗ 声明不支持 / — 未核实),悬停说明;
- `deepseek-v4.1-flash`(别名)修正为支持视觉,上下文窗口对齐 1048576;
- README 增加「视觉能力怎么判定」章节。

## [0.1.3] - 2026-11-22

### 变更

- 显示名去百炼化:locale title「智能路由 Auto Router」、多厂商描述、虚拟模型显示名、
  面板账号标题「多厂商账号」、README 措辞;虚拟模型 id 保留 `bailian-auto`。

## [0.1.2] - 2026-11-22

### 修复(紧急)

- **配置面板不显示**:客户端 `PACKAGE` 与 `plugins.bundle.config` 插槽 key 仍写旧包名,
  现统一为 `dsh-auto-router-dshgo`,账号管理/厂商预设/额度/自检面板恢复渲染。
- **详情文档过期**:重写 `docs/DETAIL.md` 为多厂商 + 移动端兜底现状,写明面板入口。
- 面板标题与提示中性化。

## [0.1.1] - 2026-11-22

### 修复(紧急)

- **组件激活失败 / ERR_MODULE_NOT_FOUND**:`cordis.patch.yml` 的 `name` 仍写旧包名 `dsh-bailian-auto-router`,
  导致 DSH import 旧包失败、组件不激活。现 `name` 改为 `dsh-auto-router-dshgo`,row `id` 改为 `auto-router-dshgo`。
- README 目录结构表同步桌面版修正(移除 rpc/typert,补 remote/vendors/home)。

## [0.1.0] - 2026-11-21

### 新增

- **移动端(dshgo)首个移植版**:基于桌面版 `dsh-auto-router` 0.5.0 移植,兼容 dshgo 引擎 `>=0.2.2-rc.1 <0.3.0-0`。
  多厂商路由 / 决策模型 / 额度感知 / 冷却回退 / 负载均衡 / 分类面板 / 每模型上限 / 一键自检 全部保留。
- **移动端兜底**:
  - `media.ts` 写盘失败(移动端无可写 fs)时改为内嵌 data URI 返回图片,不整轮报错;
  - `home.ts` `os.homedir()` 不可用时回落 cwd 相对路径,`process.env` 缺失时回落空映射;
  - `router.ts` 凭据环境变量读取加 `typeof process` 保护;
  - `store.ts` / `service.ts` 原有 fs try/catch 兜底保留(持久化失败退化内存态)。
- 独立仓库 `dsh-auto-router-dshgo` 维护;真机平台差异由 dshgo 自行适配修复后回传迭代。

### 说明

- 本版本先在桌面跑通全量 341 条断言;真机行为以 dshgo 实际运行为准。

## [0.5.0] - 2026-11-21

### 新增

- **多厂商适配(去百炼绑定)**:新增 `src/vendors.ts` 厂商预设模块,支持「单 key 多模型」的 OpenAI 兼容平台:
  阿里云百炼(默认)、硅基流动、OpenRouter、火山方舟、智谱开放平台、Moonshot、DeepSeek 官方、通用 OpenAI 兼容网关。
  按接口地址自动识别厂商(`vendor: auto`),也可在面板「厂商预设」手动指定。
- **按厂商分派思考参数**:百炼/硅基/智谱走 `enable_thinking`(+`thinking_budget`);
  OpenRouter/火山/DeepSeek/通用走 `reasoning_effort`(`max` 钳到 `high`,`off` 不下发);Moonshot 不下发思考参数。
  缺省 `vendor` 回落 `auto`(按 baseURL 识别),旧配置/旧快照不受影响。
- **连接发现通用化**:`connection.ts` 不再只认阿里云端点,任何已知厂商或形如 `/v1`、`/api/v3` 的通用网关都可被自动沿用。
- **凭据 refs 扩到全厂商**:配置解析按厂商前置对应 key 环境变量,全局回退列表覆盖 11 个常见变量。
- **面板「厂商预设」下拉** + 配置/ RPC 透传 `vendor` 字段。
- 新增 `test/vendors.test.mjs`(31 断言);全量测试 341 条。

### 变更

- **插件改名 `dsh-bailian-auto-router` → `dsh-auto-router`**(package / 仓库 / 安装目录 / junction 同步)。
  虚拟模型 id 保留 `bailian-auto` 以兼容已选模型;显示名改中性「智能路由 Auto Router」。
- README 重写为多厂商定位:支持平台表、适配范围、路线图更新(多厂商/分类面板/额度/自检标记为已落地)。

## [0.4.0] - 2026-11-19

### 修复(紧急)

- **思考参数:百炼走 `enable_thinking` + `thinking_budget`,不再发 `reasoning_effort`**。
  之前 `effortFor()` 是未实现占位,把 `low/medium/high/max` 原样当 OpenAI `reasoning_effort` 发出——
  `max` 不是合法值(400),qwen3/qwq/qvq/deepseek-think 等的开关其实是 `enable_thinking(bool)`。
  `max` 全期都不再产生 `reasoning_effort:"max"`。
- **按模型族映射思考参数**:qwen/qwq/qvq/glm(4.5+)/kimi/step/deepseek-think 用 `enable_thinking`;
  `high/max` 追加 `thinking_budget`(32768/65536);`off` 发 `enable_thinking:false`;
  无思考族(deepseek-v4-pro 等)什么都不发。profile/会话级 `reasoningEffort` 覆盖值也走同一映射。
- **放宽拒参重试**:400/INVALID_REQUEST 且 message 含 `thinking|effort|budget|reason|参数|思考|推理` 任一 →
  去掉全部思考参数重试同一模型,仍失败才换模型,不再整轮报错。

### 新增

- **分类展开面板**:模型池按「图像 / 语音 / 推理 / 代码 / 写作 / 翻译 / 通用」分类折叠,点开分类才展开,
  上百模型不平铺;分类依据 `classify.ts` 的端点类别 + 任务亲和,图像/语音类并入对应媒体端点。
- **每模型额度上限**:单模型可设 `maxCalls`(调用次数) 与 `maxTokens`(token) 双计量,
  达到任一上限即停用并自动路由下一个;不设=自动均衡。面板可 JSON 编辑、看每模型用量、一键重置。
  本地累计用量存于 `state.json`,换账号自动清空。
- **一键完整性自检**:新 RPC `selfCheck`,逐项检测 API Key 解析 / 端点连通(GET /models) / 模型池非空 /
  client.js 经典脚本 / state.json 可写 / 思考参数映射,返回 ✓/✗ + 修复引导。面板「一键检测完整性」按钮触发。
- 新增 `scripts/selfcheck.mjs`,用本机真实凭据跑一遍自检(6 项)。

### 变更

- README「使用前提」按官方 base-url 文档纠正:列清 dashscope 共享 / 业务空间专属 / 试用 / Token-Plan 四类域名
  及适用 key,加粗警告「Base URL 必须与同一计费方案的 API Key 配套,否则 401;各地域 key 不互通」,
  注明本机业务空间域名 `ws-0ha4etpemr33xny3.cn-beijing.maas.aliyuncs.com`;「自动沿用」改为与
  `connection.ts` 实际行为一致(扫 profile 里阿里云兼容接入并沿用,不写死 llm-pi-ai)。

### 测试

- 冒烟 30(端点 9→11)、分类 83(思考映射 18)、路由 76(思考 wire 16 + 额度上限 8)、
  多账号 30、均衡/档位 67、换账号 24,总计 **310 条断言**;`tsc` 双配置 0 错、
  postbuild 确认 client.js 经典脚本。


本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.1] - 2026-11-19

### 修复

- **面板「RPC 通道不可用」**:客户端贡献的描述符缺少 `namespace` / `service` / `id`,
  Typert 网关把命名空间装成了 `remote.undefined`,面板永远取不到 `remote.bailianRouter`。
  现在九个端点都带完整标识,并与宿主方法的参数名逐一对齐。
- **宿主改用源码标记(SRC)暴露 Remote**:删除手写的 `./typert` 清单(它缺少生成器要求的
  `input` / `invoke`,`validateTypertManifest` 会拒绝),改为在服务实例上绑定 `typertRemote`、
  在原型上写方法标记,网关据此按方法参数名推导线格式。包内仍然零第三方运行时依赖。
- **失败时不再挡住内置配置表单**:远端命名空间未挂载时不再注册 `plugins.bundle.config` 键
  (否则会用一张错误卡片替换掉 DSH 自带的配置表单),并在页脚显示
  「远程通道未挂载 · 改用内置配置表单」。

### 测试

- 冒烟增至 **30 条**:新增 SRC 绑定/标记/参数名断言,以及「客户端端点与宿主参数名一致」的漂移检查。

## [0.3.0] - 2026-11-18

### 新增

- **选 API 账号(多账号管理)**:面板顶部新增「当前 API 账号」下拉,可在默认接口/自动沿用、
  已保存账号、profile 已有连接之间一键切换;切换后自动重新同步模型池并重置冷却。
- **插件内添加/保存/删除百炼账号**:每个账号 = 名称 + 接口地址 + 凭据。凭据二选一:
  直接填 API Key(以 `secret` 角色存于本机 profile 配置),或只填凭据引用(环境变量名,走 DSH 凭据服务/环境)。
  新增 RPC `upsertAccount` / `removeAccount` / `activateAccount`;编辑账号时留空 Key 即保留原 Key。
- 配置项 `accounts`(已保存账号列表)与 `activeAccountId`(当前账号,空=默认/自动沿用)。

### 安全

- **API Key 全程打码**:面板状态视图只返回 `hasKey` 与末四位提示(`••••xxxx`),明文 Key 绝不跨 RPC、
  绝不写入 `state.json` 或日志;明文仅存于本机 profile 配置的 secret 字段。
- 切换账号的作用域含账号标识(`baseURL|acct:<id>`),不同账号的模型池/冷却/会话绑定互不串用。

### 变更

- **README 重写**:去掉架构图与 provider/上层路由术语,改大白话;显式写明适配范围(当前百炼,
  目标任何"一个 key 多模型"的 OpenAI 兼容平台)与路线图(分类展开面板/每模型额度上限/一键完整性自检/多厂商/dshgo)。
- 测试增至 **256 条断言**(新增 `test/accounts.test.mjs` 30 条:配置解析/直连 Key/作用域/打码视图/增删改与启用)。

## [0.2.0] - 2026-11-18

### 新增

- **视频意图能力闸门**:识别"生成/制作/合成……视频/短片/动画"等生成意图;账号无可用视频模型时
  **零 token 短路**回复(能力说明 + 替代方案),路由记录记为 `decisionSource: "notice"`。
  排除词(脚本/文案/分镜/提示词/大纲/封面/海报/缩略图/首帧/演示/PPT/编码/格式/剪辑)优先:
  "生成视频脚本""视频封面图""剪辑这段视频"会降级为对话或图像,不会误短路。
- **会话粘模型路由**:同一 `sessionId` 固定首选模型,避免连续轮换打掉 provider 的 prompt cache 与
  tool-call 格式稳定性;同会话每 N 轮(默认 8,`sessionTurnLimit`)或上下文接近绑定模型窗口时允许重选以保持均衡;
  缺失 `sessionId` 时降级为请求级轮转;绑定 TTL 24h、上限 200 条、换账号清空。

### 修复

- 恢复 `postbuild` 经典脚本校验(`npm run build` 末尾执行),防止 `lib/client.js` 被追加
  `export {}` 导致客户端 `SyntaxError: Unexpected token 'export'`;`prepublishOnly` 改为 build + test。
- 错误记录写入端白名单:路由记录只持久化 `model / ok / code`;同步错误入库前经
  `redactSecrets()` 打码;测试断言 `state.json` 不含 `sk-` / `Bearer` / `apiKey` 明文。

### 变更

- 面板额度状态措辞改为「本地冷却状态(启发式,非真实配额)」,`decisionSource` 在面板中中文化,
  `notice` 显示为「未调用模型(能力闸门)」。
- 视频替代方案文案不再承诺本机 ffmpeg 合成,改为「另行安排(需你确认)」。

## [0.1.0] - 2026-11-18

首个发布版本。

### 新增

- **虚拟模型 `bailian-auto`(百炼智能路由)**:通过 `ctx.llm.registerAdapter` 注册,出现在 DSH 模型选择器。
- **请求前决策**:决策模型(默认 `deepseek-v4.1-flash-1017`)分析模态与任务类型,输出
  `{"selected_model","reasoning"}`;无效输出回落启发式排序。
- **账号模型池**:池成员来自账号自身 `GET /models`(实测 182 个 → 140 个可对话),
  内置目录仅提供元数据;`/models` 之外的 id 不会被虚构。
- **端点能力分类**:TTS / ASR / s2s / realtime / embedding / rerank / 图像 / 视频 / 音乐
  按能力分流,不再无差别丢弃。
- **图像生成路由**:媒体意图 → `POST /images/generations`,落盘到工作区 `.dsh-media/` 并回传 Markdown 链接。
- **负载均衡**:同一任务在排名前 N 的同类模型间按近期 token 消耗轮转,避免固定使用单一旗舰。
- **思考档位自适应**:`auto` 按复杂度在 `off/low/medium/high/max` 间切换,也可手动锁定;
  下游不接受该参数时自动记住并去参重试。
- **额度冷却与静默回退**:429 / 额度耗尽 / 不可调用模型进入冷却并切换;已输出内容后失败则直接报错。
- **能力学习**:带图失败记为"不支持图片",成功记为"支持";换账号时清空。
- **换账号零配置**:按 `baseURL|凭据引用` 记录作用域,切号自动重置池与冷却;配置模型不存在时自动替代。
- **面板**:插件页配置 + 额度状态 + 最近 50 条路由决策;设置 → 模型底部状态卡片。
- **零运行时依赖**:安装为普通目录亦可运行,不需要 `node_modules`。

### 修复

- `lib/client.js` 被 TypeScript 追加 `export {};` 导致浏览器
  `SyntaxError: Unexpected token 'export'`;构建新增后处理并强制校验为经典脚本。
- 负载均衡的记账桶(决策任务)与轮转桶(启发式任务)不一致,导致轮转从不生效。
- 同分比较让冷却中的模型抢回首位,违反冷却语义。