// 配置校验对齐回归（2026-09-24 审计批次 1 · B②③）。
//
// 缺陷背景：①advisorMaxQueued 运行时校验允许 0 而静态校验要求 ≥1——
// 0 会让 advisor runtime 的入队判据恒真、评审请求全部静默 drop；
// ②keyProgressiveDisclosure 枚举与 4 个 FullInject 数值键 +
// memoryHitExemptDays 缺静态校验——config.yaml 写错静默降级恒摘要，
// 违反 resolveConfig「misconfiguration fails at load」自述。
// 直跑：node tests/config-validate-align.test.js（沙箱禁 node --test runner）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { validateRuntimePatch, resolveConfig } from '../lib/index.js'

// resolveConfig 需要 memoryDir 可解析——给最小合法底座（POSITIVE/BOOLEAN
// 键全部给默认值形态的合法值，缺失键带默认值的走 raw 合并）。
const BASE = {
  advisorEnabled: false, injectMemory: true, injectionScan: true, reviewEnabled: true,
  skillReviewEnabled: true, entryDatePrefix: true, memoryTabEnabled: true,
  keyBranchFilter: true, perTurnProjectWrites: true, perTurnDailyWrites: true,
  perTurnKeyWrites: true, perTurnWriteGuard: true, searchDocsEnabled: true,
  coiEnabled: false, coiSummaryEnabled: true, coiSyncSkills: true,
  promptsEnabled: true, sessionSearchEnabled: true, sessionEnabled: true,
  todoEnabled: true, notifyEnabled: true, channelSendEnabled: true,
  broadcastImageEnabled: true, memoryDir: tmpdir(),
}

test('②运行时：advisorMaxQueued 拒绝 0（≥1，与静态校验对齐）', () => {
  assert.throws(() => validateRuntimePatch('advisorMaxQueued', 0), /正整数/)
  assert.throws(() => validateRuntimePatch('advisorMaxQueued', -1), /正整数/)
  assert.doesNotThrow(() => validateRuntimePatch('advisorMaxQueued', 1))
  assert.doesNotThrow(() => validateRuntimePatch('advisorMaxQueued', 32))
  // 邻键语义不变：ImmuneTurns/MaxMessages 仍允许 0（0=无上限/关闭）
  assert.doesNotThrow(() => validateRuntimePatch('advisorImmuneTurns', 0))
  assert.doesNotThrow(() => validateRuntimePatch('advisorMaxMessages', 0))
})

test('③a 静态：keyProgressiveDisclosure 枚举校验', () => {
  for (const good of ['auto', 'off', 'on']) {
    assert.doesNotThrow(() => resolveConfig({ ...BASE, keyProgressiveDisclosure: good }))
  }
  assert.throws(() => resolveConfig({ ...BASE, keyProgressiveDisclosure: 'Auto' }), /keyProgressiveDisclosure/)
  assert.throws(() => resolveConfig({ ...BASE, keyProgressiveDisclosure: 'summary' }), /keyProgressiveDisclosure/)
})

test('③b 静态：FullInject 数值键必须是正数', () => {
  for (const key of ['keyFullInjectThreshold', 'keyFullInjectCharLimit', 'memoryFullInjectThreshold', 'memoryFullInjectCharLimit']) {
    assert.throws(() => resolveConfig({ ...BASE, [key]: 0 }), new RegExp(key))
    assert.throws(() => resolveConfig({ ...BASE, [key]: -3 }), new RegExp(key))
    assert.doesNotThrow(() => resolveConfig({ ...BASE, [key]: 5 }))
  }
})

test('③c 静态：memoryHitExemptDays 非负整数（0=关闭，合法）', () => {
  assert.throws(() => resolveConfig({ ...BASE, memoryHitExemptDays: -1 }), /memoryHitExemptDays/)
  assert.throws(() => resolveConfig({ ...BASE, memoryHitExemptDays: 1.5 }), /memoryHitExemptDays/)
  assert.doesNotThrow(() => resolveConfig({ ...BASE, memoryHitExemptDays: 0 }))
  assert.doesNotThrow(() => resolveConfig({ ...BASE, memoryHitExemptDays: 30 }))
})
