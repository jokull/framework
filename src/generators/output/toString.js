const path = require('path')
const fs = require('fs-extra')

const marked = require('marked')
const fm = require('front-matter')
const deepmerge = require('deepmerge')
const NunjucksEnvironment = require('../../nunjucks')

const Tailwind = require('../tailwind')
const Transformers = require('../../transformers')

module.exports = async (str, options) => {
  try {
    if (str && str.length < 1) {
      throw RangeError('received empty string')
    }

    if (typeof str !== 'string') {
      throw TypeError(`first argument must be a string, received ${str}`)
    }

    const postCSS = options && options.tailwind && typeof options.tailwind.css === 'string' ? options.tailwind.css : '@tailwind utilities;'
    const tailwindConfig = options && options.tailwind && typeof options.tailwind.config === 'object' ? options.tailwind.config : null
    const maizzleConfig = options && options.maizzle && typeof options.maizzle.config === 'object' ? options.maizzle.config : null

    if (!maizzleConfig) {
      throw TypeError(`received invalid Maizzle config: ${maizzleConfig}`)
    }

    const frontMatter = fm(str)
    let html = frontMatter.body

    const config = maizzleConfig.isMerged ? maizzleConfig : deepmerge(maizzleConfig, frontMatter.attributes)
    let layout = config.layout || config.build.layout

    if (typeof options.afterConfig === 'function') {
      await options.afterConfig(config)
    }

    let compiledCSS = options.tailwind.compiled || null

    if (!compiledCSS) {
      if (!tailwindConfig) {
        throw TypeError(`received invalid Tailwind CSS config: ${tailwindConfig}`)
      }

      // replace : in css classes from body
      html = html.replace(/("|\s\w+?)(:)/g, '$1-')

      await fs.ensureFile(layout)
        .then(async () => {
          const tailwindHTML = await fs.readFile(path.resolve(process.cwd(), layout), 'utf8') + html
          tailwindConfig.separator = '-'
          compiledCSS = await Tailwind.fromString(postCSS, tailwindHTML, tailwindConfig, maizzleConfig).catch(err => { console.log(err); process.exit() })
        })
        .catch(err => {
          throw err
        })
    }

    marked.setOptions({
      renderer: new marked.Renderer(),
      ...config.markdown
    })

    const nunjucks = await NunjucksEnvironment.init()

    if (typeof options.beforeRender === 'function') {
      await options.beforeRender(nunjucks, config)
    }

    // make layout null if in node, just render html as it is... somehow...
    html = `{% extends "${layout}" %}\n${html}`
    html = nunjucks.renderString(html, { page: config, env: options.env, css: compiledCSS })

    while (fm(html).attributes.layout) {
      const front = fm(html)
      html = `{% extends "${front.attributes.layout}" %}\n{% block template %}${front.body}{% endblock %}`
      html = nunjucks.renderString(html, { page: config, env: options.env, css: compiledCSS })
    }

    html = html
      // replace \/ in class names from head
      .replace(/(\..+-)(\w+)(\\\/)/g, '$1$2-')
      // replace / in class names from body
      .replace(/(-\w+)(\/)(?<!(?:href=|src=|background[:=]).+)/g, '$1-')
      // replace \: in class names from head
      .replace(/(\.\w+)(\\:)/g, '$1-')
      // replace : in class names from body
      .replace(/(\w)(\s\w+)(:)(\w)/g, '$1$2-$4')

    if (typeof options.afterRender === 'function') {
      html = await options.afterRender(html, config)
    }

    html = await Transformers.process(html, config)

    if (typeof options.afterTransformers === 'function') {
      html = await options.afterTransformers(html, config)
    }

    return html
  } catch (error) {
    throw error
  }
}
