import { split, join } from './utility'

test('Split / Join isomorphism', () => {
  const expected = 'Hello, World !'
  const [a, b] = split(expected)
  const received = join(a, b)
  expect(received).toEqual(expected)
})
