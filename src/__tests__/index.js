const { run } = require('../index')

describe('main cli function', () => {
  it('returns a promise', () => {
    const result = run(['node-binary', 'script-path', 'cli', 'args', '--exist'])
    expect(typeof result.then).toEqual('function')
  })
})
