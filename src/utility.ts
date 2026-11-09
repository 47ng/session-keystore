import { b64, utf8 } from '@47ng/codec'
import { hash } from '@stablelib/sha256'

const randomBytes = (length: number): Uint8Array => {
  if (typeof window === 'undefined') {
    const crypto = require('crypto') // Node.js crypto module
    return crypto.randomBytes(length)
  } else {
    return window.crypto.getRandomValues(new Uint8Array(length))
  }
}

const SALT_LENGTH = 32

const hashOf = (windowNameHalf: string) =>
  b64.encode(hash(utf8.encode(windowNameHalf)))

const xor = (data: Uint8Array, pad: Uint8Array) =>
  new Uint8Array(data).map((byte, i) => byte ^ pad[i])

export const split = (secret: string): [string, string] => {
  const data = utf8.encode(secret)
  const pad = randomBytes(data.length + SALT_LENGTH)
  const windowNameHalf = b64.encode(pad)
  const encrypted = b64.encode(xor(data, pad))
  return [windowNameHalf, `${encrypted}.${hashOf(windowNameHalf)}`]
}

export const join = (windowNameHalf: string, sessionStorageHalf: string) => {
  const [encrypted, expectedHash] = sessionStorageHalf.split('.')
  if (expectedHash !== hashOf(windowNameHalf)) {
    return null
  }
  return utf8.decode(xor(b64.decode(encrypted), b64.decode(windowNameHalf)))
}

// --

export const canPersist = () => {
  try {
    window.top.name
    window.sessionStorage
    return true
  } catch {
    return false
  }
}

const loadObjectFromWindowName = (): { [key: string]: string } => {
  try {
    const saved = JSON.parse(window.top.name)
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return saved
    }
  } catch {}
  return {}
}

export const saveToWindowName = (name: string, data: string) => {
  const obj = loadObjectFromWindowName()
  obj[name] = data
  window.top.name = JSON.stringify(obj)
}

export const readFromWindowName = (name: string) =>
  loadObjectFromWindowName()[name] ?? null

export const removeFromWindowName = (name: string) => {
  const saved = loadObjectFromWindowName()
  if (!(name in saved)) {
    return
  }
  delete saved[name]
  const json = JSON.stringify(saved)
  window.top.name = json === '{}' ? '' : json
}
