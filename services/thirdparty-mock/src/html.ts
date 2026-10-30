// Tiny server-rendered pages. Links are RELATIVE because the Gateway serves this app under a
// path prefix (https://eshop.localhost/thirdparty-mock/...), so an absolute "/x" would escape it.

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function page(title: string, body: string, options: { refreshSeconds?: number } = {}): string {
  const refresh = options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : ''
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>${escapeHtml(title)} · thirdparty-mock</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
  body { max-width: 720px; margin: 0 auto; padding: 1rem; }
  header { display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap; border-bottom: 1px solid #8884; margin-bottom: 1rem; }
  header strong { font-size: 1.1rem; }
  section { border: 1px solid #8884; border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 1rem; }
  h2 { font-size: 1rem; margin: 0 0 0.5rem; font-family: ui-monospace, monospace; }
  ol { margin: 0; padding-left: 1.25rem; }
  li { margin-bottom: 0.4rem; }
  time { color: #888; font-size: 0.85rem; margin-right: 0.5rem; }
  input, button { font: inherit; min-height: 44px; padding: 0 0.75rem; }
  .muted { color: #888; }
</style>
</head>
<body>
<header><strong>thirdparty-mock</strong><span class="muted">test equipment, not a real third party</span></header>
${body}
</body>
</html>`
}
