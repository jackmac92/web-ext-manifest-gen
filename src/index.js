const fs = require('fs')
const path = require('path')
const { name: pkgName, version, description } = require('./package.json')

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
    return { matches, js: `./${scriptPath}` }
  })

const injectScriptsDir = './src/injectedScripts'

console.log(`Looking in ${injectScriptsDir} for web-ext content scripts`)

module.exports.run = () => {
  fs.writeFileSync(
    './manifest.json',
    JSON.stringify(
      {
        name: pkgName,
        version,
        description,
        manifest_version: 2,
        permissions: process.env.WEB_EXT_PERMISSIONS,
        content_scripts: autoGenContentScripts(injectScriptsDir)
      },
      null,
      4
    )
  )

  console.log('Wrote Manifest Successfully')
}
