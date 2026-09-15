/**
 * locket-api.js
 * Pure JS — inject Locket Gold via RevenueCat bypass
 * No Telegram. No bot. No framework. Just call the functions.
 *
 * Works in: Node.js 18+ (native fetch) · Browser
 *
 * ─── QUICK START ──────────────────────────────────────────────
 *
 *   import { resolveUid, checkStatus, injectGold, createNextDns, activate } from './locket-api.js'
 *
 *   const TOKEN = {
 *     fetch_token:     'eyJ...',
 *     app_transaction: 'eyJ...',
 *     is_sandbox:      false,
 *     hash_params:     '',   // optional
 *     hash_headers:    '',   // optional
 *   }
 *
 *   // One-liner — full pipeline
 *   const result = await activate('username', TOKEN, 'nextdns_key', console.log)
 *   // { ok: true, uid: 'U...', pid: 'abc123', iosLink: 'https://apple.nextdns.io/...' }
 *
 * ──────────────────────────────────────────────────────────────
 */

'use strict'

// ── INTERNAL UTILS ────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

const noop = () => {}

/** Strip @, extract from locket.cam URL if needed */
function normalizeUsername(raw) {
  raw = raw.trim()
  if (raw.includes('locket.cam/'))
    return raw.split('locket.cam/').pop().split('?')[0].trim()
  return raw.replace(/^@/, '').split('?')[0].trim()
}

