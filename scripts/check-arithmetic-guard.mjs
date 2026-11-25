/** Guard: the arithmetic shortcut must not swallow genuine reasoning tasks. */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { analyzeRequest, costCapFor } = await import(pathToFileURL(join(root, 'lib', 'decision.js')).href)

const expectTrivial = [
  '3.11 和 3.9 哪个大？',
  '9 和 2.7 哪个大',
  '1.0 和 0.999 谁大',
  '比较 1/3 和 0.333 哪个更大',
]
const expectCode = [
  '用 JavaScript 写一个数组去重函数',
  '用 Python 写函数比较两个版本号字符串的大小',
  '实现一个快速排序',
]
const expectWriting = [
  '帮我写一段产品发布会的开场白',
  '写一段致辞',
]
const expectNotTrivial = [
  '请证明 3.11 和 3.9 的大小关系的严格数学证明',
  '分析 3.11 和 3.9 这两个版本号在语义化版本规则下哪个更大,并说明理由',
  '用 Python 写函数比较两个版本号字符串的大小',
  '为什么 0.1+0.2 不等于 0.3?请从浮点数表示原理推导',
  '计算并解释:若 x 和 y 满足 x+1 和 2y 哪个大,讨论所有情况',
]

const run = text => analyzeRequest({
  provider: 'bailian-auto', model: 'bailian-auto',
  messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text }], source: { kind: 'user' } }],
}, 4000)

let bad = 0
console.log('=== 应判 trivial ===')
for (const text of expectTrivial) {
  const a = run(text)
  const ok = a.complexityLevel === 'trivial'
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(a.complexity).padStart(3)} ${a.complexityLevel.padEnd(7)} cap=${costCapFor(a)}  ${text}`)
}
console.log('\n=== 不应判 trivial(真实推理/代码) ===')
for (const text of expectNotTrivial) {
  const a = run(text)
  const ok = a.complexityLevel !== 'trivial'
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(a.complexity).padStart(3)} ${a.complexityLevel.padEnd(7)} task=${a.heuristicTask.padEnd(9)} cap=${costCapFor(a)}  ${text}`)
}
console.log('\n=== 应判 code ===')
for (const text of expectCode) {
  const a = run(text)
  const ok = a.heuristicTask === 'code'
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} task=${a.heuristicTask.padEnd(9)} cc=${a.complexity} ${a.complexityLevel.padEnd(7)} ${text}`)
}
console.log('\n=== 应判 writing ===')
for (const text of expectWriting) {
  const a = run(text)
  const ok = a.heuristicTask === 'writing'
  if (!ok) bad += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} task=${a.heuristicTask.padEnd(9)} cc=${a.complexity} ${a.complexityLevel.padEnd(7)} ${text}`)
}
console.log(`\n${bad === 0 ? 'PASS' : bad + ' unexpected'}`)
process.exit(bad === 0 ? 0 : 1)