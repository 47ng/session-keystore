import { split, saveToWindowName, loadFromWindowName, join } from './utility'

interface ExpirableKey {
  readonly key: string
  readonly expiresAt?: number // timestamp
}

export interface Callbacks<KeyName> {
  onAccess?: (keyName: KeyName, stackTrace?: string) => void
  onChanged?: (keyName: KeyName, stackTrace?: string) => void
  onExpired?: (keyName: KeyName) => void
}

export interface ConstructorOptions<KeyName> extends Callbacks<KeyName> {
  name?: string
}

type Store<KeyName> = Map<KeyName, ExpirableKey>

// --

const stores = new Map()

const getStore = <KeyName>(storageKey: string): Store<KeyName> => {
  return stores.get(storageKey)
}

export default class SessionKeystore<KeyName = string> {
  private _timeouts: Map<KeyName, any>
  private readonly _callbacks: Callbacks<KeyName>
  private readonly _storageKey: string

  constructor(options: ConstructorOptions<KeyName> = {}) {
    const { name, ...callbacks } = options
    this._storageKey = `session-keystore:${name || 'default'}`
    stores.set(this._storageKey, new Map())
    this._timeouts = new Map()
    this._callbacks = callbacks
    if (typeof window !== 'undefined') {
      try {
        this._load()
      } catch {}
      window.addEventListener('unload', this.persist.bind(this))
    }
  }

  public set(keyName: KeyName, key: string, expiresAt?: Date | number) {
    let d: number | undefined
    if (expiresAt) {
      d = typeof expiresAt === 'number' ? expiresAt : expiresAt.getTime()
    }
    const value: ExpirableKey = {
      key,
      expiresAt: d
    }
    this._clearTimeout(keyName)
    const oldKey = getStore(this._storageKey).get(keyName)
    getStore(this._storageKey).set(keyName, value)
    this._setTimeout(keyName)
    if (oldKey?.key !== key && this._callbacks.onChanged) {
      // Not actually an error, we just need the stack trace.
      const e = new Error('Key changed')
      this._callbacks.onChanged(keyName, e.stack)
    }
  }

  public get(keyName: KeyName, now = Date.now()) {
    const obj = getStore(this._storageKey).get(keyName)
    if (!obj) {
      return null
    }
    if (obj.expiresAt && obj.expiresAt < now) {
      this.delete(keyName)
      return null
    }
    if (this._callbacks.onAccess) {
      // Not actually an error, we just need the stack trace.
      const e = new Error('Key access')
      this._callbacks.onAccess(keyName, e.stack)
    }
    return obj.key
  }

  public delete(keyName: KeyName) {
    this._clearTimeout(keyName)
    getStore(this._storageKey).delete(keyName)
    if (this._callbacks.onExpired) {
      this._callbacks.onExpired(keyName)
    }
  }

  public clear() {
    getStore<KeyName>(this._storageKey).forEach((_, keyName) => {
      this.delete(keyName)
    })
  }

  // --

  public persist() {
    const json = JSON.stringify(
      Array.from(getStore(this._storageKey).entries())
    )
    const [a, b] = split(json)
    saveToWindowName(this._storageKey, a)
    window.sessionStorage.setItem(this._storageKey, b)
  }

  private _load() {
    const a = loadFromWindowName(this._storageKey)
    const b = window.sessionStorage.getItem(this._storageKey)
    window.sessionStorage.removeItem(this._storageKey)
    if (!a || !b) {
      return
    }
    const json = join(a, b)
    if (!json) {
      return
    }
    const entries = JSON.parse(json)
    stores.set(this._storageKey, new Map(entries))
    // Re-establish timeouts
    getStore<KeyName>(this._storageKey).forEach((_, keyName) => {
      this._setTimeout(keyName)
    })
  }

  private _setTimeout(keyName: KeyName) {
    this._clearTimeout(keyName)
    const key = getStore(this._storageKey).get(keyName)
    if (!key || !key.expiresAt) {
      return
    }
    const now = Date.now()
    const timeout = key.expiresAt - now
    if (timeout <= 0) {
      this.delete(keyName)
      return
    }
    const t = setTimeout(() => {
      this.delete(keyName)
    }, timeout)
    this._timeouts.set(keyName, t)
  }

  private _clearTimeout(keyName: KeyName) {
    const timeoutId = this._timeouts.get(keyName)
    clearTimeout(timeoutId)
    this._timeouts.delete(keyName)
  }
}
