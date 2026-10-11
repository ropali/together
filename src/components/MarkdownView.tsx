import React, { type ReactNode } from 'react'

interface MarkdownViewProps {
  content: string
  className?: string
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^(https?:|\/|#|mailto:)/i.test(trimmed)) {
    return trimmed
  }
  return '#'
}

function parseInline(text: string, keyPrefix = ''): ReactNode[] {
  if (!text) return []

  const pattern = /(`[^`\n]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let count = 0

  while ((match = pattern.exec(text)) !== null) {
    const matchIndex = match.index
    const matchedStr = match[0]

    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex))
    }

    const key = `${keyPrefix}-${count++}`

    if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      const code = matchedStr.slice(1, -1)
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-surface-container-high font-mono text-[12px] text-primary font-semibold border border-outline-variant/30"
        >
          {code}
        </code>,
      )
    } else if (matchedStr.startsWith('***') && matchedStr.endsWith('***')) {
      const inner = matchedStr.slice(3, -3)
      nodes.push(
        <strong key={key} className="font-bold text-on-surface">
          <em className="italic">{parseInline(inner, key)}</em>
        </strong>,
      )
    } else if (
      (matchedStr.startsWith('**') && matchedStr.endsWith('**')) ||
      (matchedStr.startsWith('__') && matchedStr.endsWith('__'))
    ) {
      const inner = matchedStr.slice(2, -2)
      nodes.push(
        <strong key={key} className="font-bold text-on-surface">
          {parseInline(inner, key)}
        </strong>,
      )
    } else if (matchedStr.startsWith('~~') && matchedStr.endsWith('~~')) {
      const inner = matchedStr.slice(2, -2)
      nodes.push(
        <del key={key} className="line-through text-outline">
          {parseInline(inner, key)}
        </del>,
      )
    } else if (
      (matchedStr.startsWith('*') && matchedStr.endsWith('*')) ||
      (matchedStr.startsWith('_') && matchedStr.endsWith('_'))
    ) {
      const inner = matchedStr.slice(1, -1)
      nodes.push(
        <em key={key} className="italic">
          {parseInline(inner, key)}
        </em>,
      )
    } else if (matchedStr.startsWith('[') && matchedStr.includes('](')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(matchedStr)
      if (linkMatch) {
        const linkText = linkMatch[1]
        const linkUrl = sanitizeUrl(linkMatch[2])
        nodes.push(
          <a
            key={key}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary-container inline-flex items-center gap-0.5 break-all"
            onClick={(e) => e.stopPropagation()}
          >
            <span>{parseInline(linkText, key)}</span>
            <span className="material-symbols-outlined text-[12px] inline select-none opacity-70">open_in_new</span>
          </a>,
        )
      } else {
        nodes.push(matchedStr)
      }
    } else if (matchedStr.startsWith('http://') || matchedStr.startsWith('https://')) {
      const safeUrl = sanitizeUrl(matchedStr)
      nodes.push(
        <a
          key={key}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary-container inline-flex items-center gap-0.5 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          <span>{matchedStr}</span>
          <span className="material-symbols-outlined text-[12px] inline select-none opacity-70">open_in_new</span>
        </a>,
      )
    } else {
      nodes.push(matchedStr)
    }

    lastIndex = matchIndex + matchedStr.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export function MarkdownView({ content, className = '' }: MarkdownViewProps) {
  if (!content) return null

  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let blockKey = 0

  while (i < lines.length) {
    const line = lines[i]

    // Empty line
    if (!line.trim()) {
      i++
      continue
    }

    // 1. Fenced Code Block: ```
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing ```
      blocks.push(
        <div key={blockKey++} className="my-2 rounded-xl bg-surface-container-high/90 p-3 font-mono text-xs overflow-x-auto border border-outline-variant/30 select-text">
          {lang && (
            <div className="text-[10px] text-outline uppercase tracking-wider font-semibold mb-1 pb-1 border-b border-outline-variant/20">
              {lang}
            </div>
          )}
          <pre className="m-0 leading-relaxed text-on-surface">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>,
      )
      continue
    }

    // 2. Horizontal Rule: --- or *** or ___
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={blockKey++} className="my-2 border-outline-variant/40" />)
      i++
      continue
    }

    // 3. Headings: #, ##, ###, ####
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line.trim())
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingText = headingMatch[2]
      if (level === 1) {
        blocks.push(
          <h1 key={blockKey++} className="font-headline-sm text-base font-bold text-on-surface mt-2 mb-1">
            {parseInline(headingText, `h1-${blockKey}`)}
          </h1>,
        )
      } else if (level === 2) {
        blocks.push(
          <h2 key={blockKey++} className="font-headline-sm text-sm font-bold text-on-surface mt-1.5 mb-1">
            {parseInline(headingText, `h2-${blockKey}`)}
          </h2>,
        )
      } else if (level === 3) {
        blocks.push(
          <h3 key={blockKey++} className="font-headline-sm text-xs font-semibold text-on-surface mt-1 mb-0.5">
            {parseInline(headingText, `h3-${blockKey}`)}
          </h3>,
        )
      } else {
        blocks.push(
          <h4 key={blockKey++} className="font-headline-sm text-xs font-semibold text-on-surface-variant mt-1 mb-0.5">
            {parseInline(headingText, `h4-${blockKey}`)}
          </h4>,
        )
      }
      i++
      continue
    }

    // 4. Blockquote: >
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote
          key={blockKey++}
          className="my-1.5 pl-3 border-l-2 border-primary/60 text-on-surface-variant italic bg-surface-container-low/50 py-1 rounded-r-lg text-sm"
        >
          {quoteLines.map((q, idx) => (
            <div key={idx}>{parseInline(q, `quote-${blockKey}-${idx}`)}</div>
          ))}
        </blockquote>,
      )
      continue
    }

    // 5. Checklist or Unordered List: - [ ] or - [x] or - item or * item
    if (/^\s*([-*+])\s+(\[[ xX]\]\s+)?/.test(line)) {
      const listItems: ReactNode[] = []
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        const itemLine = lines[i].replace(/^\s*([-*+])\s+/, '')
        const taskMatch = /^\[([ xX])\]\s+(.+)$/.exec(itemLine)
        if (taskMatch) {
          const checked = taskMatch[1].toLowerCase() === 'x'
          const itemText = taskMatch[2]
          listItems.push(
            <li key={listItems.length} className="flex items-start gap-2 list-none my-0.5 text-sm">
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mt-1 h-3.5 w-3.5 rounded border-outline-variant text-primary accent-primary pointer-events-none shrink-0"
              />
              <span className={checked ? 'line-through text-outline' : 'text-on-surface'}>
                {parseInline(itemText, `task-${blockKey}-${listItems.length}`)}
              </span>
            </li>,
          )
        } else {
          listItems.push(
            <li key={listItems.length} className="list-disc ml-5 text-sm text-on-surface leading-relaxed">
              {parseInline(itemLine, `li-${blockKey}-${listItems.length}`)}
            </li>,
          )
        }
        i++
      }
      blocks.push(
        <ul key={blockKey++} className="my-1.5 space-y-0.5 pl-0">
          {listItems}
        </ul>,
      )
      continue
    }

    // 6. Ordered List: 1. item
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemLine = lines[i].replace(/^\s*\d+\.\s+/, '')
        listItems.push(
          <li key={listItems.length} className="list-decimal ml-5 text-sm text-on-surface leading-relaxed">
            {parseInline(itemLine, `oli-${blockKey}-${listItems.length}`)}
          </li>,
        )
        i++
      }
      blocks.push(
        <ol key={blockKey++} className="my-1.5 space-y-0.5 pl-0">
          {listItems}
        </ol>,
      )
      continue
    }

    // 7. Regular Paragraph (gather consecutive non-block lines)
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^\s*([-*+])\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }

    blocks.push(
      <p key={blockKey++} className="my-1 leading-relaxed text-on-surface break-words">
        {paraLines.map((pLine, pIdx) => (
          <React.Fragment key={pIdx}>
            {parseInline(pLine, `para-${blockKey}-${pIdx}`)}
            {pIdx < paraLines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>,
    )
  }

  return <div className={`markdown-body space-y-1 ${className}`}>{blocks}</div>
}

export default MarkdownView
