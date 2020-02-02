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

const loadObjectFromWindowName = (): { [key: string]: string } => {
  if (!window.top.name || window.top.name === '') {
    return {}
  }
  try {
    return JSON.parse(window.top.name)
  } catch {}
  return {}
}

export const saveToWindowName = (name: string, data: string) => {
  const obj = loadObjectFromWindowName()
  obj[name] = data
  window.top.name = JSON.stringify(obj)
}

export const loadFromWindowName = (name: string) => {
  const saved = loadObjectFromWindowName()
  if (!(name in saved)) {
    return null
  }
  const { [name]: out, ...safe } = saved
  const json = JSON.stringify(safe)
  window.top.name = json === '{}' ? '' : json
  return out || null
}
