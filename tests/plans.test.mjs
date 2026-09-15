import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/plans.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
})
const { PLANS, getPlan, remainingDocuments, remainingVoicePrompts, canIssueDocument } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('Free has five combined documents, no voice, and no change orders', () => {
  assert.equal(PLANS.free.combinedDocumentLimit, 5)
  assert.equal(PLANS.free.monthlyPriceCents, 0)
  assert.equal(remainingVoicePrompts('free', 0), 0)
  assert.equal(canIssueDocument('free', 'change_order', 0), false)
})
test('Both free document types use the same counter and stop at five', () => {
  for (const kind of ['estimate', 'invoice']) {
    assert.equal(canIssueDocument('free', kind, 4), true)
    assert.equal(canIssueDocument('free', kind, 5), false)
  }
  assert.equal(remainingDocuments('free', 0), 5)
  assert.equal(remainingDocuments('free', 4), 1)
  assert.equal(remainingDocuments('free', 5), 0)
  assert.equal(remainingDocuments('free', 6), 0)
})
test('Pro is $19.99 and has fifty voice prompts', () => {
  assert.equal(PLANS.pro.monthlyPriceCents, 1999)
  assert.equal(remainingVoicePrompts('pro', 0), 50)
  assert.equal(remainingVoicePrompts('pro', 49), 1)
  assert.equal(remainingVoicePrompts('pro', 50), 0)
  assert.equal(remainingVoicePrompts('pro', 51), 0)
})
test('Exhausting voice does not disable Pro manual documents or change orders', () => {
  assert.equal(remainingVoicePrompts('pro', 50), 0)
  assert.equal(remainingDocuments('pro', 500), null)
  for (const kind of ['estimate', 'invoice', 'change_order']) {
    assert.equal(canIssueDocument('pro', kind, 500), true)
  }
})
test('Invalid usage and unknown plans fail closed', () => {
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => remainingDocuments('free', count))
    assert.throws(() => remainingVoicePrompts('pro', count))
  }
  assert.throws(() => getPlan('enterprise'))
  assert.throws(() => getPlan('__proto__'))
  assert.throws(() => canIssueDocument('pro', 'unknown', 0))
})
test('Plan definitions cannot be changed by consumers', () => {
  assert.equal(Object.isFrozen(PLANS), true)
  assert.equal(Object.isFrozen(PLANS.free), true)
  assert.equal(Object.isFrozen(PLANS.pro), true)
})
