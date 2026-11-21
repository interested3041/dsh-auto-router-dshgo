/**
 * Saved-account behaviour: the panel can store several Bailian accounts
 * (endpoint + raw key or credential ref), pick one from a dropdown, and switch
 * without leaking the previous account's pool/cooldowns. Raw keys must never
 * cross the RPC wire or land in state.json.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router, resolveApiKey, scopeOf } = await lib('router.js')
const { resolveOptions } = await lib('config.js')
const { RouterStore } = await lib('store.js')
const { createService } = await lib('service.js')

const results = []
const check = (ok, message) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`)
}

const baseConfig = () => ({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKeyEnv: 'BAILIAN_API_KEY',
  enableDecision: true,
  decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 5000,
  decisionInputMaxChars: 4000,
  fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4,
  quotaCooldownMinutes: 30,
  rateLimitCooldownSeconds: 120,
  streamIdleTimeoutMs: 10000,
  autoSyncPool: false,
  poolSyncIntervalHours: 0,
  adoptProfileProvider: false,
  maxCandidatesForDecision: 10,
  includeSpecialEndpoints: false,
  excludeModels: [],
  taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: [], general: [] },
  models: [],
  accounts: [],
  activeAccountId: '',
})

// ---- 1. resolveOptions parses accounts & active selection ----
{
  const config = baseConfig()
  config.accounts = [
    { id: 'a1', name: '主账号', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/', apiKey: 'sk-primary-123456' },
    { id: 'a2', name: '备用', baseURL: 'https://other.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'BAILIAN_KEY_2' },
    { id: 'a1', name: '重复id', baseURL: 'https://dup.example/v1' },          // duplicate id dropped
    { id: 'bad', name: '坏地址', baseURL: 'not-a-url' },                       // invalid URL dropped
    { id: 'ftp', name: '非HTTP', baseURL: 'ftp://x.example/v1' },             // non-HTTP dropped
    { id: '', name: '缺id', baseURL: 'https://x.example/v1' },                // missing id dropped
  ]
  config.activeAccountId = 'a2'
  const options = resolveOptions(config)
  check(options.accounts.length === 2, `只保留合法且去重的账号: ${options.accounts.length}`)
  check(options.accounts[0].baseURL === 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'baseURL 去掉尾部斜杠')
  check(options.accounts[0].apiKey === 'sk-primary-123456', 'raw key 被保留(宿主内部)')
  check(options.accounts[1].apiKeyEnv === 'BAILIAN_KEY_2', '凭据引用型账号保留 ref')
  check(options.activeAccountId === 'a2', 'activeAccountId 命中已保存账号')
  config.activeAccountId = 'ghost'
  check(resolveOptions(config).activeAccountId === '', 'activeAccountId 不存在时回落为空')
}

// ---- 2. resolveApiKey prefers a direct account key ----
{
  const ctx = { get: () => undefined }
  const direct = await resolveApiKey(ctx, ['BAILIAN_API_KEY'], 'sk-direct-abcdef')
  check(direct.key === 'sk-direct-abcdef' && direct.ref === 'account', '直连 key 优先,ref=account')
  let threw = false
  try { await resolveApiKey(ctx, [], 'sk-bad\u0001key') } catch (_e) { threw = true }
  check(threw, '直连 key 含控制字符被拒绝')
  process.env.BAILIAN_API_KEY = 'sk-env-fallback'
  const viaEnv = await resolveApiKey(ctx, ['BAILIAN_API_KEY'], undefined)
  check(viaEnv.key === 'sk-env-fallback' && viaEnv.ref === 'BAILIAN_API_KEY', '无直连 key 时回退凭据引用/环境')
  delete process.env.BAILIAN_API_KEY
}

// ---- 3. active account overrides endpoint, key and scope ----
{
  const tmp = await mkdtemp(join(tmpdir(), 'bar-accounts-'))
  const store = RouterStore.create(join(tmp, 'state.json'))
  await store.ready
  const config = baseConfig()
  config.accounts = [
    { id: 'a1', name: '主账号', baseURL: 'https://one.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-one-11112222' },
    { id: 'a2', name: '备用', baseURL: 'https://two.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-two-33334444' },
  ]
  config.activeAccountId = 'a1'
  const router = new Router({ logger: { debug() {}, info() {}, warn() {}, error() {} }, get: () => undefined }, config, store)
  const snap1 = router.capture()
  check(snap1.options.baseURL === 'https://one.aliyuncs.com/compatible-mode/v1', 'active 账号覆盖接口地址')
  check(snap1.options.apiKeyDirect === 'sk-one-11112222', 'active 账号的直连 key 进入选项')
  check(scopeOf(snap1.options) === 'https://one.aliyuncs.com/compatible-mode/v1|acct:a1', '作用域含账号标识')
  store.markFailure('glm-5.2', 'QUOTA', 30 * 60_000)
  check(store.inCooldown('glm-5.2'), '账号a1 的冷却已记录')
  config.activeAccountId = 'a2'
  const snap2 = router.capture()
  check(snap2.options.baseURL === 'https://two.aliyuncs.com/compatible-mode/v1', '切到账号a2 接口随之改变')
  check(snap2.options.apiKeyDirect === 'sk-two-33334444', '切到账号a2 直连 key 随之改变')
  check(!store.inCooldown('glm-5.2'), '切换账号后旧冷却被清除')
  check(store.state.scope === 'https://two.aliyuncs.com/compatible-mode/v1|acct:a2', '作用域已切到账号a2')
  config.activeAccountId = ''
  const snap3 = router.capture()
  check(snap3.options.apiKeyDirect === undefined, '回到默认时不带直连 key')
  check(snap3.options.baseURL === config.baseURL, '回到默认接口地址')
  await store.dispose()
  await rm(tmp, { recursive: true, force: true })
}

// ---- 4. service: masked views + upsert/remove/activate ----
{
  const tmp = await mkdtemp(join(tmpdir(), 'bar-acct-svc-'))
  const store = RouterStore.create(join(tmp, 'state.json'))
  await store.ready
  const liveConfig = baseConfig()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    llm: { fileRequestText: () => '[file]' },
    fiber: { entry: { options: { id: 'test-entry' } } },
    effect() {}, on() { return () => {} }, provide() {}, inject() {},
    get(service) {
      if (service === 'configEditor') {
        return {
          configuration: () => [],
          edit: async (_entry, mutate) => {
            const next = mutate({ ...liveConfig })
            for (const key of Object.keys(liveConfig)) delete liveConfig[key]
            Object.assign(liveConfig, next)
          },
        }
      }
      return undefined
    },
  }
  const router = new Router(ctx, liveConfig, store)
  const service = createService(ctx, router, store)

  const added = await service.upsertAccount({ id: 'a1', name: '主账号', baseURL: 'https://one.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-secret-99998888' })
  const view = added.config.accounts.find(a => a.id === 'a1')
  check(view?.hasKey === true, '保存后 hasKey=true')
  check(view?.keyHint === '••••8888', `key 打码只显示末四位: ${view?.keyHint}`)
  check(!JSON.stringify(added).includes('sk-secret-99998888'), 'RPC 状态视图不含明文 key')
  check(liveConfig.accounts[0].apiKey === 'sk-secret-99998888', '明文 key 仅存于本机配置')

  // Editing without re-entering the key keeps the stored secret.
  const edited = await service.upsertAccount({ id: 'a1', name: '改名', baseURL: 'https://one.aliyuncs.com/compatible-mode/v1' })
  check(edited.config.accounts.find(a => a.id === 'a1')?.hasKey === true, '编辑未填 key 时保留原 key')
  check(liveConfig.accounts[0].name === '改名', '编辑更新了名称')

  // Activate, then remove the active account clears the selection.
  const activated = await service.activateAccount('a1')
  check(activated.state.config.activeAccountId === 'a1', '启用账号写入 activeAccountId')
  let threw = false
  try { await service.activateAccount('ghost') } catch (_e) { threw = true }
  check(threw, '启用不存在的账号被拒绝')
  const removed = await service.removeAccount('a1')
  check(removed.config.accounts.length === 0, '删除账号生效')
  check(removed.config.activeAccountId === '', '删除使用中的账号会清空选择')

  // Credential-ref account stores no raw key.
  const refAcct = await service.upsertAccount({ id: 'r1', name: '引用型', baseURL: 'https://one.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'BAILIAN_KEY_2' })
  const refView = refAcct.config.accounts.find(a => a.id === 'r1')
  check(refView?.hasKey === false && refView?.apiKeyEnv === 'BAILIAN_KEY_2', '凭据引用型账号不存 raw key')

  await store.dispose()
  await rm(tmp, { recursive: true, force: true })
}

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
