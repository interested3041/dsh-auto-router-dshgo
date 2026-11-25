import assert from 'node:assert/strict'
import { buildPool, matchesExcludePattern } from '../lib/pool.js'
import { sanitizePatch } from '../lib/service.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`ok    ${name}`)
}

const options = (over = {}) => ({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  vendor: 'auto',
  includeSpecialEndpoints: false,
  excludeModels: [],
  allowCouponIneligibleModels: false,
  ...over,
})

const synced = [
  { id: 'qwen3.8-max-0902' },
  { id: 'qwen3.8-omni-flash' },
  { id: 'qwen3.5-omni-plus' },
  { id: 'qwen-image-3.0' },
  { id: 'MiniMax/speech-2.8' },
  { id: 'qwen-mt-plus' },
  { id: 'qwen3.5-ocr' },
  { id: 'deepseek-v4.1-flash-1017' },
]

ok('default OFF keeps coupon-ineligible Omni out of the chat pool', () => {
  const pool = buildPool({ synced, user: [], options: options() })
  assert.equal(pool.byId.has('qwen3.8-omni-flash'), false)
  assert.equal(pool.byId.has('qwen3.5-omni-plus'), false)
  assert.equal(pool.byId.has('deepseek-v4.1-flash-1017'), true)
})

ok('default OFF records a student-voucher reason in the excluded list', () => {
  const pool = buildPool({ synced, user: [], options: options() })
  const omni = pool.excluded.find(entry => entry.id === 'qwen3.8-omni-flash')
  assert.ok(omni)
  assert.match(omni.reason, /学生券不抵扣/)
})

ok('default OFF also keeps image/voice/vertical/tri-party media out', () => {
  const pool = buildPool({ synced, user: [], options: options() })
  assert.equal(pool.excluded.some(entry => entry.id === 'qwen-image-3.0'), true)
  assert.equal(pool.media.image.some(entry => entry.id === 'qwen-image-3.0'), false)
  assert.equal(pool.excluded.some(entry => entry.id === 'MiniMax/speech-2.8'), true)
  assert.equal(pool.excluded.some(entry => entry.id === 'qwen-mt-plus'), true)
  assert.equal(pool.excluded.some(entry => entry.id === 'qwen3.5-ocr'), true)
})

ok('explicit opt-in restores the coupon-ineligible families', () => {
  const pool = buildPool({ synced, user: [], options: options({ allowCouponIneligibleModels: true }) })
  assert.equal(pool.byId.has('qwen3.8-omni-flash'), true)
  assert.equal(pool.byId.has('qwen3.5-omni-plus'), true)
  assert.equal(pool.media.image.some(entry => entry.id === 'qwen-image-3.0'), true)
})

ok('guard is scoped to Bailian endpoints, not other vendors', () => {
  const pool = buildPool({
    synced,
    user: [],
    options: options({ baseURL: 'https://api.siliconflow.cn/v1' }),
  })
  assert.equal(pool.byId.has('qwen3.8-omni-flash'), true)
})

ok('user excludeModels still wins and keeps its own reason', () => {
  const pool = buildPool({
    synced,
    user: [],
    options: options({ excludeModels: ['deepseek*'] }),
  })
  const deepseek = pool.excluded.find(entry => entry.id === 'deepseek-v4.1-flash-1017')
  assert.ok(deepseek)
  assert.match(deepseek.reason, /已按配置排除/)
})

ok('pattern matcher supports exact prefix and wildcard forms', () => {
  assert.equal(matchesExcludePattern('qwen3.8-max-0902', 'qwen3.8-max'), true)
  assert.equal(matchesExcludePattern('qwen3.8-omni-flash', 'qwen3.8-omni*'), true)
  assert.equal(matchesExcludePattern('MiniMax/speech-2.8', 'MiniMax/*'), true)
  assert.equal(matchesExcludePattern('qwen3.8-max-0902', 'qwen3.8-omni*'), false)
})

ok('config patch accepts the student coupon toggle and rejects non-booleans', () => {
  assert.equal(sanitizePatch({ allowCouponIneligibleModels: true }).allowCouponIneligibleModels, true)
  assert.equal(sanitizePatch({ allowCouponIneligibleModels: false }).allowCouponIneligibleModels, false)
  assert.throws(() => sanitizePatch({ allowCouponIneligibleModels: 'yes' }), /must be a boolean/)
})

console.log(`\n${passed}/${passed} checks passed`)
