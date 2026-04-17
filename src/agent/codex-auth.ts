/**
 * Codex (ChatGPT 订阅) OAuth Token 管理
 *
 * 设计:
 * - 不实现 login 流程 — 复用 Codex CLI 写好的 ~/.codex/auth.json
 *   (用户跑 `codex` 命令登录一次即可)
 * - 进程内缓存 access_token,401 时主动刷一次
 * - 刷新成功后写回 ~/.codex/auth.json,跟 Codex CLI 共享 refresh_token
 *
 * auth.json 形状(由 Codex CLI 维护):
 *   {
 *     "OPENAI_API_KEY": null,
 *     "tokens": {
 *       "id_token": "...",         // ID token,带 account_id claim
 *       "access_token": "...",     // 30 天有效
 *       "refresh_token": "...",    // refresh 时可能旋转
 *       "account_id": "..."        // ChatGPT 账户 id
 *     },
 *     "last_refresh": "2026-04-13T10:26:00.000Z"
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const AUTH_FILE = join(homedir(), '.codex', 'auth.json')
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

export interface CodexTokens {
  access_token: string
  refresh_token: string
  account_id: string
}

interface AuthFile {
  OPENAI_API_KEY?: string | null
  tokens: {
    id_token?: string
    access_token: string
    refresh_token: string
    account_id?: string
  }
  last_refresh?: string
}

let cached: CodexTokens | null = null

function readAuthFile(): AuthFile {
  if (!existsSync(AUTH_FILE)) {
    throw new Error(
      `Codex auth file not found at ${AUTH_FILE}. ` +
        `Run \`codex\` once in your terminal to log in to ChatGPT.`,
    )
  }
  let raw: string
  try {
    raw = readFileSync(AUTH_FILE, 'utf-8')
  } catch (err) {
    throw new Error(
      `Failed to read ${AUTH_FILE}: ${(err as Error).message}`,
    )
  }
  let parsed: AuthFile
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Failed to parse ${AUTH_FILE} as JSON: ${(err as Error).message}`,
    )
  }
  if (!parsed?.tokens?.access_token || !parsed?.tokens?.refresh_token) {
    throw new Error(
      `${AUTH_FILE} missing tokens.access_token / tokens.refresh_token. ` +
        `Re-run \`codex\` to refresh authentication.`,
    )
  }
  return parsed
}

function writeAuthFile(auth: AuthFile): void {
  // 0600 权限 — Codex CLI 用同样的权限位
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 })
}

/** 从 ID token JWT 中解出 account_id(缺 tokens.account_id 时的兜底) */
function extractAccountIdFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined
  const parts = idToken.split('.')
  if (parts.length !== 3) return undefined
  try {
    // JWT 中间段是 base64url
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf-8')
    const claims = JSON.parse(json)
    // ChatGPT auth claim 形如 { "https://api.openai.com/auth": { "chatgpt_account_id": "..." } }
    const auth = claims?.['https://api.openai.com/auth']
    return auth?.chatgpt_account_id ?? auth?.account_id ?? undefined
  } catch {
    return undefined
  }
}

/** 取当前 tokens(优先内存缓存,否则读盘) */
export function loadCodexTokens(): CodexTokens {
  if (cached) return cached
  const auth = readAuthFile()
  const accountId =
    auth.tokens.account_id ?? extractAccountIdFromIdToken(auth.tokens.id_token)
  if (!accountId) {
    throw new Error(
      `${AUTH_FILE} missing account_id and could not extract from id_token. ` +
        `Re-run \`codex\` to refresh.`,
    )
  }
  cached = {
    access_token: auth.tokens.access_token,
    refresh_token: auth.tokens.refresh_token,
    account_id: accountId,
  }
  return cached
}

/**
 * 用 refresh_token 换新的 access_token,更新内存缓存 + 写回 auth.json。
 * 失败时清空缓存并抛错,提示用户重新登录。
 */
export async function refreshCodexTokens(): Promise<CodexTokens> {
  const current = loadCodexTokens()
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
      client_id: OAUTH_CLIENT_ID,
    }).toString(),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    cached = null
    throw new Error(
      `Codex token refresh failed (HTTP ${response.status}): ${body.slice(0, 300)}. ` +
        `If this says "refresh_token_reused" or "invalid_grant", run \`codex\` again to re-login.`,
    )
  }

  let payload: any
  try {
    payload = await response.json()
  } catch (err) {
    cached = null
    throw new Error(`Codex token refresh returned invalid JSON: ${(err as Error).message}`)
  }

  const newAccess = payload?.access_token
  if (typeof newAccess !== 'string' || !newAccess) {
    cached = null
    throw new Error(`Codex token refresh missing access_token in response`)
  }
  // refresh_token 可能旋转,也可能不变
  const newRefresh =
    typeof payload.refresh_token === 'string' && payload.refresh_token
      ? payload.refresh_token
      : current.refresh_token
  const newIdToken = typeof payload.id_token === 'string' ? payload.id_token : undefined

  const updated: CodexTokens = {
    access_token: newAccess,
    refresh_token: newRefresh,
    account_id: current.account_id,
  }
  cached = updated

  // 写回磁盘 — 跟 Codex CLI 共享 refresh_token 状态
  try {
    const auth = readAuthFile()
    auth.tokens.access_token = newAccess
    auth.tokens.refresh_token = newRefresh
    if (newIdToken) auth.tokens.id_token = newIdToken
    auth.last_refresh = new Date().toISOString()
    writeAuthFile(auth)
  } catch (err) {
    // 写回失败不致命,内存缓存还是新的
    console.warn(
      `[codex-auth] Failed to persist refreshed tokens to ${AUTH_FILE}: ${(err as Error).message}`,
    )
  }

  return updated
}

/** 测试用:清空内存缓存,强制下次 loadCodexTokens 重读盘 */
export function clearCodexTokenCache(): void {
  cached = null
}
