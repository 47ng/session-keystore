import { b64, utf8 } from '@47ng/codec'
import { hash } from '@stablelib/sha256'
import SK from './index'
import { split, join, saveToWindowName } from './utility'

let storeCount = 0
const uniqueName = () => `store-${++storeCount}`
const storageKey = (name: string) => `session-keystore:${name}`

function reloadPage(name: string) {
  const nameBeforeUnload = window.name
  window.dispatchEvent(new PageTransitionEvent('pagehide'))
  window.dispatchEvent(new Event('unload'))
  // Chromium applies window.name writes made during unload one navigation late
  window.name = nameBeforeUnload
  return new SK({ name })
}

function restoreFromBackForwardCache() {
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
}

function xorIntoWindowNameHalf(name: string, from: string, to: string) {
  const halves = JSON.parse(window.name)
  const half = b64.decode(halves[storageKey(name)])
  const [fromBytes, toBytes] = [utf8.encode(from), utf8.encode(to)]
  fromBytes.forEach((byte, i) => {
    half[i] ^= byte ^ toBytes[i]
  })
  halves[storageKey(name)] = b64.encode(half)
  window.name = JSON.stringify(halves)
}

function readPersistedJson(name: string) {
  const windowNameHalf = JSON.parse(window.name)[storageKey(name)]
  const sessionStorageHalf = window.sessionStorage.getItem(storageKey(name))
  return join(windowNameHalf, sessionStorageHalf!)
}

test('Store with default name', () => {
  const store = new SK()
  expect(store.name).toEqual('default')
})

test('Store with a name', () => {
  const store = new SK({ name: 'foo' })
  expect(store.name).toEqual('foo')
})

