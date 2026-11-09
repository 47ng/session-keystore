import { b64, utf8 } from '@47ng/codec'

const randomBytes = (length: number): Uint8Array => {
  if (typeof window === 'undefined') {
    const crypto = require('crypto') // Node.js crypto module
    return crypto.randomBytes(length)
  } else {
    return window.crypto.getRandomValues(new Uint8Array(length))
  }
}

export const split = (secret: string): string[] => {
  const buff = utf8.encode(secret)
  const rand1 = randomBytes(buff.length)
  const rand2 = new Uint8Array(rand1) // Make a copy
  for (const i in buff) {
    rand2[i] = rand2[i] ^ buff[i]
  }
  return [b64.encode(rand1), b64.encode(rand2)]
}

export const join = (a: string, b: string) => {
  if (a.length !== b.length) {
    return null
  }
  const aBuff = b64.decode(a)
  const bBuff = b64.decode(b)
  const output = new Uint8Array(aBuff.length)
  for (const i in output) {
    output[i] = aBuff[i] ^ bBuff[i]
  }
  return utf8.decode(output)
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
