const write = require('write')
const sharp = require('sharp')
const fetch = require('node-fetch')

const svgGen = async (text, size, otherOptions = {}) => {
  const params = new URLSearchParams()
  const opts = Object.assign({}, otherOptions, { text, size })
  for (const p in opts) {
    params.append(p, opts[p])
  }
  const svgResponse = await fetch(
    `https://svgen-logo.jackmac92.now.sh/api/create?${params}`
  )
  const svgArrayBuffer = await svgResponse.arrayBuffer()
  return Buffer.from(svgArrayBuffer)
}

const svg2png = async (svg, sizes = [32]) => {
  for (const sz of sizes) {
    const png = await sharp(svg)
      .resize(sz, sz)
      .png()
      .toBuffer()
    await write(`./icons/icon-${sz}.png`, png)
  }
}

module.exports.svg2png = svg2png
module.exports.svgGen = svgGen
module.exports.run = async () => {
  const argv = require('yargs')
    .option('toPng', {
      type: 'array',
      description: 'A list of sizes to generate png logos'
    })
    .option('size', {
      describe: 'Dimension size for the logo',
      type: 'number',
      default: 200
    })
    .option('text', {
      describe: 'Text for the logo'
    })
    .demandOption(['text']).argv

  const svgContents = await svgGen(argv.text, argv.size)

  if (argv.toPng) {
    await svg2png(svgContents, argv.toPng)
  } else {
    await write('./icon.svg', svgContents)
  }
}
