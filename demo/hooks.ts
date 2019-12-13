import React from 'react'
import SessionKeystore, { ConstructorOptions } from '../src/index'

export function useSessionKeystore<KeyNames = string>(
  options: ConstructorOptions<KeyNames> = {}
) {
  const store = React.useMemo(() => new SessionKeystore<KeyNames>(options), [
    options.name
  ])

  return {
    set: store.set.bind(store),
    get: store.get.bind(store),
    clear: store.clear.bind(store),
    del: store.delete.bind(store)
  }
}

export function useSessionKey(name: string) {
  const { set, get, del } = useSessionKeystore({
    name,
    onChanged: keyName => {
      const value = get(keyName)
      setInternalKeyState(value)
    },
    onExpired: () => {
      setInternalKeyState(null)
    }
  })
  const [key, setInternalKeyState] = React.useState<string | null>(get(name))

  return [
    key,
    {
      set: (value: string, expiresAt?: Date | number) => {
        set(name, value, expiresAt)
      },
      del: () => del(name)
    }
  ] as const
}
