module.exports.run = function run(argv) {
  const args = require('yargs/yargs')(argv.slice(2))
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
