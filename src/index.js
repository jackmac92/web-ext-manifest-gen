const fs = require('fs')
const path = require('path')

const appRootPath = process.cwd()

const isCodeFile = file =>
  ['.js', '.ts', '.jsx', '.tsx'].some(ext => file.endsWith(ext))

const listFiles = folder =>
  fs
    .readdirSync(folder)
    .filter(
      file => isCodeFile(file) && fs.lstatSync(path.join(folder, file)).isFile()
    )

const getUrlMatches = scriptPath => {
  const scriptModuleLines = fs
    .readFileSync(`./${scriptPath}`, 'utf8')
    .split('\n')
  if (scriptModuleLines[0].includes('matches')) {
    let isCollectionMatchesLines = true
    return scriptModuleLines.slice(1).reduce((acc, el) => {
      if (!el.startsWith('//')) {
        isCollectionMatchesLines = false
      }
      if (!isCollectionMatchesLines) {
        return acc
      }
      return [...acc, el.replace('//', '').trim()]
    }, [])
  } else {
    console.warn('No match urls listed, so matching against all urls')
    return ['*://*/*']
  }
}

const autoGenContentScripts = contentScriptsDir =>
  listFiles(contentScriptsDir).map(s => {
    const scriptPath = path.join(contentScriptsDir, s)
    const matches = getUrlMatches(scriptPath)
    return { matches, js: [`./${scriptPath}`] }
  })

module.exports.run = () =>
  new Promise((resolve, reject) => {
    if (!fs.existsSync(`${appRootPath}/package.json`)) {
      console.error('Please run from the root of your npm project')
      console.error('No package.json found!!')
      process.exit(1)
    }
    const {
      name: pkgName,
      version,
      description
    } = require(`${appRootPath}/package.json`)
    // TODO copy autogen permissions setup from that rollup lib
    // TODO handle optional permissions
    // TODO handle content_security_policy
    // TODO handle icons
    // handle browser actions
    const argv = require('yargs')
      .usage('Usage: $0 -s [injectScriptsDir] -p [permission]')
      .option('scripts', {
        alias: 's',
        describe: 'path to content scripts'
      })
      .option('devTools', {
        describe: 'path to dev-tools html'
      })
      .option('template', {
        alias: 't',
        describe:
          'path to an existing manifest file which should be used for supplementary keys (will be overriden)'
      })
      .option('backgroundScripts', {
        type: 'array',
        describe: 'path to background file, multiple entries allowed'
      })
      .option('permission', {
        alias: 'p',
        describe: 'permission to include in manifest'
      })
      .demandOption(['scripts']).argv
    const injectScriptsDir = argv.scripts
    const manifestBase = JSON.parse(fs.readFileSync(argv.template)) || {}
    const manifest = Object.assign({}, manifestBase, {
      name: pkgName,
      version,
      description,
      manifest_version: 2,
      permissions: ['activeTab'],
      content_scripts: autoGenContentScripts(injectScriptsDir)
    })
    if (argv.devTools) {
      manifest.devtools_page = argv.devTools
    }
    if (argv.backgroundScripts) {
      manifest.background = {
        scripts: argv.backgroundScripts,
        persistent: true
      }
    }
    if (argv.permissions) {
      throw Error('permissions flag is UNIMPLEMENTED (whoopsie)')
    }
    try {
      fs.writeFileSync(
        `${appRootPath}/manifest.json`,
        JSON.stringify(manifest, null, 4)
      )
    } catch (e) {
      reject(e)
    }
    resolve()
  })
