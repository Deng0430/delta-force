const escapeHtml = (value: string) => value.replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))

/** 受限 Markdown 渲染：先转义，再处理常用语法和可定位元素引用。 */
export function renderTacticalMarkdown(source: string, noteImages: Record<string, string> = {}): string {
  let html = escapeHtml(source || '')
    .replace(/!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/|blob:|file:|note-image:|\/)[^)]+)\)/g, (_, alt, sourceUrl) => {
      const src = sourceUrl.startsWith('note-image:') ? noteImages[sourceUrl.slice(11)] : sourceUrl
      return src ? `<img class="tactical-note-image" src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />` : ''
    })
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\d+[.)]\s+(.+)$/gm, '<oli>$1</oli>')
    .replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
  html = html
    // 列表整体收敛为单行，避免后续无序列表规则再次匹配 <ol> 内部的 <li>。
    .replace(/(?:^<oli>.*<\/oli>\n?)+/gm, (items) => `<ol>${items.trim().replaceAll('<oli>', '<li>').replaceAll('</oli>', '</li>').replace(/\n/g, '')}</ol>`)
    .replace(/(?:^<li>.*<\/li>\n?)+/gm, (items) => `<ul>${items.trim().replace(/\n/g, '')}</ul>`)
  return html.split(/\n{2,}/).map((block) => /^(?:<h[1-3]>|<[ou]l>)/.test(block) ? block : `<p>${block.replace(/\n/g, '<br />')}</p>`).join('')
}
