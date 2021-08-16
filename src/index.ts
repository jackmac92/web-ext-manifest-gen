function main(argz) {
  return Promise.resolve().then(() => {
    console.log('Hello world!')
    console.dir(argz)
  })
}

module.exports.main = main

function getArgs(argv) {
  const args = require('yargs')
    .completion('completion', (_current, _argv, done) => {
      return Promise.resolve(['hello', 'world']).then(done)
    })
    .command('execute [action]', 'execute specified action', yargs => {
      yargs.positional('action', {
        describe: 'cli action',
        default: 'unknown'
      })
    })
    .command('modify [target]', 'invoke cli against target', yargs => {
      yargs.positional('target', {
        describe: 'cli target',
        default: 'unknown'
      })
    }).argv

  return Promise.resolve(args)
}

module.exports.getArgs = getArgs

module.exports.run = (...args) => getArgs(args).then(main)
