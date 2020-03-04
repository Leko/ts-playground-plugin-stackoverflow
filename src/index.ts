import type { Diagnostic, FormatDiagnosticsHost } from 'typescript'
import type { PlaygroundPlugin, PluginUtils } from "./vendor/playground"

const EOL = '\n'

function getRelatedPosts(keyword: string) {
  // https://api.stackexchange.com/docs/search
  const endpoint = 'https://api.stackexchange.com/2.2/search/advanced'
  const query = new URLSearchParams()
  query.set('site', 'stackoverflow')
  query.set('sort', 'votes')
  query.set('order', 'desc')
  query.set('accepted', 'True')
  query.set('pagesize', '10')
  query.set('q', 'typescript ' + keyword)
  return fetch(`${endpoint}?${query.toString()}`).then(res => res.json()).then(res => res.items)
}

function formatErroredCode(code: string, diagnostic: Diagnostic): string {
  const lineNumber = code.slice(0, diagnostic.start).split(EOL).length
  const lineStarts = code.lastIndexOf(EOL, diagnostic.start) + 1
  const lineEnds = code.indexOf(EOL, diagnostic.start)
  const line = code.slice(lineStarts, lineEnds)
  const offset = diagnostic.start - lineStarts
  const underline = ' '.repeat(String(lineNumber).length) + '  ' + ' '.repeat(offset) + '^'.repeat(diagnostic.length)
  return `${lineNumber}: ${line}\n${underline}`
}

const formatDiagnosticHost: FormatDiagnosticsHost = {
  getCurrentDirectory() {
    return ''
  },
  getCanonicalFileName(fileName: string) {
    return fileName
  },
  getNewLine() {
    return EOL
  }
}

export default (utils: PluginUtils): PlaygroundPlugin => {
  let postListContainer: HTMLDivElement

  return {
    id: 'plugin-stackoverflow',
    displayName: 'Stack overflow',
    shouldBeSelected: () => true,

    didMount(_sandbox, container) {
      utils.el('StackOverflow post similar to these errors', 'h4', container)
      postListContainer = document.createElement('div')
      container.append(postListContainer)
    },

    modelChangedDebounce(sandbox, model) {
      if (!postListContainer) {
        return
      }

      const { ts } = sandbox
      const statusContainer = document.createElement('pre')
      postListContainer.textContent = ''
      postListContainer.append(statusContainer)

      if (!sandbox.getText()) {
        statusContainer.textContent = 'No errors!!'
        return
      }
      statusContainer.textContent = 'Just minutes...'

      Promise.all([
        sandbox.getWorkerProcess()
      ]).then(([worker]) =>
        Promise.all([
          worker.getSemanticDiagnostics(model.uri.toString()),
          worker.getSyntacticDiagnostics(model.uri.toString()),
        ])
      )
        .then(([semanticDiagnostics, syntacticDiagnostics]) =>
          semanticDiagnostics.concat(syntacticDiagnostics)
        )
        .then(diagnostics => {
          if (diagnostics.length === 0) {
            statusContainer.textContent = 'No errors!!'
            return
          }

          statusContainer.textContent = 'Fetching posts...'

          const text = sandbox.getText()
          return Promise.all(diagnostics.map(d => {
            const similarPostsContainer = document.createElement('div')
            const errorContainer = document.createElement('pre')
            const erroredCode = formatErroredCode(text, d)
            const errorMessage = ts.formatDiagnostic(d, formatDiagnosticHost)
            errorContainer.textContent = erroredCode + '\n' + errorMessage
            errorContainer.style.whiteSpace = 'break-spaces'
            similarPostsContainer.append(errorContainer)

            return getRelatedPosts(d.messageText.toString()).then(relatedPosts => {
              const elements = relatedPosts.map(relatedPost => {
                const li = document.createElement('li')
                const a = document.createElement('a')
                a.target = '_blank'
                a.rel = 'noopener'
                a.href = relatedPost.link
                a.textContent = relatedPost.title
                li.append(a)
                return li
              })
              similarPostsContainer.append(...elements)
              return similarPostsContainer
            })
          }))
        })
        .then(similarPostsList => {
          postListContainer.append(...similarPostsList)
          postListContainer.removeChild(statusContainer)
        })
        .catch(e => {
          statusContainer.style.backgroundColor = 'oldlace'
          statusContainer.style.color = 'crimson'
          statusContainer.textContent = e.stack
        })
    },
  }
}
