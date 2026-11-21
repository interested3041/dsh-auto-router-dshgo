// Multi-vendor presets + thinking-style mapping assertions.
import assert from 'node:assert/strict'
import { VENDORS, GENERIC_VENDOR, detectVendor, vendorPreset, isRoutableEndpoint, thinkingStyleFor, vendorKeyRefs } from '../lib/vendors.js'
import { thinkingDispatch, effortToReasoningEffort, supportsThinkingSwitch } from '../lib/classify.js'

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok   ', name) }

ok('detect bailian shared', () => assert.equal(detectVendor('https://dashscope.aliyuncs.com/compatible-mode/v1').id, 'bailian'))
ok('detect bailian workspace', () => assert.equal(detectVendor('https://ws-x.cn-beijing.maas.aliyuncs.com/compatible-mode/v1').id, 'bailian'))
ok('detect siliconflow', () => assert.equal(detectVendor('https://api.siliconflow.cn/v1').id, 'siliconflow'))
ok('detect openrouter', () => assert.equal(detectVendor('https://openrouter.ai/api/v1').id, 'openrouter'))
ok('detect volcengine', () => assert.equal(detectVendor('https://ark.cn-beijing.volces.com/api/v3').id, 'volcengine'))
ok('detect zhipu', () => assert.equal(detectVendor('https://open.bigmodel.cn/api/paas/v4').id, 'zhipu'))
ok('detect moonshot', () => assert.equal(detectVendor('https://api.moonshot.cn/v1').id, 'moonshot'))
ok('detect deepseek', () => assert.equal(detectVendor('https://api.deepseek.com/v1').id, 'deepseek'))
ok('detect generic fallback', () => assert.equal(detectVendor('https://my-gateway.example/v1').id, 'generic'))
ok('explicit vendor overrides url', () => assert.equal(vendorPreset('openrouter', 'https://dashscope.aliyuncs.com/compatible-mode/v1').id, 'openrouter'))
ok('auto vendor uses url', () => assert.equal(vendorPreset('auto', 'https://api.siliconflow.cn/v1').id, 'siliconflow'))

ok('routable known vendor', () => assert.equal(isRoutableEndpoint('https://api.siliconflow.cn/v1'), true))
ok('routable generic /v1', () => assert.equal(isRoutableEndpoint('https://gw.example/v1'), true))
ok('routable generic /api/v3', () => assert.equal(isRoutableEndpoint('https://gw.example/api/v3'), true))
ok('not routable bare host', () => assert.equal(isRoutableEndpoint('https://gw.example'), false))

ok('bailian thinking style', () => assert.equal(thinkingStyleFor('auto', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), 'enable_thinking'))
ok('openrouter thinking style', () => assert.equal(thinkingStyleFor('auto', 'https://openrouter.ai/api/v1'), 'reasoning_effort'))
ok('deepseek thinking style', () => assert.equal(thinkingStyleFor('auto', 'https://api.deepseek.com/v1'), 'reasoning_effort'))
ok('moonshot thinking style none', () => assert.equal(thinkingStyleFor('auto', 'https://api.moonshot.cn/v1'), 'none'))
ok('generic thinking style', () => assert.equal(thinkingStyleFor('generic', 'https://gw.example/v1'), 'reasoning_effort'))

ok('vendor key refs siliconflow', () => assert.deepEqual(vendorKeyRefs('auto', 'https://api.siliconflow.cn/v1'), ['SILICONFLOW_API_KEY']))
ok('vendor key refs bailian', () => assert.deepEqual(vendorKeyRefs('auto', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), ['BAILIAN_API_KEY', 'DASHSCOPE_API_KEY', 'ALIYUN_API_KEY']))

ok('effort max clamps to high', () => assert.equal(effortToReasoningEffort('max'), 'high'))
ok('effort off undefined', () => assert.equal(effortToReasoningEffort('off'), undefined))
ok('effort medium', () => assert.equal(effortToReasoningEffort('medium'), 'medium'))
ok('bailian qwen enable_thinking', () => assert.deepEqual(thinkingDispatch('qwen3.8-max', 'high'), { enableThinking: true, thinkingBudget: 32768 }))
ok('bailian off false', () => assert.deepEqual(thinkingDispatch('qwen3.8-max', 'off'), { enableThinking: false }))
ok('no-switch family undefined', () => assert.equal(thinkingDispatch('deepseek-v4-pro', 'high'), undefined))
ok('supportsThinkingSwitch qwen', () => assert.equal(supportsThinkingSwitch('qwen3-vl-plus'), true))
ok('preset count', () => assert.equal(VENDORS.length, 7))
ok('generic fallback object', () => assert.equal(GENERIC_VENDOR.id, 'generic'))

console.log(`\n${n}/${n} checks passed`)