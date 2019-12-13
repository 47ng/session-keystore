import React from 'react'
import { render } from 'react-dom'
import SessionKeystore from '../src'

const Demo = () => {
  const { 1: trigger } = React.useState(0)

  const store = React.useMemo(() => {
    return new SessionKeystore('demo', {
      onChanged: () => {
        console.log('onChanged')
        trigger(Math.random()) // Force re-render
      },
      onExpired: () => {
        console.log('onExpired')
        trigger(Math.random()) // Force re-render
      }
    })
  }, [])

  return (
    <>
      <button onClick={() => store.set('foo', Math.random().toString())}>
        Set key `foo`
      </button>
      <button onClick={() => store.set('bar', Math.random().toString())}>
        Set key `bar`
      </button>
      <button onClick={() => store.clear()}>Clear keys</button>
      <button onClick={() => location.reload()}>Reload</button>
      <button onClick={() => location.reload(true)}>Force reload</button>

      <pre>
        Key foo: {JSON.stringify(store.get('foo'))}
        <br />
        Key bar: {JSON.stringify(store.get('bar'))}
      </pre>
    </>
  )
}

render(<Demo />, document.getElementById('react-root'))
