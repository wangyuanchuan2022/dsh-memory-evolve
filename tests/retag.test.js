// retag 存量补标测试（PR #66 后续增强，块 6）。
//
// 覆盖（规格块 6.3 六例）：
//   ① 无 tag 条目 retag 后带 tag 且正文逐字不变
//   ② 已有 tag 替换为新级别
//   ③ match 不唯一报错（语义同 replace）
//   ④ project/daily 日志轨拒绝（工具层诚实拒绝；store 层防御性同校验）
//   ⑤ [id:]/[summary:] 原样保留（tag-only 重写）
//   ⑥ store 层 salience 非法值防御 + retagEntry 头部序列形态矩阵
//
// 直跑：node tests/retag.test.js（沙箱禁 node --test runner）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, parseEntries, parseEntrySalience, retagEntry } from '../lib/store.js'

function setup(memoryText = '') {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-retag-test-'))
  if (memoryText !== '') writeFileSync(join(dir, 'MEMORY.md'), memoryText)
  return { dir, store: new MemoryStore(dir) }
}

function readTrack(dir, file = 'MEMORY.md') {
  return readFileSync(join(dir, file), 'utf8')
}

test('①无 tag 条目 retag 后带 tag 且正文逐字不变', () => {
  const entry = '[2026-09-20] 用户偏好多轮对话确认\n第二行正文细节'
  const fx = setup(entry + '\n')
  try {
    const r = fx.store.retag('memory', '用户偏好多轮对话确认', 3, undefined)
    assert.equal(r.ok, true, r.message)
    const entries = parseEntries(readTrack(fx.dir))
    assert.equal(entries.length, 1)
    assert.equal(entries[0], '[2026-09-20] [salience:3] 用户偏好多轮对话确认\n第二行正文细节')
    // 正文逐字不变：剥掉新 tag 后应与原条目逐字节一致
    assert.equal(retagEntry(entries[0], 3).includes('用户偏好多轮对话确认\n第二行正文细节'), true)
    assert.equal(parseEntrySalience(entries[0]), 3)
    // store 返回 entry 字段供工具层回显短 id
    assert.equal(r.entry, entries[0])
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('②已有 tag 替换为新级别（旧 [salience:1] → 新 [salience:3]，不残留旧 tag）', () => {
  const entry = '[2026-09-21] [salience:1] 旧低档条目正文'
  const fx = setup(entry + '\n')
  try {
    const r = fx.store.retag('memory', '旧低档条目正文', 3, undefined)
    assert.equal(r.ok, true, r.message)
    const entries = parseEntries(readTrack(fx.dir))
    assert.equal(entries[0], '[2026-09-21] [salience:3] 旧低档条目正文')
    assert.equal(entries[0].includes('[salience:1]'), false, 'old tag must be stripped')
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('③match 不唯一报错（错误口径同 replace，不落盘）', () => {
  const text = '[2026-09-20] 重复关键词甲条目\n§\n[2026-09-21] 重复关键词乙条目\n'
  const fx = setup(text)
  try {
    const r = fx.store.retag('memory', '重复关键词', 2, undefined)
    assert.equal(r.ok, false)
    assert.match(r.message, /多于一条|更精确|matches \d+ entries|more precise/)
    assert.equal(Array.isArray(r.matches), true)
    // 未落盘：文件原样
    assert.equal(readTrack(fx.dir), text)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('④project/daily 拒绝 retag（日志轨无重要性语义）', () => {
  const fx = setup('')
  try {
    // store 层直接对 project 轨 retag：走 resolveTarget 写日志轨 = 语义错误，
    // 防御性校验在工具层（msg.retagLogsRejected）；store 层对日志轨同样拒绝
    // 写 [salience:N]（stampEntry 口径：日志轨不标 tag）——这里验证 store 层
    // 不给日志轨留 retag 成功路径之外的副作用（日志轨 retag 直接返回错误）。
    const r = fx.store.retag('daily', '不存在的匹配', 2, undefined)
    assert.equal(r.ok, false, 'daily retag must not succeed silently')
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('⑤[id:] 与 [summary:] 原样保留（tag-only 重写，不换生命周期）', () => {
  const entry = '[id:deadbeef] [2026-09-22] [summary:显式摘要] 有身份证有摘要的条目正文'
  const fx = setup(entry + '\n')
  try {
    const r = fx.store.retag('memory', '有身份证有摘要的条目正文', 2, undefined)
    assert.equal(r.ok, true, r.message)
    const entries = parseEntries(readTrack(fx.dir))
    assert.equal(entries[0], '[id:deadbeef] [2026-09-22] [summary:显式摘要] [salience:2] 有身份证有摘要的条目正文')
    // summary 形态在前的乱序容错：retag 后新 tag 仍插在 summary 之后
    assert.equal(parseEntrySalience(entries[0]), 2)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('⑦工具层静态契约：retag 成功回显不得携带 output schema 未声明的 entry 字段', () => {
  // 背景（2026-09-24 生产实证）：store.retag 成功返回含 entry（供工具层取
  // 短 id），若原样透传，宿主对工具输出的 additionalProperties:false 校验会
  // 整单拒绝（报 value.entry is not a declared property）——写盘已发生但模型
  // 只见报错。假宿主不校验输出 schema，只有生产宿主能抓，故用静态源码契约
  // 锁住：retag case 块必须在 break 前 delete result.entry。
  const src = readFileSync(join(import.meta.dirname, '..', 'lib', 'index.js'), 'utf8')
  const start = src.indexOf("case 'retag':")
  assert.notEqual(start, -1, 'retag case 未找到')
  const end = src.indexOf('break', src.indexOf('delete result.entry', start) === -1 ? start : src.indexOf('delete result.entry', start))
  const block = src.slice(start, end + 'break'.length)
  assert.match(block, /delete result\.entry/, 'retag 块必须 delete result.entry（宿主 output schema additionalProperties:false）')
  // delete 必须在 message 构造之后（先用 entry 取短 id，再删）
  const msgIdx = block.indexOf('msg.retagDone')
  const delIdx = block.indexOf('delete result.entry')
  assert.ok(msgIdx !== -1 && delIdx > msgIdx, 'delete result.entry 应在 msg.retagDone 构造之后')
})

test('⑥store 层 salience 非法值防御 + retagEntry 头部形态矩阵（≥3 元素）', () => {
  const fx = setup('[2026-09-20] 某条目\n')
  try {
    for (const bad of [0, 4, 2.5, '3x', null]) {
      const r = fx.store.retag('memory', '某条目', bad, undefined)
      assert.equal(r.ok, false, `value ${String(bad)} must be rejected`)
      assert.match(r.message, /1-3/)
    }
    assert.equal(readTrack(fx.dir), '[2026-09-20] 某条目\n', 'rejected calls must not write')
    // retagEntry 纯函数矩阵：时间戳形 / 无时间戳裸条目 / git+branch 复合头部
    assert.equal(retagEntry('[2026-09-20] 正文', 1), '[2026-09-20] [salience:1] 正文')
    assert.equal(retagEntry('裸条目正文', 2), '[salience:2] 裸条目正文')
    assert.equal(
      retagEntry('[2026-09-21] [git main] [branch:dev] 复合头部正文', 3),
      '[2026-09-21] [git main] [branch:dev] [salience:3] 复合头部正文',
    )
    // 乱序容错：summary 在前（手写文件）→ 新 tag 仍插 summary 之后
    assert.equal(
      retagEntry('[2026-09-22] [summary:摘] 正文', 2),
      '[2026-09-22] [summary:摘] [salience:2] 正文',
    )
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})
