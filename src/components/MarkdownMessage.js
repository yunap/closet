import React from 'react'
import Markdown from 'react-markdown'

// Renders assistant chat prose as markdown (headers, bold, lists, links, inline code).
// Written with React.createElement (no JSX) so the plain `node --test` runner can import and
// render it. All visual styling lives under the `.stylist-markdown` scope in App.css.
//
// Safety: react-markdown does not render raw HTML by default, so model-generated text containing
// literal <script>/<img>/etc. is escaped to inert text — no injection. Images are additionally
// disallowed (this pass is text formatting only, no rich embeds).
export default function MarkdownMessage({ text = '' }) {
  return React.createElement(
    'div',
    { className: 'stylist-markdown' },
    React.createElement(
      Markdown,
      { disallowedElements: ['img'], unwrapDisallowed: true },
      String(text ?? '')
    )
  )
}
