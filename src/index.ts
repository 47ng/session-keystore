import { split, saveToWindowName, loadFromWindowName, join } from './utility'

interface ExpirableKey {
  key: string
  expiresAt?: number // timestamp
}

export interface Spies<KeyName> {
  onAccess?: (keyName: KeyName, stackTrace?: string) => void
  onExpired?: (keyName: KeyName) => void
}

const stores = new Map()

type Store<KeyName> = Map<KeyName, ExpirableKey>

const getStore = <KeyName>(storageKey: string): Store<KeyName> => {
  return getStore(storageKey)
}

export default class SessionKeystore<KeyName = string> {
  // private _store: Map<KeyName, ExpirableKey>
  private _timeouts: Map<KeyName, number>
  private _spies: Map<KeyName, Spies<KeyName>>
  private readonly _storageKey: string

  constructor(name: string = 'default') {
    this._storageKey = `session-keystore:${name}`
    stores.set(this._storageKey, new Map())
    this._timeouts = new Map()
    this._spies = new Map()
    try {
      this._load()
    } catch {}
    window.addEventListener('unload', this._save.bind(this))
  }

  public set(
    keyName: KeyName,
    key: string,
    expiresAt?: Date | number,
    spies: Spies<KeyName> = {}
  ) {
    let d: number | undefined
    if (expiresAt) {
      d = typeof expiresAt === 'number' ? expiresAt : expiresAt.getTime()
    }
    const value: ExpirableKey = {
      key,
      expiresAt: d
    }
    this._clearTimeout(keyName)
    getStore(this._storageKey).set(keyName, value)
    this._spies.set(keyName, spies)
    this._setTimeout(keyName)
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
    const spies = this._spies.get(keyName)
    if (spies && spies.onAccess) {
      // Not actually an error,
      // we just need the stack trace.
      const e = new Error('Key access')
      spies.onAccess(keyName, e.stack)
    }
    return obj.key
  }

  public delete(keyName: KeyName) {
    this._clearTimeout(keyName)
    getStore(this._storageKey).delete(keyName)
    const spies = this._spies.get(keyName)
    if (spies && spies.onExpired) {
      spies.onExpired(keyName)
    }
  }

  public clear() {
    getStore<KeyName>(this._storageKey).forEach((_, keyName) => {
      this.delete(keyName)
    })
  }

  // --

  private _save() {
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
    const t = window.setTimeout(() => {
      this.delete(keyName)
    }, timeout)
    this._timeouts.set(keyName, t)
  }

  private _clearTimeout(keyName: KeyName) {
    const timeoutId = this._timeouts.get(keyName)
    window.clearTimeout(timeoutId as number)
    this._timeouts.delete(keyName)
  }
}
