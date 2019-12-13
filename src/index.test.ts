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
