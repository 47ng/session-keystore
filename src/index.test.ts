import SessionKeystore from './index'

describe('Node tests', () => {
  test('it should work in Node.js', () => {
    const store = new SessionKeystore()
    store.set('foo', 'foo')
    store.set('bar', 'bar')
    expect(store.get('foo')).toEqual('foo')
    store.delete('foo')
    expect(store.get('foo')).toEqual(null)
    expect(store.get('bar')).toEqual('bar')
    store.clear()
    expect(store.get('bar')).toEqual(null)
  })
})

test('key expiration', () => {
  jest.useFakeTimers()
  const onExpired = jest.fn()
  const store = new SessionKeystore({ onExpired })
  store.set('foo', 'foo', new Date().getTime() + 1000)
  jest.advanceTimersByTime(1000)
  expect(onExpired).toHaveBeenCalledWith('foo')
  expect(store.get('foo')).toBeNull()
})
