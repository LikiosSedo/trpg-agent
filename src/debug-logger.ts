/**
 * Debug Session Logger — 把服务器端所有关键事件写到 JSONL 文件
 *
 * 设计目的:
 *   玩家在浏览器里玩游戏的时候,服务器端的 console.log(DM thinking / 规则系统
 *   分类 / 暴力后果 / 战斗 / tool call 等)全部自动记录到文件。当玩家发现
 *   "哪里不对劲"时,可以直接 grep 最新的日志文件定位问题,不用复现。
 *
 * 策略:
 *   1. 启动时创建 logs/session-YYYYMMDD-HHMMSS.jsonl,monkey-patch console.*
 *      所有已存在的 console.log / warn / error 自动被捕获,零侵入。
 *   2. 提供 logEvent(cat, data) 给需要结构化记录的地方(如 WS in/out)主动写。
 *   3. JSONL 格式: 一行一个 { t, cat, ...data } JSON,便于 grep + tail -f。
 *   4. 写入用 appendFileSync —— 同步慢一点,但崩溃时不丢日志,值得。
 *
 * 典型使用:
 *   import { initSessionLogger, logEvent } from './debug-logger.js'
 *
 *   // 启动时(server.ts 顶部)
 *   initSessionLogger()
 *
 *   // 需要结构化记录的地方
 *   logEvent('ws.recv', { type: msg.type, input: msg.input })
 *
 *   // console.log 无需改动,已经被 tee 到文件
 *   console.log('[server] new player connected')
 *
 * 查看日志:
 *   ls -t logs/ | head -1           # 最新的 session
 *   tail -f logs/session-*.jsonl     # 实时跟踪
 *   grep '"cat":"ws.recv"' logs/...  # 按类型过滤
 *   grep consequence logs/...        # 按 prefix 过滤(console.log 内容)
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logFilePath: string | null = null
let origLog: typeof console.log | null = null
let origWarn: typeof console.warn | null = null
let origError: typeof console.error | null = null

/**
 * 初始化 session logger。创建日志文件 + monkey-patch console.
 * 幂等 —— 重复调用不会重新 patch。
 * @returns 日志文件绝对路径
 */
export function initSessionLogger(): string {
  if (logFilePath) return logFilePath

  const dir = 'logs'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // 文件名用本地时区的时间戳(而非 UTC),方便用户和日志对应上
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

  logFilePath = join(dir, `session-${ts}.jsonl`)
  writeFileSync(logFilePath, '')  // 创建空文件

  // 保存原始 console 方法
  origLog = console.log.bind(console)
  origWarn = console.warn.bind(console)
  origError = console.error.bind(console)

  // Tee: 既调用原方法,又写到日志文件
  console.log = (...args: any[]) => {
    origLog!(...args)
    writeEvent('log', { msg: formatArgs(args) })
  }
  console.warn = (...args: any[]) => {
    origWarn!(...args)
    writeEvent('warn', { msg: formatArgs(args) })
  }
  console.error = (...args: any[]) => {
    origError!(...args)
    writeEvent('error', { msg: formatArgs(args) })
  }

  // 启动头记录
  writeEvent('session.start', {
    pid: process.pid,
    node: process.version,
    cwd: process.cwd(),
    file: logFilePath,
  })

  // 通过原 log 打印一次(显示在终端),不进日志(否则会递归)
  origLog(`[debug-logger] session log → ${logFilePath}`)

  return logFilePath
}

/**
 * 记录一条结构化事件。
 * @param cat 分类(如 'ws.recv' / 'dm.tool_call' / 'player.input')
 * @param data 任意 JSON-safe 数据
 */
export function logEvent(cat: string, data: Record<string, any> = {}): void {
  writeEvent(cat, data)
}

/**
 * 返回当前会话日志文件路径(未初始化返回 null)
 */
export function getCurrentLogFile(): string | null {
  return logFilePath
}

// ─── 内部 ────────────────────────────────────────────

function writeEvent(cat: string, data: Record<string, any>): void {
  if (!logFilePath) return
  try {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      cat,
      ...data,
    })
    appendFileSync(logFilePath, line + '\n')
  } catch {
    // 日志写入失败不应该让主逻辑崩溃,静默忽略
    // (如果真的写不了,通常是磁盘满/权限问题,没有什么能做的)
  }
}

/** 把 console.log 的可变参数转成单行字符串 */
function formatArgs(args: any[]): string {
  return args
    .map(a => {
      if (typeof a === 'string') return a
      if (a === null) return 'null'
      if (a === undefined) return 'undefined'
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}
