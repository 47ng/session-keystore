import React from 'react'
import { render } from 'react-dom'
import { useSessionKey } from './hooks'

const Demo = () => {
  const [foo, { set: setFoo, del: deleteFoo }] = useSessionKey('foo')
  const [bar, { set: setBar, del: deleteBar }] = useSessionKey('bar')

  return (
    <>
      <button onClick={() => setFoo(Math.random().toString())}>
        Set key `foo`
      </button>
      <button
        onClick={() => setBar(Math.random().toString(), Date.now() + 3000)}
      >
        Set key `bar`
      </button>
      <button
        onClick={() => {
          deleteFoo()
          deleteBar()
        }}
      >
        Clear keys
      </button>
      <button onClick={() => location.reload()}>Reload</button>
      <button onClick={() => location.reload(true)}>Force reload</button>
      <pre>
        Key foo: {JSON.stringify(foo)}
        <br />
        Key bar: {JSON.stringify(bar)}
      </pre>
    </>
  )
}

render(<Demo />, document.getElementById('react-root'))