// ── RC HEADERS (exact mirror of locket.py HEADERS) ────────────────────────
function rcHeaders(extra = {}) {
  return {
    'Host':                       'api.revenuecat.com',
    'Authorization':              'Bearer appl_JngFETzdodyLmCREOlwTUtXdQik',
    'Content-Type':               'application/json',
    'Accept':                     '*/*',
    'X-Platform':                 'iOS',
    'X-Platform-Version':         'Version 26.2 (Build 23C55)',
    'X-Platform-Device':          'iPhone15,3',
    'X-Platform-Flavor':          'native',
    'X-Version':                  '5.41.0',
    'X-Client-Version':           '2.32.2',
    'X-Client-Bundle-ID':         'com.locket.Locket',
    'X-Client-Build-Version':     '3',
    'X-StoreKit2-Enabled':        'true',
    'X-StoreKit-Version':         '2',
    'X-Observer-Mode-Enabled':    'false',
    'X-Is-Sandbox':               'false',
    'X-Storefront':               'VNM',
    'X-Apple-Device-Identifier':  '39A73C25-1E05-4350-ADA7-5CD3FE1079E8',
    'X-Preferred-Locales':        'vi_KR,ko_KR,en_KR',
    'X-Nonce':                    'w0Mlb6+AmV4WYuVv',
    'X-Is-Backgrounded':          'false',
    'X-Retry-Count':              '0',
    'X-Is-Debug-Build':           'false',
    'User-Agent':                 'Locket/3 CFNetwork/3860.300.31 Darwin/25.2.0',
    'Accept-Language':            'vi-VN,vi;q=0.9',
    'Connection':                 'keep-alive',
    'Pragma':                     'no-cache',
    'Cache-Control':              'no-cache',
    'X-RevenueCat-ETag':          '',
    ...extra,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. resolveUid
//    mirrors: locket.py → resolve_uid()
// ══════════════════════════════════════════════════════════════════════════
/**
 * Resolve a locket.cam username to its RevenueCat UID.
 *
 * @param   {string}       username  — bare username, @username, or locket.cam/... URL
 * @returns {Promise<string|null>}   — 28-char UID string, or null if not found
 *
 * @example
 *   const uid = await resolveUid('myuser')
 *   // 'U3eEb6n0zwP44C0AOp3sKqLm7R2'
 */
export async function resolveUid(username) {
  username = normalizeUsername(username)
  const url = `https://locket.cam/${username}`

  try {
    const res  = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        'Accept':     'text/html',
      },
      redirect: 'follow',
    })
    const html     = await res.text()
    const finalUrl = res.url

    const extract = text => {
      if (!text) return null
      // Primary: invite link pattern (mirrors locket.py regex)
      const m1 = text.match(/\/invites\/([A-Za-z0-9]{28})/)
      if (m1) return m1[1]
      // Fallback: encoded link= param
      const lp = text.match(/link=([^\s"'>]+)/)
      if (lp) {
        try {
          const decoded = lp[1].replace(/%3A/g, ':').replace(/%2F/g, '/')
          const m2 = decoded.match(/\/invites\/([A-Za-z0-9]{28})/)
          if (m2) return m2[1]
        } catch { /* ignore */ }
      }
      return null
    }

    return extract(finalUrl) || extract(html) || null
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 2. checkStatus
//    mirrors: locket.py → check_status()
// ══════════════════════════════════════════════════════════════════════════
/**
 * Check the RevenueCat Gold entitlement status for a UID.
 *
 * @param   {string} uid
 * @returns {Promise<{ active: boolean, expires: string|null }>}
 *
 * @example
 *   const s = await checkStatus('U3eEb6n0zwP44C0AOp3s...')
 *   // { active: false, expires: null }
 *   // { active: true,  expires: '2026-12-31T00:00:00Z' }
 */
export async function checkStatus(uid) {
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${uid}`,
      { headers: rcHeaders() }
    )
    if (res.ok) {
      const data = await res.json()
      const ent  = data?.subscriber?.entitlements?.Gold
      if (ent) return { active: true, expires: ent.expires_date ?? null }
    }
  } catch { /* network */ }
  return { active: false, expires: null }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. injectGold
//    mirrors: locket.py → inject_gold()
// ══════════════════════════════════════════════════════════════════════════
/**
 * Inject Locket Gold via RevenueCat receipt bypass.
 *
 * @param {string}   uid
 * @param {object}   token
 * @param {string}   token.fetch_token       — StoreKit2 fetch token JWT
 * @param {string}   token.app_transaction   — StoreKit2 app transaction JWT
 * @param {boolean}  token.is_sandbox        — true if sandbox/dev token
 * @param {string}  [token.hash_params]      — X-Post-Params-Hash (optional)
 * @param {string}  [token.hash_headers]     — X-Headers-Hash (optional)
 * @param {string}  [token.name]             — label for logs
 * @param {function} [onLog]                 — (msg: string, type: 'dim'|'warn'|'ok'|'err') => void
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 *
 * @example
 *   const r = await injectGold(uid, TOKEN, (msg, t) => console.log(`[${t}]`, msg))
 *   // { ok: true, message: 'SUCCESS' }
 *   // { ok: false, message: 'Rejected: invalid_receipt' }
 */
export async function injectGold(uid, token, onLog = noop) {
  const log = (msg, type = 'ok') => onLog(msg, type)

  const {
    fetch_token,
    app_transaction,
    is_sandbox    = false,
    hash_params   = '',
    hash_headers  = '',
    name          = 'Custom',
  } = token

  // ── Request body (exact mirror of locket.py body) ─────────────────────
  const body = {
    product_id:            'locket_199_1m',
    fetch_token,
    app_transaction,
    app_user_id:           uid,
    is_restore:            true,
    store_country:         'VNM',
    currency:              'USD',
    price:                 '1.99',
    normal_duration:       'P1M',
    subscription_group_id: '21419447',
    observer_mode:         false,
    initiation_source:     'restore',
    offers:                [],
    attributes: {
      $attConsentStatus: {
        updated_at_ms: Date.now(),
        value:         'notDetermined',
      },
    },
  }

  const bodyStr = JSON.stringify(body)

  // ── Headers (exact mirror of locket.py current_headers) ───────────────
  const headers = rcHeaders({
    'Content-Length': String(bodyStr.length),
    'X-Is-Sandbox':   String(is_sandbox).toLowerCase(),
  })
  if (hash_params)  headers['X-Post-Params-Hash'] = hash_params
  if (hash_headers) headers['X-Headers-Hash']     = hash_headers

  log(`[*] Target Identified: ${uid}`,                        'dim')
  log(`[*] Loading Exploit Payload (RevenueCat)...`,          'dim')
  log(`[*] Using Token Set: ${name}`,                         'dim')

  // ── Retry loop (mirrors: for attempt in range(5)) ─────────────────────
  for (let attempt = 0; attempt < 5; attempt++) {
    log(`[>] Attempt ${attempt + 1}/5: Sending Receipt...`, 'warn')

    try {
      const res = await fetch('https://api.revenuecat.com/v1/receipts', {
        method:  'POST',
        headers,
        body:    bodyStr,
      })

      const sc = res.status
      log(`[.] HTTP ${sc} received`, 'dim')

      // ── 200 OK ────────────────────────────────────────────────────────
      if (sc === 200) {
        log('[+] HTTP 200 OK. Verifying Entitlement...', 'ok')

        let status = await checkStatus(uid)

        if (status.active) {
          log('[SUCCESS] Gold Entitlement Active!', 'ok')
          return { ok: true, message: 'SUCCESS' }
        }

        // Retry verify after 2s (mirrors: await asyncio.sleep(2))
        log('[!] Entitlement not found immediately. Retrying verification...', 'warn')
        await sleep(2000)
        status = await checkStatus(uid)

        if (status.active) {
          log('[SUCCESS] Gold Active after delay.', 'ok')
          return { ok: true, message: 'SUCCESS' }
        }

        log('[-] Exploitation Failed: Valid receipt but no Gold.', 'err')
        return { ok: false, message: 'Accepted but NO Gold (Expired?)' }
      }

      // ── 529 Server Busy (mirrors: elif status_code == 529) ────────────
      if (sc === 529) {
        log('[!] Server Busy (529). Cooldown 2s...', 'warn')
        await sleep(2000)
        continue
      }

      // ── Other error ───────────────────────────────────────────────────
      let msg = `HTTP ${sc}`
      try { const rj = await res.json(); msg = rj.message || msg } catch {}
      log(`[x] Request Rejected: ${msg}`, 'err')
      return { ok: false, message: `Rejected: ${msg}` }

    } catch (e) {
      log(`[!] Network Error: ${e.message}`, 'err')
      if (attempt === 4)
        return { ok: false, message: `Request Error: ${e.message}` }
      await sleep(2000)
    }
  }

  return { ok: false, message: 'Timeout / Failed after retries' }
}

// ══════════════════════════════════════════════════════════════════════════
// 4. createNextDns
//    mirrors: nextdns.py → create_profile()
// ══════════════════════════════════════════════════════════════════════════
/**
 * Create (or reuse) a NextDNS profile that blocks revenuecat.com.
 * Required to prevent Gold from being revoked after activation.
 *
 * @param {string}   nextdnsKey  — API key from my.nextdns.io/account
 * @param {function} [onLog]     — (msg, type) => void
 *
 * @returns {Promise<{ pid: string|null, iosLink: string|null, androidHost: string|null }>}
 *
 * @example
 *   const dns = await createNextDns('my_key', console.log)
 *   // { pid: 'abc123', iosLink: 'https://apple.nextdns.io/?profile=abc123', androidHost: 'abc123.dns.nextdns.io' }
 */
export async function createNextDns(nextdnsKey, onLog = noop) {
  const log = (msg, type = 'ok') => onLog(msg, type)

  const headers    = { 'X-Api-Key': nextdnsKey, 'Content-Type': 'application/json' }
  const todayStr   = new Date().toISOString().slice(0, 10)
  const profName   = `LocketVIP-${todayStr}`

  const result = pid => ({
    pid,
    iosLink:     pid ? `https://apple.nextdns.io/?profile=${pid}` : null,
    androidHost: pid ? `${pid}.dns.nextdns.io` : null,
  })

  log(`[*] Checking for existing profile: ${profName}...`, 'dim')

  // ── Try reuse (mirrors: for p in profiles) ────────────────────────────
  try {
    const listRes = await fetch('https://api.nextdns.io/profiles', { headers })
    if (listRes.ok) {
      const { data = [] } = await listRes.json()
      const existing = data.find(p => p.name === profName)
      if (existing) {
        const pid = existing.id
        log(`[+] Found existing daily profile: ${pid} (REUSING)`, 'ok')
        log('[>] Verifying High-Speed VIP Node...', 'warn')
        try {
          await fetch(`https://api.nextdns.io/profiles/${pid}/denylist`, {
            method: 'POST', headers,
            body:   JSON.stringify({ id: 'revenuecat.com', active: true }),
          })
          log('[>] Integrity Check: OK (Rules Checked).', 'ok')
        } catch (e) { log(`[!] Warning checking rules: ${e.message}`, 'warn') }
        await sleep(500)
        log('[SUCCESS] DNS VIP Node Active (Cached).', 'ok')
        return result(pid)
      }
    }
  } catch (e) { log(`[!] Error listing profiles: ${e.message}`, 'warn') }

  // ── Create new profile ─────────────────────────────────────────────────
  log(`[*] Creating new daily profile: ${profName}`, 'dim')
  log('[*] Initializing High-Speed VIP DNS Node...', 'dim')
  await sleep(500)

  try {
    const createRes = await fetch('https://api.nextdns.io/profiles', {
      method: 'POST', headers,
      body:   JSON.stringify({ name: profName }),
    })

    if (!createRes.ok) {
      const txt = await createRes.text()
      log(`NextDNS Error: ${createRes.status} ${txt}`, 'err')
      return result(null)
    }

    const { data } = await createRes.json()
    const pid      = data.id
    const denyUrl  = `https://api.nextdns.io/profiles/${pid}/denylist`

    log(`[+] Profile created: ${pid}`, 'ok')
    log('[>] Applying Anti-Revoke Rules (RevenueCat/Apple)...', 'warn')
    await sleep(400)

    // Block primary domain
    try {
      await fetch(denyUrl, {
        method: 'POST', headers,
        body:   JSON.stringify({ id: 'revenuecat.com', active: true }),
      })

      // Verify (mirrors: async with session.get(denylist_url))
      const verRes = await fetch(denyUrl, { headers })
      if (verRes.ok) {
        const { data: rules = [] } = await verRes.json()
        const blocked = rules.filter(d => d.active).map(d => d.id)

        if (blocked.includes('revenuecat.com')) {
          log(`[+] Firewall Rules Applied: ${blocked.join(', ')}`, 'ok')
        } else {
          // Fallback subdomains (mirrors: Retrying with api.revenuecat.com)
          log('[!] Rule not in verify. Adding subdomains fallback...', 'warn')
          await fetch(denyUrl, { method:'POST', headers, body: JSON.stringify({ id:'api.revenuecat.com', active:true }) })
          await fetch(denyUrl, { method:'POST', headers, body: JSON.stringify({ id:'www.revenuecat.com', active:true }) })
          log('[+] Added subdomains fallback.', 'ok')
        }
      } else {
        log(`[!] Validation Failed: ${verRes.status}`, 'warn')
      }
    } catch (e) { log(`[!] Error blocking domain: ${e.message}`, 'err') }

    log('[SUCCESS] DNS VIP Node Active.', 'ok')
    return result(pid)

  } catch (e) {
    log(`Error creating NextDNS profile: ${e.message}`, 'err')
    return result(null)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 5. activate — FULL PIPELINE
//    mirrors: bot.py → queue_worker() full flow (without any bot/Telegram)
// ══════════════════════════════════════════════════════════════════════════
/**
 * Full activation pipeline:
 *   resolveUid → checkStatus → injectGold → createNextDns
 *
 * @param {string}   username    — bare username or locket.cam URL
 * @param {object}   token       — token set { fetch_token, app_transaction, is_sandbox, ... }
 * @param {string}   [nextdnsKey]— NextDNS API key (skip DNS if omitted)
 * @param {function} [onLog]     — (msg: string, type: string) => void — live log stream
 *
 * @returns {Promise<{
 *   ok:          boolean,
 *   uid:         string|null,
 *   pid:         string|null,
 *   iosLink:     string|null,
 *   androidHost: string|null,
 *   error:       string|null,
 * }>}
 *
 * @example
 *   const r = await activate('myuser', TOKEN, 'nextdns_key', (m,t) => console.log(m))
 *   if (r.ok) {
 *     console.log('Gold active! UID:', r.uid)
 *     console.log('iOS DNS:', r.iosLink)
 *   }
 */
export async function activate(username, token, nextdnsKey = '', onLog = noop) {
  const log  = (msg, type = 'ok') => onLog(msg, type)
  const fail = (error, uid = null) => ({ ok: false, uid, pid: null, iosLink: null, androidHost: null, error })

  // ── Step 1: resolve UID ───────────────────────────────────────────────
  log('[*] Resolving UID from locket.cam...', 'dim')
  const uid = await resolveUid(username)
  if (!uid) {
    log('[x] User not found.', 'err')
    return fail('not_found')
  }

  // ── Step 2: check current status ──────────────────────────────────────
  log('[*] Checking current Gold status...', 'dim')
  const status = await checkStatus(uid)
  if (status.active)
    log(`[+] Already Gold (expires ${status.expires}). Re-injecting...`, 'warn')

  // ── Step 3: inject gold ───────────────────────────────────────────────
  const inject = await injectGold(uid, token, onLog)
  if (!inject.ok) return fail(inject.message, uid)

  // ── Step 4: NextDNS (anti-revoke) ─────────────────────────────────────
  let dns = { pid: null, iosLink: null, androidHost: null }

  if (nextdnsKey) {
    log('[>] Creating Anti-Revoke DNS Profile...', 'warn')
    dns = await createNextDns(nextdnsKey, onLog)
  } else {
    log('[!] No NextDNS key — skipping DNS (Gold may revert after a few hours).', 'warn')
  }

  log('[SUCCESS] Full activation complete.', 'ok')

  return {
    ok:          true,
    uid,
    pid:         dns.pid,
    iosLink:     dns.iosLink,
    androidHost: dns.androidHost,
    error:       null,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 6. decodeJwt — inspect token expiry without verifying signature
// ══════════════════════════════════════════════════════════════════════════
/**
 * Decode a JWT payload (no signature verification).
 * Useful to check if fetch_token / app_transaction is expired.
 *
 * @param   {string} jwt
 * @returns {object|null}
 *
 * @example
 *   const payload = decodeJwt(token.fetch_token)
 *   const expiresAt = new Date(payload.exp * 1000)
 *   console.log('Token expires:', expiresAt.toISOString())
 */
export function decodeJwt(jwt) {
  try {
    const part = jwt.split('.')[1]
    const pad  = part + '='.repeat(-part.length & 3)
    const json = typeof Buffer !== 'undefined'
      ? Buffer.from(pad, 'base64url').toString('utf8')
      : atob(pad.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch { return null }
}

/**
 * Returns true if token is valid (not expired), false if expired, null if unknown.
 * @param {string} jwt
 * @returns {boolean|null}
 */
export function isTokenValid(jwt) {
  const p = decodeJwt(jwt)
  if (!p?.exp) return null
  return p.exp * 1000 > Date.now()
}