describe('Event handlers', () => {
  test('created/updated', () => {
    const store = new SK()
    const created = jest.fn()
    const updated = jest.fn()
    store.on('created', created)
    store.on('updated', updated)
    store.set('foo', 'bar')
    expect(created).toHaveBeenCalledTimes(1)
    expect(created.mock.calls[0][0]).toEqual({ name: 'foo' })
    expect(updated).not.toHaveBeenCalled()
    created.mockReset()
    updated.mockReset()
    store.set('foo', 'egg')
    expect(created).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)
    expect(updated.mock.calls[0][0]).toEqual({ name: 'foo' })
    created.mockReset()
    updated.mockReset()
    store.set('foo', 'egg') // Same value
    expect(created).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
  })

  test('read', () => {
    const store = new SK()
    const read = jest.fn()
    store.on('read', read)
    store.set('foo', 'bar')
    expect(read).not.toHaveBeenCalled()
    store.get('foo')
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0][0]).toEqual({ name: 'foo' })
  })

  test('deleted', () => {
    const store = new SK()
    const deleted = jest.fn()
    store.on('deleted', deleted)
    store.set('foo', 'bar')
    store.get('foo')
    expect(deleted).not.toHaveBeenCalled()
    store.delete('foo')
    expect(deleted).toHaveBeenCalledTimes(1)
    expect(deleted.mock.calls[0][0]).toEqual({ name: 'foo' })
  })

  test('expired', () => {
    const store = new SK()
    const expired = jest.fn()
    const deleted = jest.fn()
    store.on('expired', expired)
    store.on('deleted', deleted)
    const expirationDate = Date.now() + 1000
    store.set('foo', 'bar', expirationDate)
    store.get('foo', expirationDate - 100)
    expect(expired).not.toHaveBeenCalled()
    store.get('foo', expirationDate + 100)
    expect(expired).toHaveBeenCalledTimes(1)
    expect(expired.mock.calls[0][0]).toEqual({ name: 'foo' })
    expect(deleted).not.toHaveBeenCalled()
  })

  test('Unsubscribe via returned off callback', () => {
    const store = new SK()
    const read = jest.fn()
    const off = store.on('read', read)
    store.set('foo', 'bar')
    store.get('foo')
    off()
    store.get('foo')
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('Unsubscribe via off method', () => {
    const store = new SK()
    const read = jest.fn()
    store.on('read', read)
    store.set('foo', 'bar')
    store.get('foo')
    store.off('read', read)
    store.get('foo')
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('By default, this is not bound to the store', () => {
    const store = new SK()
    const nobind = jest.fn().mockReturnThis()
    const bind = jest.fn().mockReturnThis()
    store.on('created', nobind)
    store.on('created', bind.bind(store))
    store.set('foo', 'bar')
    expect(bind.mock.results[0].value).toEqual(store)
    expect(nobind.mock.results[0].value).toBeUndefined()
  })
})

test('Clear', () => {
  const store = new SK()
  const deleted = jest.fn()
  store.on('deleted', deleted)
  store.set('foo', 'bar')
  store.set('egg', 'spam')
  expect(store.get('foo')).toEqual('bar')
  expect(store.get('egg')).toEqual('spam')
  store.clear()
  expect(deleted).toHaveBeenCalledTimes(2)
  expect(deleted.mock.calls[0][0]).toEqual({ name: 'foo' })
  expect(deleted.mock.calls[1][0]).toEqual({ name: 'egg' })
  expect(store.get('foo')).toBeNull()
  expect(store.get('egg')).toBeNull()
})

test('Key expiration', () => {
  jest.useFakeTimers()
  const store = new SK()
  const expired = jest.fn()
  const deleted = jest.fn()
  store.on('expired', expired)
  store.on('deleted', deleted)
  store.set('foo', 'bar', Date.now() + 100)
  store.set('egg', 'qux', Date.now() + 200)
  jest.advanceTimersByTime(150)
  expect(expired).toHaveBeenCalledTimes(1)
  expect(expired.mock.calls[0][0]).toEqual({ name: 'foo' })
  expect(store.get('foo')).toBeNull()
  expect(store.get('egg')).toEqual('qux')
  expect(deleted).not.toHaveBeenCalled()
  jest.useRealTimers()
})

test('Set a key that already expired', () => {
  const store = new SK()
  const created = jest.fn()
  const expired = jest.fn()
  store.on('created', created)
  store.on('expired', expired)
  store.set('foo', 'bar', 0)
  expect(created).not.toHaveBeenCalled()
  expect(expired).toHaveBeenCalledTimes(1)
})

test('Persistence', () => {
  const storeA = new SK()
  storeA.set('foo', 'bar')
  storeA.persist()
  const storeB = new SK()
  expect(storeB.get('foo')).toEqual('bar')
})

describe('Persistence across page loads', () => {
  afterEach(() => {
    jest.useRealTimers()
    window.name = ''
  })

  test('restores keys after a reload', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })

  test('restores keys after several reloads without changes', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    reloadPage(name)
    reloadPage(name)
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })

  test('restores the latest value of an updated key', () => {
    const name = uniqueName()
    const store = new SK({ name })
    store.set('foo', 'bar')
    store.set('foo', 'egg')
    expect(reloadPage(name).get('foo')).toEqual('egg')
  })

  test('restores a new expiration date on an unchanged value', () => {
    const name = uniqueName()
    const expiresAt = Date.now() + 1000
    const store = new SK({ name })
    store.set('foo', 'bar')
    store.set('foo', 'bar', expiresAt)
    const reloaded = reloadPage(name)
    expect(reloaded.get('foo')).toEqual('bar')
    expect(reloaded.get('foo', expiresAt)).toBeNull()
  })

  test('forgets deleted keys', () => {
    const name = uniqueName()
    const store = new SK({ name })
    store.set('foo', 'bar')
    store.set('egg', 'spam')
    store.delete('foo')
    const reloaded = reloadPage(name)
    expect(reloaded.get('foo')).toBeNull()
    expect(reloaded.get('egg')).toEqual('spam')
  })

  test('does not persist expired keys', () => {
    jest.useFakeTimers()
    const name = uniqueName()
    const store = new SK({ name })
    store.set('foo', 'secret', Date.now() + 100)
    store.set('egg', 'spam')
    jest.advanceTimersByTime(150)
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(readPersistedJson(name)).not.toContain('secret')
  })

  test('forgets keys cleared while the page unloads', () => {
    const name = uniqueName()
    const store = new SK({ name })
    store.set('foo', 'bar')
    window.addEventListener('pagehide', () => store.clear(), { once: true })
    expect(reloadPage(name).get('foo')).toBeNull()
  })

  test('restores keys when persist() runs while the page unloads', () => {
    const name = uniqueName()
    const store = new SK({ name })
    store.set('foo', 'bar')
    window.addEventListener('pagehide', () => store.persist(), { once: true })
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })

  test('leaves window.name alone while the store is empty', () => {
    window.name = 'popup'
    new SK({ name: uniqueName() }).delete('missing')
    expect(window.name).toEqual('popup')
  })

  test('removes its window.name half once the store is empty', () => {
    const name = uniqueName()
    const store = new SK({ name })
    store.set('foo', 'bar')
    store.delete('foo')
    expect(window.name).not.toContain(storageKey(name))
  })

  test.each(['123', 'null', 'true', '"popup"', '[]'])(
    'works when window.name holds the JSON value %s',
    value => {
      window.name = value
      const name = uniqueName()
      const store = new SK({ name })
      store.set('foo', 'bar')
      expect(store.get('foo')).toEqual('bar')
      expect(reloadPage(name).get('foo')).toEqual('bar')
    }
  )

  test('forgets keys deleted after a failed write', () => {
    const name = uniqueName()
    const store = new SK<any>({ name })
    store.set('foo', 'bar')
    const circular: any = {}
    circular.self = circular
    expect(() => store.set(circular, 'value')).toThrow()
    expect(() => store.delete('foo')).toThrow()
    try {
      expect(reloadPage(name).get('foo')).toBeNull()
    } finally {
      store.delete(circular)
    }
  })

  test('keeps restored keys when another store with the same name starts', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    reloadPage(name)
    new SK({ name })
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })

  test('keeps keys when another store with the same name starts', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    new SK({ name })
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })

  test('keeps keys when an empty store with the same name comes back from the back/forward cache', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    new SK({ name })
    restoreFromBackForwardCache()
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })

  test('keeps stores with different names apart', () => {
    const nameA = uniqueName()
    const nameB = uniqueName()
    new SK({ name: nameA }).set('foo', 'a')
    new SK({ name: nameB }).set('foo', 'b')
    reloadPage(nameA)
    expect(reloadPage(nameA).get('foo')).toEqual('a')
    expect(reloadPage(nameB).get('foo')).toEqual('b')
  })

  test('restores the last change among stores sharing a name', () => {
    const name = uniqueName()
    const first = new SK({ name })
    const second = new SK({ name })
    second.set('foo', 'second')
    first.set('foo', 'first')
    expect(reloadPage(name).get('foo')).toEqual('first')
  })

  test('keeps the sessionStorage half out of storage while the page is live', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull()
    reloadPage(name)
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull()
  })

  test('forgets keys saved by version 1.0.3', () => {
    const name = uniqueName()
    const halvesFromVersion103 = {
      windowName: 'ndqT0N7slCiLowiqPnhjg2QxZSQX3t0ZLiWPRlRM1A==',
      sessionStorage: 'xoGxtrGDtgTwgX6IBElPoRJQCVFy_Oc7TET9ZCkRiQ=='
    }
    saveToWindowName(storageKey(name), halvesFromVersion103.windowName)
    window.sessionStorage.setItem(
      storageKey(name),
      halvesFromVersion103.sessionStorage
    )
    expect(new SK({ name }).get('foo')).toBeNull()
    expect(window.name).toEqual('')
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull()
  })

  test('forgets keys after another site changes the window.name half', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    xorIntoWindowNameHalf(
      name,
      '[["foo",{"v":1,"value":"bar"}]]',
      '[["foo",{"v":1,"value":"baz"}]]'
    )
    expect(new SK({ name }).get('foo')).toBeNull()
  })

  test('gives a disk reader no way to confirm a guess of the keys', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    const sessionStorageHalf = window.sessionStorage.getItem(storageKey(name))!
    const [encrypted] = sessionStorageHalf.split('.')
    const correctGuess = utf8.encode('[["foo",{"v":1,"value":"bar"}]]')
    const guessedWindowNameHalf = b64.encode(
      b64.decode(encrypted).map((byte, i) => byte ^ correctGuess[i])
    )
    const guessedHash = b64.encode(hash(utf8.encode(guessedWindowNameHalf)))
    expect(sessionStorageHalf).not.toContain(guessedHash)
  })

  test('removes the sessionStorage half when the page comes back from the back/forward cache', () => {
    const name = uniqueName()
    new SK({ name }).set('foo', 'bar')
    restoreFromBackForwardCache()
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull()
    expect(reloadPage(name).get('foo')).toEqual('bar')
  })
})

test('v0 to v1 conversion', () => {
  const future = Date.now() + 1000
  const json = JSON.stringify([['foo', { key: 'bar', expiresAt: future }]])
  const [a, b] = split(json)
  const storageKey = 'session-keystore:default'
  saveToWindowName(storageKey, a)
  window.sessionStorage.setItem(storageKey, b)
  const store = new SK()
  expect(store.get('foo')).toEqual('bar')
  expect(store.get('foo', future)).toBeNull()
})

test('Expiration date', () => {
  const future = new Date(Date.now() + 1000)
  const store = new SK()
  store.set('foo', 'bar', future)
  expect(store.get('foo')).toEqual('bar')
  expect(store.get('foo', future.valueOf())).toBeNull()
})
