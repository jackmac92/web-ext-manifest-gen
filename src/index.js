const fs = require('fs')
const write = require('write')
const path = require('path')
const appRootPath = require('app-root-path')

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

module.exports.run = async () => {
  if (!fs.existsSync(`${appRootPath}/package.json`)) {
    console.error('Please run from an npm project')
    console.error('No package.json found!!')
    process.exit(1)
  }
  const {
    name: pkgName,
    version,
    description
  } = require(`${appRootPath}/package.json`)
  // TODO copy autogen permissions setup from that rollup lib
  // TODO handle content_security_policy
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
    .option('persistentBackground', {
      type: 'boolean',
      default: true,
      describe:
        'Persistent background script? Necessary for things like background websocket connections'
    })
    .option('locale', {
      describe: 'path to background file, multiple entries allowed',
      default: 'en'
    })
    .option('permissions', {
      alias: 'p',
      type: 'array',
      describe: 'permissions to include in manifest',
      default: ['activeTab']
    })
    .option('optionalPermissions', {
      type: 'array',
      describe: 'optional-permissions to include in manifest'
    })
    .demandOption(['scripts']).argv
  const injectScriptsDir = argv.scripts

  const easilyOverridableDefaults = {
    permissions: [],
    optional_permissions: [],
    version,
    description,
    browser_action: {
      default_title: pkgName
    }
  }
  const manifestBase = (() => {
    try {
      const fileContents = fs.readFileSync(argv.template)
      return JSON.parse(fileContents)
    } catch (e) {
      console.warn('Failed to parse a tempalte manifest, using empty object!')
      return {}
    }
  })()
  const manifest = Object.assign({}, easilyOverridableDefaults, manifestBase, {
    manifest_version: 2,
    default_locale: argv.locale,
    name: pkgName,
    content_scripts: autoGenContentScripts(injectScriptsDir)
  })

  if (argv.devTools) {
    manifest.devtools_page = argv.devTools
  }
  if (argv.backgroundScripts) {
    manifest.background = {
      scripts: argv.backgroundScripts,
      persistent: argv.persistentBackground
    }
  }
  if (argv.optionalPermissions) {
    argv.optionalPermissions.forEach(perm => {
      if (!manifest['optional_permissions'].includes(perm)) {
        manifest['optional_permissions'].push(perm)
      }
    })
  }

  argv.permissions.forEach(perm => {
    if (!manifest.permissions.includes(perm)) {
      manifest.permissions.push(perm)
    }
  })
  await write('./manifest.json', JSON.stringify(manifest, null, 4))
}
