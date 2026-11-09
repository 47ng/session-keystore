import { b64, utf8 } from '@47ng/codec'
import { split, join } from './utility'

const hashPart = (sessionStorageHalf: string) =>
  sessionStorageHalf.split('.')[1]

test('Split / Join isomorphism', () => {
  const expected = 'Hello, World !'
  const [a, b] = split(expected)
  const received = join(a, b)
  expect(received).toEqual(expected)
})

test('split gives a new hash each time for the same secret', () => {
  const [, first] = split('Hello, World !')
  const [, second] = split('Hello, World !')
  expect(hashPart(first)).not.toEqual(hashPart(second))
})

test('split adds 32 random bytes to the window.name half', () => {
  const secret = 'Hello, World !'
  const [windowNameHalf] = split(secret)
  expect(b64.decode(windowNameHalf).length).toEqual(
    utf8.encode(secret).length + 32
  )
})

test('join rejects a changed window.name half', () => {
  const [windowNameHalf, sessionStorageHalf] = split('Hello, World !')
  const changed = b64.decode(windowNameHalf)
  changed[0] ^= 1
  expect(join(b64.encode(changed), sessionStorageHalf)).toBeNull()
})

test('join rejects a window.name half from another split', () => {
  const [, sessionStorageHalf] = split('Hello, World !')
  const [otherWindowNameHalf] = split('Hello, World !')
  expect(join(otherWindowNameHalf, sessionStorageHalf)).toBeNull()
})

test('join rejects a window.name half cut to the length of the data', () => {
  const secret = 'Hello, World !'
  const [windowNameHalf, sessionStorageHalf] = split(secret)
  const cut = b64.decode(windowNameHalf).slice(0, utf8.encode(secret).length)
  expect(join(b64.encode(cut), sessionStorageHalf)).toBeNull()
})

test('join rejects a sessionStorage half without a hash', () => {
  const [windowNameHalf, sessionStorageHalf] = split('Hello, World !')
  const [withoutHash] = sessionStorageHalf.split('.')
  expect(join(windowNameHalf, withoutHash)).toBeNull()
})
