import assert from 'node:assert/strict'
import { rotationEligible, taskEligible } from '../lib/decision.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`ok    ${name}`)
}

const traits = (over = {}) => ({ family: 'qwen', version: 0, snapshot: false, quality: 48, tasks: ['general'], ...over })
const pool = {
  byId: new Map([
    ['qwen-flash', { traits: traits() }],
    ['qwen-mt-flash', { traits: traits({ version: 0, tasks: ['general', 'translation'], quality: 85 }) }],
    ['qwen3-coder-flash', { traits: traits({ version: 3, tasks: ['general', 'code'] }) }],
  ]),
}
const none = new Set()

ok('general rejects translation specialist even though it carries a general tag', () => {
  assert.equal(taskEligible('qwen-mt-flash', 'general', pool, none), false)
})
ok('general rejects code specialist even though it carries a general tag', () => {
  assert.equal(taskEligible('qwen3-coder-flash', 'general', pool, none), false)
})
ok('general accepts a plain lightweight qwen flash', () => {
  assert.equal(taskEligible('qwen-flash', 'general', pool, none), true)
})
ok('translation task still accepts qwen-mt-flash', () => {
  assert.equal(taskEligible('qwen-mt-flash', 'translation', pool, none), true)
})
ok('pinned specialist bypasses task-affinity filter', () => {
  assert.equal(taskEligible('qwen-mt-flash', 'general', pool, new Set(['qwen-mt-flash'])), true)
})

ok('rotation accepts current lightweight aliases', () => {
  assert.equal(rotationEligible('qwen-flash', traits()), true)
  assert.equal(rotationEligible('qwen3.5-flash', traits({ version: 3.5 })), true)
})
ok('rotation skips dated qwen-turbo snapshots that return AUTH', () => {
  assert.equal(rotationEligible('qwen-turbo-2024-11-01', traits({ version: 2024, snapshot: true })), false)
})
ok('rotation skips cmaas and third-party prefixed ids', () => {
  assert.equal(rotationEligible('cmaas-qwen3.8-flash', traits({ version: 3.8 })), false)
  assert.equal(rotationEligible('antdigital/Ling-3.1-flash', traits({ family: 'ling', version: 3.1 })), false)
})
ok('rotation skips legacy qwen1.5/2.x', () => {
  assert.equal(rotationEligible('qwen1.5-7b-chat', traits({ version: 1.5 })), false)
  assert.equal(rotationEligible('qwen2.5-1.5b-instruct', traits({ version: 2.5 })), false)
})
ok('pinned id bypasses rotation allowlist', () => {
  assert.equal(rotationEligible('cmaas-qwen3.8-flash', traits({ version: 3.8 }), true), true)
})

console.log(`\n${passed}/${passed} checks passed`)
