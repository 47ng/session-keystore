import { expect, test, vi } from 'vitest'
import SK from './index.ts'

test('keeps keys in memory when sessionStorage is blocked', () => {
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
    throw new DOMException('Access denied', 'SecurityError')
  })
  const errors = vi.fn()
  window.addEventListener('error', errors)
  const store = new SK()
  store.set('foo', 'bar')
  window.dispatchEvent(new PageTransitionEvent('pagehide'))
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  expect(store.get('foo')).toEqual('bar')
  expect(errors).not.toHaveBeenCalled()
})
