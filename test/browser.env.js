const Environment = require('jest-environment-jsdom')
const crypto = require('crypto')

/**
 * JSDOM does not include TextEncoder / TextDecoder by default
 */
module.exports = class CustomTestEnvironment extends Environment {
  async setup() {
    await super.setup()
    if (typeof this.global.TextEncoder === 'undefined') {
      const { TextEncoder } = require('util')
      this.global.TextEncoder = TextEncoder
    }
    if (typeof this.global.TextDecoder === 'undefined') {
      const { TextDecoder } = require('util')
      this.global.TextDecoder = TextDecoder
    }

    this.global.window.crypto = {
      getRandomValues: buffer => {
        return crypto.randomBytes(buffer.byteLength)
      }
    }
  }
}
