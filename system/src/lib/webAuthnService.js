/**
 * Windows Hello (platform authenticator) via WebAuthn.
 * HTTPS 또는 localhost에서만 동작합니다.
 */

const CRED_STORE_KEY = 'auth.webauthn.creds.v1'

function readStore() {
  try {
    return JSON.parse(window.localStorage.getItem(CRED_STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeStore(data) {
  window.localStorage.setItem(CRED_STORE_KEY, JSON.stringify(data))
}

function toBase64Url(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  let str = ''
  bytes.forEach((b) => { str += String.fromCharCode(b) })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4)
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out.buffer
}

function randomChallenge(len = 32) {
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return buf.buffer
}

function rpId() {
  const host = window.location.hostname
  return host === '127.0.0.1' ? 'localhost' : host
}

export function isWebAuthnAvailable() {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && typeof navigator.credentials?.create === 'function'
    && typeof navigator.credentials?.get === 'function'
}

export async function isPlatformAuthenticatorAvailable() {
  if (!isWebAuthnAvailable()) return false
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    }
  } catch {
    return false
  }
  return true
}

function getStoredCred(employeeNo) {
  return readStore()[String(employeeNo)] || null
}

function saveCred(employeeNo, credentialId, publicKeyAlgo) {
  const store = readStore()
  store[String(employeeNo)] = {
    credentialId,
    publicKeyAlgo: publicKeyAlgo || null,
    registeredAt: new Date().toISOString(),
  }
  writeStore(store)
}

/**
 * Windows Hello 안면/PIN 인증.
 * 등록된 credential이 없으면 최초 등록(create) 후 성공 처리.
 */
export async function authenticateWithWindowsHello({ employeeNo, displayName }) {
  if (!isWebAuthnAvailable()) {
    throw new Error('이 브라우저는 Windows Hello(WebAuthn)를 지원하지 않습니다.')
  }
  const platformOk = await isPlatformAuthenticatorAvailable()
  if (!platformOk) {
    throw new Error('Windows Hello(플랫폼 인증기)를 사용할 수 없습니다. Windows Hello 설정을 확인해 주세요.')
  }

  const no = String(employeeNo)
  const stored = getStoredCred(no)
  const challenge = randomChallenge()

  if (stored?.credentialId) {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: rpId(),
          allowCredentials: [{
            type: 'public-key',
            id: fromBase64Url(stored.credentialId),
            transports: ['internal'],
          }],
          userVerification: 'required',
          timeout: 120000,
        },
      })
      if (!assertion) throw new Error('안면인증이 취소되었습니다.')
      return { ok: true, mode: 'assert', credentialId: stored.credentialId }
    } catch (err) {
      // credential 무효 시 재등록 시도
      if (err?.name === 'NotAllowedError') {
        throw new Error('안면인증이 취소되었거나 실패했습니다.')
      }
      // fall through to re-register
    }
  }

  const userId = new TextEncoder().encode(`kpi-${no}`.padEnd(16, '0').slice(0, 16))
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: '성과평가 자동화 Agent', id: rpId() },
      user: {
        id: userId,
        name: no,
        displayName: displayName || no,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
        requireResidentKey: false,
      },
      timeout: 120000,
      attestation: 'none',
    },
  })
  if (!credential) throw new Error('Windows Hello 등록이 취소되었습니다.')
  const credentialId = toBase64Url(credential.rawId)
  saveCred(no, credentialId)
  return { ok: true, mode: 'register', credentialId }
}
