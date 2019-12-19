const { run } = require('../index')

jest.mock('yargs')
describe('main cli function', () => {
  it('returns a promise', () => {
    const result = run(['node-binary', 'script-path', 'cli', 'args', '--exist'])
    expect(typeof result.then).toEqual('function')
  })
})
