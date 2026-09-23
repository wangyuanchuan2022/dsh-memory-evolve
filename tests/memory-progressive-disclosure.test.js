// 快照分层注入测试（autopilot-memory-lifecycle Step 4；AC-3.1~3.5 + AC-6.8）
//
// 覆盖：
//   - AC-3.1（默认零变化，负向）：off/缺省 → renderSnapshot 输出与黄金基线
//     （tests/snapshot-golden.test.js，strip 链改动前捕获）逐字节一致
//   - AC-3.2：auto + 超阈值 → 无标记与低/中 salience 摘要注入（[summary] 优先、
//     autoSummary 兜底）、[salience:3] 恒全文
//   - AC-3.3：auto + 未超阈值 → 全量注入（与 off 输出一致）
//   - AC-3.4（注入必红，防旋钮失效假绿）：同一 store 开/关两份快照必须不同
//   - AC-3.5：摘要注入段头部文案告知模型可用 list 取全文
//   - AC-6.8：新增 i18n key zh/en 齐全 + 新旋钮值合法性校验
//
// 直跑：node tests/memory-progressive-disclosure.test.js（沙箱禁 node --test runner）。
// 注：import golden 模块会连带执行其黄金基线测试（幂等只读，无害）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, renderSnapshot, resolveConfig, validateRuntimePatch } from '../lib/index.js'
import { MemoryStore, projectHash } from '../lib/store.js'
import { SNAPSHOT_DICT } from '../lib/i18n.js'
import { buildGoldenFixture, GOLDEN_ZH } from './snapshot-golden.test.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-memory-mpd-test-'))
}
function clean(dir) {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * 分层注入专用 fixture：memory 轨四类条目（高档/低档/显式摘要/无标记），
 * 除高档外全部为两行正文——摘要注入只保留首行（或摘要），第二行的
 * 在与不在即是「摘要化是否发生」的逐条鉴别断言。user 轨一条两行。
 */
function buildTieredFixture() {
  const dir = tempDir()
  const memoryEntries = [
    '[2026-09-20] [salience:3] 高档条目全文第一行\n高档条目全文第二行',
    '[2026-09-21] [salience:1] 低档条目第一行\n低档条目第二行',
    '[2026-09-22] [summary:显式摘要示例] 显式摘要条目第一行\n显式摘要条目第二行',
    '[2026-09-23] 无标记条目第一行\n无标记条目第二行',
  ]
  const userEntries = [
    '[2026-09-19] 用户档案条目第一行\n用户档案条目第二行',
  ]
  const CWD = '/proj/mpd-cwd'
  writeFileSync(join(dir, 'MEMORY.md'), memoryEntries.join('\n§\n') + '\n')
  writeFileSync(join(dir, 'USER.md'), userEntries.join('\n§\n') + '\n')
  const keyDir = join(dir, 'projects', projectHash(CWD))
  mkdirSync(keyDir, { recursive: true })
  writeFileSync(join(keyDir, 'KEY.md'), '[2026-09-18] 关键条目\n')
  return {
    dir,
    store: new MemoryStore(dir),
    agent: { id: 'a', session: { header: { cwd: CWD } } },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('AC-3.1 默认零变化：off/缺省的快照输出与黄金基线逐字节一致', () => {
  const fx = buildGoldenFixture()
  try {
    const byDefault = renderSnapshot(fx.config, fx.store, fx.agent)
    assert.equal(byDefault, GOLDEN_ZH, '缺省（无旋钮）= off：与 golden 基线逐字节一致')
    const offExplicit = renderSnapshot({ ...fx.config, memoryProgressiveDisclosure: 'off' }, fx.store, fx.agent)
    assert.equal(offExplicit, GOLDEN_ZH, '显式 off：与 golden 基线逐字节一致')
  } finally {
    fx.cleanup()
  }
})

test('AC-3.2 auto+超阈值：低/中/无标记摘要注入（显式 summary 优先、autoSummary 兜底），salience:3 恒全文', () => {
  const fx = buildTieredFixture()
  try {
    const cfg = resolveConfig({ memoryDir: fx.dir, memoryProgressiveDisclosure: 'auto', memoryFullInjectCharLimit: 1 })
    const snap = renderSnapshot(cfg, fx.store, fx.agent)
    // 摘要头文案出现（AC-3.5 一部分：含 list 指引）
    assert.ok(snap.includes('摘要模式'), 'summary-mode head must appear')
    // [salience:3] 恒全文：两行正文都在（重要性豁免）
    assert.ok(snap.includes('高档条目全文第一行'), 'salience:3 first line stays full')
    assert.ok(snap.includes('高档条目全文第二行'), 'salience:3 second line stays full')
    // 低档 [salience:1]：只留首行摘要（短 id 前缀形态），第二行不得泄漏
    assert.ok(!snap.includes('低档条目第二行'), 'salience:1 second line must be dropped in summary mode')
    assert.ok(snap.includes('低档条目第一行'), 'salience:1 first line feeds autoSummary')
    // 显式摘要优先：注入「显式摘要示例」而非正文任何一行
    assert.ok(snap.includes('显式摘要示例'), 'explicit summary wins')
    assert.ok(!snap.includes('显式摘要条目第一行') && !snap.includes('显式摘要条目第二行'), 'explicit-summary entry body must not leak')
    // 无标记条目：autoSummary 兜底取首行
    assert.ok(!snap.includes('无标记条目第二行'), 'untagged second line must be dropped')
    assert.ok(snap.includes('无标记条目第一行'), 'untagged first line feeds autoSummary')
    // user 轨同机制（连带分层）
    assert.ok(snap.includes('## 用户档案（摘要模式'), 'user track summary head appears')
    assert.ok(!snap.includes('用户档案条目第二行'), 'user track second line dropped')
  } finally {
    fx.cleanup()
  }
})

test('AC-3.3 auto+未超阈值：全量注入（与 off 输出一致）', () => {
  const dir = tempDir()
  try {
    writeFileSync(join(dir, 'MEMORY.md'), '[2026-09-20] 短条目一\n§\n[2026-09-21] 短条目二\n')
    const store = new MemoryStore(dir)
    const agent = { id: 'a', session: { header: { cwd: '/proj/mpd-small' } } }
    // 2 条 ≤ 阈值 3 且字符 ≤ 1500 → auto 全量
    const auto = renderSnapshot(resolveConfig({ memoryDir: dir, memoryProgressiveDisclosure: 'auto' }), store, agent)
    const off = renderSnapshot(resolveConfig({ memoryDir: dir, memoryProgressiveDisclosure: 'off' }), store, agent)
    assert.equal(auto, off, 'small data under auto must render exactly like off (full injection)')
    assert.ok(!auto.includes('摘要模式'))
    assert.ok(auto.includes('短条目一') && auto.includes('短条目二'))
  } finally {
    clean(dir)
  }
})

test('AC-3.4 注入必红：同一 store 开/关两份快照必须不同（防旋钮失效恒同现状的假绿）', () => {
  const fx = buildTieredFixture()
  try {
    const base = resolveConfig({ memoryDir: fx.dir })
    const off = renderSnapshot(base, fx.store, fx.agent)
    const on = renderSnapshot({ ...base, memoryProgressiveDisclosure: 'on' }, fx.store, fx.agent)
    assert.notStrictEqual(off, on, 'on vs off must differ — if equal the knob is dead (false green)')
    // 反向也验：auto（超阈值）与 off 必不同
    const auto = renderSnapshot({ ...base, memoryProgressiveDisclosure: 'auto', memoryFullInjectCharLimit: 1 }, fx.store, fx.agent)
    assert.notStrictEqual(off, auto)
  } finally {
    fx.cleanup()
  }
})

test('AC-3.5 摘要头文案告知取全文走 list；on 模式下 memory/user 轨摘要化', () => {
  const fx = buildTieredFixture()
  try {
    const cfg = resolveConfig({ memoryDir: fx.dir, memoryProgressiveDisclosure: 'on' })
    const snap = renderSnapshot(cfg, fx.store, fx.agent)
    assert.ok(snap.includes('list（target=memory）'), 'memory summary head must point to list target=memory')
    assert.ok(snap.includes('list（target=user）'), 'user summary head must point to list target=user')
  } finally {
    fx.cleanup()
  }
})

test('AC-6.8 新增 i18n key zh/en 成对齐全；新旋钮值校验生效', () => {
  // 新键成对（zh/en 非空——键对齐全量兜底在 tests/i18n.test.js）
  for (const key of ['snap.memorySummaryHead', 'snap.userSummaryHead']) {
    const pair = SNAPSHOT_DICT[key]
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key} must carry a zh/en pair`)
    assert.ok(pair[0].length > 0 && pair[1].length > 0, `${key} zh/en both non-empty`)
  }
  // validateRuntimePatch：非法值响亮失败、合法值放行
  assert.throws(() => validateRuntimePatch('memoryProgressiveDisclosure', 'bogus'), /memoryProgressiveDisclosure/)
  assert.doesNotThrow(() => validateRuntimePatch('memoryProgressiveDisclosure', 'auto'))
  assert.doesNotThrow(() => validateRuntimePatch('memoryProgressiveDisclosure', 'on'))
  assert.doesNotThrow(() => validateRuntimePatch('memoryProgressiveDisclosure', 'off'))
  assert.throws(() => validateRuntimePatch('memoryFullInjectThreshold', 0), /正整数/)
  assert.throws(() => validateRuntimePatch('memoryFullInjectCharLimit', 1.5), /正整数/)
  assert.doesNotThrow(() => validateRuntimePatch('memoryFullInjectCharLimit', 1500))
  // resolveConfig：非法旋钮值响亮失败（配置文件路径的守门）
  assert.throws(() => resolveConfig({ memoryProgressiveDisclosure: 'sometimes' }), /memoryProgressiveDisclosure/)
  // 默认值 = off
  assert.equal(resolveConfig({}).memoryProgressiveDisclosure, 'off')
  assert.equal(resolveConfig({}).memoryFullInjectThreshold, 3)
  assert.equal(resolveConfig({}).memoryFullInjectCharLimit, 1500)
})
