/*
 * DSH UI Toolbox — browser half (dsh-ui-toolbox).
 *
 * Surfaces:
 *   1. shell.overlay        id "toolbox"         — hosts one body portal containing the
 *                                                  resident tray, the pick highlight,
 *                                                  hover tooltip, picking hint and the
 *                                                  result toast. The portal sits above
 *                                                  host modals (the Settings dialog uses
 *                                                  z-index 1000), so the tray and picker
 *                                                  stay usable with Settings open.
 *   2. conversation.composer.dock id "toolbox-bridge" — publishes the session's
 *                                                  InputActions so the toast can insert the
 *                                                  captured element context into the composer
 *
 * Current tool: element picker. Click the tray icon, then hover the live UI (ArrowUp /
 * ArrowDown moves between parent and first child); a click captures the element's React
 * component chain, CSS selector, box, text, attributes and key computed styles, copies
 * that context to the clipboard and offers a one-click insert into the composer.
 *
 * The detailed feature description lives in this bundle's locale `meta.description`
 * (the plugin inventory entry); the tray itself only carries the icon, a short tooltip
 * and transient picking/result feedback.
 *
 * Constraints: one browser-global file, no JSX, `react` and `react-dom` are the only
 * modules required at runtime, no harness package imports, colors exclusively through
 * --dsw-* theme tokens. The body portal mirrors the host's own modal pattern; it is the
 * only way to paint above a host modal that portals itself to document.body.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ui-toolbox',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const NS = 'toolbox'

    //#region locale
    const zh = {
      'tray.label': '工具箱',
      'tool.select': '选取元素',
      'tool.exit': '退出选取',
      'picking.hint': '单击采集 · ↑↓ 切换层级 · Esc 取消',
      'picking.cancel': '退出选取',
      'toast.copied': '已复制元素上下文',
      'toast.copyFailed': '复制失败，可改用插入',
      'toast.insert': '插入对话框',
      'toast.inserted': '已插入对话框，接着写修改要求',
      'toast.insertFallback': '插入失败，已复制到剪贴板',
      'toast.noComposer': '没有会话输入框，已复制到剪贴板',
      'ctx.element': '元素',
      'ctx.component': '组件',
      'ctx.selector': '选择器',
      'ctx.box': '位置',
      'ctx.text': '文本',
      'ctx.attrs': '属性',
      'ctx.styles': '关键样式',
      'ctx.html': '结构',
      'ctx.ancestors': '祖先链',
      'ctx.request': '修改要求：',
      'ctx.title': '（以下内容由 DSH 工具箱的元素选取器采集，来自当前 Web 界面）'
    }

    const en = {
      'tray.label': 'Toolbox',
      'tool.select': 'Select element',
      'tool.exit': 'Stop picking',
      'picking.hint': 'Click to capture · ↑↓ change level · Esc to cancel',
      'picking.cancel': 'Stop picking',
      'toast.copied': 'Element context copied',
      'toast.copyFailed': 'Copy failed — try Insert instead',
      'toast.insert': 'Insert into composer',
      'toast.inserted': 'Inserted into the composer — type your change request',
      'toast.insertFallback': 'Could not insert, copied to the clipboard',
      'toast.noComposer': 'No composer available, copied to the clipboard',
      'ctx.element': 'element',
      'ctx.component': 'component',
      'ctx.selector': 'selector',
      'ctx.box': 'box',
      'ctx.text': 'text',
      'ctx.attrs': 'attributes',
      'ctx.styles': 'key styles',
      'ctx.html': 'markup',
      'ctx.ancestors': 'ancestors',
      'ctx.request': 'Change request: ',
      'ctx.title': '(captured by the DSH Toolbox element picker from the live Web UI)'
    }
    //#endregion

    //#region constants
    const STORE_DEFAULT = {
      picking: false,
      candidate: null,
      tip: null,
      toast: null,
      lastCapture: null,
      draftReady: false
    }

    const STYLE_KEYS = [
      'display',
      'position',
      'flex-direction',
      'align-items',
      'justify-content',
      'gap',
      'padding',
      'margin',
      'color',
      'background-color',
      'border-radius',
      'box-shadow',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'opacity',
      'overflow',
      'transform'
    ]

    const ATTRIBUTE_KEYS = [
      'type',
      'role',
      'aria-label',
      'title',
      'name',
      'placeholder',
      'href',
      'src',
      'alt',
      'data-composer-input',
      'data-testid'
    ]

    /** A captured click must not also press the host control underneath. */
    let swallowUntil = 0

    const CSS = `
.dsh-toolbox-tray {
  position: fixed;
  z-index: 1102;
  left: 12px;
  bottom: 54px;
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-button-elevated-fill);
  box-shadow: var(--dsw-elevation-soft);
}
.dsh-toolbox-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-toolbox-tool:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-toolbox-tool.is-active {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);
  color: var(--dsw-alias-state-business-primary);
}
.dsh-toolbox-tool:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
.dsh-toolbox-tip {
  position: fixed;
  z-index: 1103;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-alias-toast-label);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  box-shadow: var(--dsw-elevation-soft);
  pointer-events: none;
  animation: dsh-toolbox-tip-in 0.12s var(--ds-ease-in-out, ease-out);
}
@keyframes dsh-toolbox-tip-in {
  from { opacity: 0; transform: translateX(-3px); }
  to { opacity: 1; transform: none; }
}
.dsh-toolbox-highlight {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  border: 2px solid var(--dsw-alias-state-business-primary);
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent);
  pointer-events: none;
}
.dsh-toolbox-highlight-label {
  position: fixed;
  z-index: 1101;
  overflow: hidden;
  max-width: 320px;
  padding: 3px 7px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-alias-toast-label);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-shadow: var(--dsw-elevation-soft);
  pointer-events: none;
}
.dsh-toolbox-pickbar {
  position: fixed;
  z-index: 1104;
  top: 16px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  max-width: min(560px, calc(100vw - 32px));
  padding: 7px 8px 7px 12px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-alias-toast-label);
  font-size: 12px;
  line-height: 18px;
  box-shadow: var(--dsw-elevation-soft);
  pointer-events: auto;
}
.dsh-toolbox-pickbar-text { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.dsh-toolbox-pickbar-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  cursor: pointer;
}
.dsh-toolbox-pickbar-close:hover { opacity: 1; background: color-mix(in srgb, currentColor 16%, transparent); }
.dsh-toolbox-pickbar-close:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dsh-toolbox-toast {
  position: fixed;
  z-index: 1105;
  top: 14px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  max-width: min(520px, calc(100vw - 32px));
  padding: 8px 13px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--dsw-alias-toast-bg);
  color: var(--dsw-alias-toast-label);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  box-shadow: var(--dsw-elevation-soft);
  animation: dsh-toolbox-toast-enter 0.16s var(--ds-ease-in-out, ease-out);
  pointer-events: none;
}
.dsh-toolbox-toast.is-actionable { pointer-events: auto; }
.dsh-toolbox-toast-icon { display: inline-flex; flex: none; }
.dsh-toolbox-toast-error .dsh-toolbox-toast-icon { color: var(--dsw-alias-state-error-primary); }
.dsh-toolbox-toast-action {
  flex: none;
  padding: 0 0 0 2px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.dsh-toolbox-toast-action:hover { opacity: 0.8; }
.dsh-toolbox-toast-action:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
html[data-dsh-toolbox-picking] * { cursor: crosshair !important; }
@keyframes dsh-toolbox-toast-enter {
  from { opacity: 0; transform: translate(-50%, -6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-toolbox-tip, .dsh-toolbox-toast { animation: none; }
}
`
    //#endregion

    //#region store
    let state = Object.assign({}, STORE_DEFAULT)
    const listeners = new Set()

    function getState() {
      return state
    }

    function subscribe(listener) {
      listeners.add(listener)
      return function unsubscribe() {
        listeners.delete(listener)
      }
    }

    function update(patch) {
      state = Object.assign({}, state, patch)
      listeners.forEach(function notify(listener) {
        try {
          listener()
        } catch (error) {
          console.error('[toolbox] store subscriber failed', error)
        }
      })
    }

    /** Show one toast. `action` optionally names the click action it offers. */
    function notify(text, kind, action) {
      const seq = (state.toast && state.toast.seq ? state.toast.seq : 0) + 1
      update({ toast: { text: text, kind: kind || 'info', seq: seq, action: action || null } })
    }

    /** Session input actions published by the composer bridge, if mounted. */
    const bridge = { inputActions: null, sessionId: null }

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(getState)
      React.useEffect(
        function subscribeStore() {
          setSnapshot(getState())
          return subscribe(function onStoreChange() {
            setSnapshot(getState())
          })
        },
        []
      )
      return snapshot
    }
    //#endregion

    //#region element inspection helpers
    function truncate(value, max) {
      const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
      if (text.length <= max) return text
      return text.slice(0, Math.max(1, max - 1)) + '…'
    }

    function isToolboxUi(node) {
      return node instanceof Element && node.closest('[data-dsh-toolbox-ui]') !== null
    }

    function queryElementAt(x, y) {
      if (typeof document.elementsFromPoint !== 'function') {
        const single = document.elementFromPoint(x, y)
        if (!single || isToolboxUi(single) || single === document.documentElement || single === document.body) return null
        return single
      }
      const stack = document.elementsFromPoint(x, y)
      for (let i = 0; i < stack.length; i += 1) {
        const el = stack[i]
        if (!(el instanceof Element)) continue
        if (isToolboxUi(el)) continue
        if (el === document.documentElement || el === document.body) continue
        return el
      }
      return null
    }

    function classesOf(el) {
      return Array.prototype.slice.call(el.classList || []).filter(function keep(name) {
        return typeof name === 'string' && name.length > 0 && name.indexOf('dsh-toolbox') !== 0
      })
    }

    function componentName(type) {
      if (typeof type === 'function') return type.displayName || type.name || ''
      if (type && typeof type === 'object') {
        const inner = type.type || type.render
        if (typeof inner === 'function') return type.displayName || inner.displayName || inner.name || ''
        if (typeof type.displayName === 'string') return type.displayName
      }
      return ''
    }

    function componentChain(el) {
      const chain = []
      try {
        const fiberKey = Object.keys(el).filter(function isFiberKey(key) {
          return key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0
        })[0]
        if (!fiberKey) return chain
        let fiber = el[fiberKey]
        let guard = 0
        while (fiber && guard < 48 && chain.length < 5) {
          guard += 1
          const name = componentName(fiber.type)
          if (name && name.charAt(0) === name.charAt(0).toUpperCase() && chain.indexOf(name) === -1) {
            chain.push(name)
          }
          fiber = fiber.return
        }
      } catch (error) {
        return chain
      }
      return chain
    }

    function cssPath(el) {
      const parts = []
      let node = el
      let guard = 0
      while (node && node.nodeType === 1 && guard < 7) {
        guard += 1
        if (node === document.body || node === document.documentElement) break
        const tag = node.tagName.toLowerCase()
        let part = tag
        if (node.id && /^[A-Za-z][\w:-]*$/.test(node.id)) {
          parts.unshift(tag + '#' + node.id)
          break
        }
        let attributePart = ''
        for (let i = 0; i < ATTRIBUTE_KEYS.length; i += 1) {
          const name = ATTRIBUTE_KEYS[i]
          if (name === 'href' || name === 'src') continue
          const value = node.getAttribute(name)
          if (value && value.length <= 48) {
            attributePart = '[' + name + '="' + value.replace(/"/g, '\\"') + '"]'
            break
          }
        }
        if (attributePart) {
          part += attributePart
        } else {
          const classes = classesOf(node)
          if (classes.length > 0) part += '.' + classes.slice(0, 2).join('.')
        }
        if (!attributePart && classesOf(node).length === 0 && node.parentElement) {
          const siblings = Array.prototype.filter.call(node.parentElement.children, function sameTag(child) {
            return child.tagName === node.tagName
          })
          if (siblings.length > 1) part += ':nth-of-type(' + String(siblings.indexOf(node) + 1) + ')'
        }
        parts.unshift(part)
        node = node.parentElement
      }
      return parts.join(' > ')
    }

    function ancestorChain(el) {
      const parts = []
      let node = el.parentElement
      let guard = 0
      while (node && guard < 6 && node !== document.documentElement) {
        if (node === document.body) break
        guard += 1
        let part = node.tagName.toLowerCase()
        const classes = classesOf(node)
        if (classes.length > 0) part += '.' + classes[0]
        const aria = node.getAttribute('aria-label')
        if (aria) part += '[' + truncate(aria, 20) + ']'
        parts.push(part)
        node = node.parentElement
      }
      return parts.reverse().join(' > ')
    }

    function elementText(el) {
      try {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          return truncate(el.value || el.getAttribute('placeholder') || '', 160)
        }
        if (el instanceof HTMLImageElement) return truncate(el.getAttribute('alt') || '', 160)
        const raw = typeof el.innerText === 'string' && el.innerText.length > 0 ? el.innerText : el.textContent
        return truncate(raw || '', 160)
      } catch (error) {
        return ''
      }
    }

    function attributeSummary(el) {
      const parts = []
      for (let i = 0; i < ATTRIBUTE_KEYS.length && parts.length < 5; i += 1) {
        const name = ATTRIBUTE_KEYS[i]
        if (name === 'alt' || name === 'src') continue
        if (name === 'href' && !(el instanceof HTMLAnchorElement)) continue
        const value = el.getAttribute(name)
        if (value == null || value === '') continue
        if (name === 'data-composer-input' && value === 'true') {
          parts.push('data-composer-input')
          continue
        }
        parts.push(name + '="' + truncate(value, 90) + '"')
      }
      const dataAttributes = []
      for (let i = 0; i < el.attributes.length && dataAttributes.length < 2; i += 1) {
        const attr = el.attributes[i]
        if (!attr || attr.name.indexOf('data-') !== 0) continue
        if (attr.name === 'data-composer-input' || attr.name === 'data-testid') continue
        if (attr.name.length > 32) continue
        dataAttributes.push(attr.name + '="' + truncate(attr.value, 60) + '"')
      }
      if (dataAttributes.length > 0) parts.push(dataAttributes.join(' '))
      return parts.join('; ')
    }

    function readStyles(el) {
      const parts = []
      try {
        const computed = window.getComputedStyle(el)
        for (let i = 0; i < STYLE_KEYS.length; i += 1) {
          const key = STYLE_KEYS[i]
          let value = computed.getPropertyValue(key)
          if (!value) continue
          value = value.trim()
          if (!value) continue
          if (key === 'box-shadow' && value === 'none') continue
          if (key === 'transform' && value === 'none') continue
          if (key === 'opacity' && value === '1') continue
          if (key === 'overflow' && value === 'visible') continue
          if (key === 'position' && value === 'static') continue
          if (key === 'text-align' && value === 'start') continue
          if (key === 'letter-spacing' && value === 'normal') continue
          if (key === 'gap' && value === 'normal') continue
          if (key === 'border-radius' && value === '0px') continue
          if (key === 'flex-direction' && value === 'row') continue
          if (key === 'align-items' && value === 'normal') continue
          if (key === 'justify-content' && value === 'normal') continue
          if ((key === 'padding' || key === 'margin') && value === '0px') continue
          parts.push(key + ': ' + truncate(value, 90))
        }
        const borderWidth = parseFloat(computed.borderTopWidth)
        if (borderWidth > 0 && computed.borderTopStyle !== 'none') {
          parts.push('border: ' + truncate([computed.borderTopWidth, computed.borderTopStyle, computed.borderTopColor].join(' '), 90))
        }
      } catch (error) {
        return ''
      }
      return parts.join('; ').slice(0, 900)
    }

    function outerSnippet(el) {
      try {
        if (el.childElementCount > 4) return ''
        const html = el.outerHTML || ''
        if (html.length > 460) return ''
        return html.replace(/\s+/g, ' ').trim()
      } catch (error) {
        return ''
      }
    }

    function elementSignature(el) {
      const classes = classesOf(el).slice(0, 2)
      let signature = '<' + el.tagName.toLowerCase()
      if (classes.length > 0) signature += ' class="' + classes.join(' ') + '"'
      const aria = el.getAttribute('aria-label')
      if (aria) signature += ' aria-label="' + truncate(aria, 40) + '"'
      const role = el.getAttribute('role')
      if (role) signature += ' role="' + truncate(role, 20) + '"'
      return signature + '>'
    }

    function collectElementInfo(el) {
      if (!(el instanceof Element)) return null
      if (el === document.documentElement || el === document.body) return null
      let rect
      try {
        rect = el.getBoundingClientRect()
      } catch (error) {
        return null
      }
      const classes = classesOf(el)
      const signature = elementSignature(el)
      const text = elementText(el)
      const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || ''
      const info = {
        tag: el.tagName.toLowerCase(),
        classes: classes.slice(0, 4),
        signature: signature,
        component: componentChain(el).join(' ← '),
        selector: cssPath(el),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        text: text,
        attrs: attributeSummary(el),
        styles: readStyles(el),
        html: outerSnippet(el),
        ancestors: ancestorChain(el),
        ariaLabel: ariaLabel
      }
      info.label = info.tag + (classes[0] ? '.' + classes[0] : '') + (ariaLabel ? ' · ' + truncate(ariaLabel, 34) : text ? ' · ' + truncate(text, 34) : '')
      return info
    }

    function formatContext(info, t) {
      const lines = [t('ctx.title'), '<selected-element>']
      if (info.signature) lines.push(t('ctx.element') + ': ' + info.signature)
      if (info.component) lines.push(t('ctx.component') + ': ' + info.component)
      if (info.selector) lines.push(t('ctx.selector') + ': ' + info.selector)
      if (info.rect) {
        lines.push(t('ctx.box') + ': ' + String(info.rect.width) + ' × ' + String(info.rect.height) + ' @ (' + String(info.rect.left) + ', ' + String(info.rect.top) + ')')
      }
      if (info.text) lines.push(t('ctx.text') + ': ' + info.text)
      if (info.attrs) lines.push(t('ctx.attrs') + ': ' + info.attrs)
      if (info.styles) lines.push(t('ctx.styles') + ': ' + info.styles)
      if (info.html) lines.push(t('ctx.html') + ': ' + info.html)
      if (info.ancestors) lines.push(t('ctx.ancestors') + ': ' + info.ancestors)
      lines.push('</selected-element>')
      return lines.join('\n')
    }

    function hoverLabel(el) {
      if (!(el instanceof Element)) return ''
      let width = 0
      let height = 0
      try {
        const rect = el.getBoundingClientRect()
        width = Math.round(rect.width)
        height = Math.round(rect.height)
      } catch (error) {
        /* ignore */
      }
      const classes = classesOf(el)
      const aria = el.getAttribute('aria-label')
      return (
        el.tagName.toLowerCase() +
        (classes[0] ? '.' + classes[0] : '') +
        '  ' +
        String(width) +
        '×' +
        String(height) +
        (aria ? '  ' + truncate(aria, 24) : '')
      )
    }

    function copyText(text) {
      return new Promise(function executor(resolve) {
        function fallback() {
          try {
            const area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            area.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;'
            document.body.appendChild(area)
            area.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(area)
            resolve(ok === true)
          } catch (error) {
            resolve(false)
          }
        }
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(
              function copied() {
                resolve(true)
              },
              function failed() {
                fallback()
              }
            )
            return
          }
        } catch (error) {
          /* fall through to the legacy copy path */
        }
        fallback()
      })
    }
    //#endregion

    //#region icons
    /** Crosshair selection glyph: ring + four ticks (the previous picker icon). */
    function IconCrosshair(props) {
      const size = props && props.size ? props.size : 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('circle', { cx: 12, cy: 12, r: 6.2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round'
        })
      )
    }

    function IconClose(props) {
      const size = props && props.size ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' })
      )
    }

    function IconCheck(props) {
      const size = props && props.size ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M5 12.5l4.2 4.2L19 7', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' })
      )
    }

    function IconAlert(props) {
      const size = props && props.size ? props.size : 14
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('circle', { cx: 12, cy: 12, r: 8.2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M12 7.8v5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 16.2, r: 1, fill: 'currentColor' })
      )
    }
    //#endregion

    //#region components
    /**
     * One tray button. Owns only its hover/focus tooltip delay; pressing is the
     * tool's, so adding another tool is another descriptor in the tray.
     */
    function TrayTool(props) {
      const ref = React.useRef(null)
      const timer = React.useRef(0)
      const labelRef = React.useRef(props.label)

      React.useEffect(
        function syncLabel() {
          labelRef.current = props.label
        },
        [props.label]
      )

      React.useEffect(
        function clearHoverTimer() {
          return function cleanup() {
            window.clearTimeout(timer.current)
            timer.current = 0
            if (state.tip) update({ tip: null })
          }
        },
        []
      )

      function hideTip() {
        window.clearTimeout(timer.current)
        timer.current = 0
        if (state.tip) update({ tip: null })
      }

      function scheduleTip() {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(function showTip() {
          timer.current = 0
          const button = ref.current
          if (!button) return
          const rect = button.getBoundingClientRect()
          update({
            tip: {
              text: labelRef.current,
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
            }
          })
        }, 140)
      }

      function handlePress() {
        window.clearTimeout(timer.current)
        timer.current = 0
        if (state.tip) update({ tip: null })
        props.onPress()
      }

      return h(
        'button',
        {
          ref: ref,
          type: 'button',
          className: 'dsh-toolbox-tool' + (props.active ? ' is-active' : ''),
          'data-dsh-toolbox-ui': '',
          'aria-label': props.label,
          'aria-pressed': props.active === true,
          onMouseEnter: scheduleTip,
          onMouseLeave: hideTip,
          onFocus: scheduleTip,
          onBlur: hideTip,
          onClick: handlePress
        },
        h(props.icon, { size: 18 })
      )
    }

    /**
     * The resident tray. It lives in the body portal hosted by {@link ToolboxHost},
     * pinned to the bottom-left above the sidebar Settings row, so it also stays
     * reachable while a host modal such as Settings is open. One cell per tool; the
     * icon is the whole entry, the short label lives in the hover tooltip.
     */
    function ToolboxTray(props) {
      const t = typeof props.t === 'function' ? props.t : function fallback(key) { return key }
      const snapshot = useStore()
      const picking = snapshot.picking === true

      function togglePicking() {
        if (state.picking) {
          update({ picking: false, candidate: null, tip: null })
          return
        }
        update({ picking: true, candidate: null, tip: null, toast: null })
      }

      const tools = [
        {
          id: 'element-picker',
          label: picking ? t('tool.exit') : t('tool.select'),
          icon: IconCrosshair,
          active: picking,
          run: togglePicking
        }
      ]

      return h(
        'div',
        {
          className: 'dsh-toolbox-tray',
          role: 'toolbar',
          'aria-label': t('tray.label'),
          'data-dsh-toolbox-ui': ''
        },
        tools.map(function renderTool(tool) {
          return h(TrayTool, {
            key: tool.id,
            label: tool.label,
            icon: tool.icon,
            active: tool.active,
            onPress: tool.run
          })
        })
      )
    }

    /**
     * Zero-height companion in the composer dock. Its only job is publishing the
     * session's stable InputActions face so the root-scope toast can insert text
     * into the resident composer of the current session.
     */
    function ComposerBridge(props) {
      const actions = props.inputActions || null
      const sessionId = props.sessionId || null

      React.useEffect(
        function bindComposer() {
          bridge.inputActions = actions
          bridge.sessionId = sessionId
          update({ draftReady: actions !== null })
          return function unbindComposer() {
            if (bridge.inputActions === actions) {
              bridge.inputActions = null
              bridge.sessionId = null
              update({ draftReady: false })
            }
          }
        },
        [actions, sessionId]
      )

      return null
    }

    /**
     * Frame-wide toolbox surface. It renders through a body portal (the same
     * technique the host Settings dialog uses) so the tray, highlight, tooltip,
     * picking hint and toast paint above host modals; without the portal the
     * Settings dialog's z-index-1000 layer would cover the whole toolbox.
     */
    function ToolboxHost(props) {
      const t = typeof props.t === 'function' ? props.t : function fallback(key) { return key }
      const snapshot = useStore()
      const tRef = React.useRef(t)

      React.useEffect(
        function syncTranslator() {
          tRef.current = t
        },
        [t]
      )

      // A captured click must never also press the host control underneath.
      React.useEffect(function guardCapturedClick() {
        function swallow(event) {
          if (isToolboxUi(event.target)) return
          if (!state.picking && Date.now() > swallowUntil) return
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        window.addEventListener('click', swallow, true)
        window.addEventListener('pointerup', swallow, true)
        window.addEventListener('mouseup', swallow, true)
        window.addEventListener('mousedown', swallow, true)
        return function detach() {
          window.removeEventListener('click', swallow, true)
          window.removeEventListener('pointerup', swallow, true)
          window.removeEventListener('mouseup', swallow, true)
          window.removeEventListener('mousedown', swallow, true)
        }
      }, [])

      // Picker mode: document-level hover, capture, ancestor navigation and exit.
      React.useEffect(
        function installPicker() {
          if (!snapshot.picking) return undefined
          const translate = function translate(key) {
            return tRef.current(key)
          }
          let frame = 0
          let pointerX = 0
          let pointerY = 0

          function refreshHover() {
            if (frame) return
            frame = window.requestAnimationFrame(function applyHover() {
              frame = 0
              const el = queryElementAt(pointerX, pointerY)
              if (el && el !== state.candidate) update({ candidate: el })
            })
          }

          function onPointerMove(event) {
            pointerX = event.clientX
            pointerY = event.clientY
            refreshHover()
          }

          function capture(el) {
            const info = collectElementInfo(el)
            if (!info) return
            const text = formatContext(info, translate)
            update({
              picking: false,
              candidate: null,
              tip: null,
              lastCapture: { text: text, label: info.label }
            })
            swallowUntil = Date.now() + 600
            copyText(text).then(function copied(ok) {
              const hasComposer = bridge.inputActions !== null
              let messageKey = 'toast.copyFailed'
              if (ok && hasComposer) messageKey = 'toast.copied'
              else if (ok) messageKey = 'toast.noComposer'
              notify(tRef.current(messageKey), ok ? 'success' : 'error', hasComposer ? 'insert' : null)
            })
          }

          function onPointerDown(event) {
            if (isToolboxUi(event.target)) return
            const el = queryElementAt(event.clientX, event.clientY) || state.candidate
            if (!el) return
            event.preventDefault()
            event.stopImmediatePropagation()
            capture(el)
          }

          function onKeyDown(event) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopImmediatePropagation()
              swallowUntil = Date.now() + 300
              update({ picking: false, candidate: null, tip: null })
              return
            }
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            const candidate = state.candidate
            if (!candidate) return
            event.preventDefault()
            event.stopImmediatePropagation()
            if (event.key === 'ArrowUp') {
              const parent = candidate.parentElement
              if (parent && parent !== document.documentElement && parent !== document.body && !isToolboxUi(parent)) {
                update({ candidate: parent })
              }
            } else {
              const child = candidate.firstElementChild
              if (child && !isToolboxUi(child)) update({ candidate: child })
            }
          }

          function onViewportChange() {
            refreshHover()
            update({})
          }

          document.documentElement.setAttribute('data-dsh-toolbox-picking', '')
          window.addEventListener('mousemove', onPointerMove, true)
          window.addEventListener('pointerdown', onPointerDown, true)
          window.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('scroll', onViewportChange, true)
          window.addEventListener('resize', onViewportChange)

          return function uninstall() {
            document.documentElement.removeAttribute('data-dsh-toolbox-picking')
            if (frame) window.cancelAnimationFrame(frame)
            window.removeEventListener('mousemove', onPointerMove, true)
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('scroll', onViewportChange, true)
            window.removeEventListener('resize', onViewportChange)
          }
        },
        [snapshot.picking]
      )

      // Auto-dismiss the toast.
      const toastSeq = snapshot.toast ? snapshot.toast.seq : null
      React.useEffect(
        function dismissToast() {
          if (toastSeq === null) return undefined
          const timer = window.setTimeout(function clearToast() {
            if (state.toast && state.toast.seq === toastSeq) update({ toast: null })
          }, 4200)
          return function detach() {
            window.clearTimeout(timer)
          }
        },
        [toastSeq]
      )

      // A tooltip anchored to a button must not survive a scroll or resize.
      const tipVisible = snapshot.tip !== null
      React.useEffect(
        function dismissTipOnViewportChange() {
          if (!tipVisible) return undefined
          function clearTip() {
            update({ tip: null })
          }
          window.addEventListener('resize', clearTip)
          window.addEventListener('scroll', clearTip, true)
          return function detach() {
            window.removeEventListener('resize', clearTip)
            window.removeEventListener('scroll', clearTip, true)
          }
        },
        [tipVisible]
      )

      function insertCaptured() {
        const capture = state.lastCapture
        if (!capture) return
        const actions = bridge.inputActions
        const text = capture.text + '\n\n' + t('ctx.request')
        if (!actions) {
          copyText(text).then(function copied(ok) {
            notify(ok ? t('toast.noComposer') : t('toast.copyFailed'), ok ? 'info' : 'error')
          })
          return
        }
        let inserted = false
        try {
          const span = actions.captureInsertion()
          inserted = actions.insertText(text, span) === true
          if (!inserted) {
            const retry = actions.captureInsertion()
            inserted = actions.insertText(text, retry) === true
          }
        } catch (error) {
          inserted = false
        }
        if (!inserted) {
          copyText(text).then(function copied(ok) {
            notify(ok ? t('toast.insertFallback') : t('toast.copyFailed'), ok ? 'info' : 'error')
          })
          return
        }
        notify(t('toast.inserted'), 'success')
        window.requestAnimationFrame(function focusComposer() {
          const editor = document.querySelector('[data-composer-input]')
          if (editor && typeof editor.focus === 'function') {
            try {
              editor.focus({ preventScroll: true })
            } catch (error) {
              /* focus is a nicety */
            }
          }
        })
      }

      function renderTip() {
        const tip = snapshot.tip
        if (!tip) return null
        const estimatedWidth = 132
        let left = tip.rect.right + 8
        if (left + estimatedWidth > window.innerWidth - 8) {
          left = Math.max(8, tip.rect.left - 8 - estimatedWidth)
        }
        const top = Math.max(8, Math.min(tip.rect.top + tip.rect.height / 2 - 12, window.innerHeight - 32))
        return h('div', { className: 'dsh-toolbox-tip', style: { left: left, top: top } }, tip.text)
      }

      function renderHighlight() {
        const candidate = snapshot.candidate
        if (!(candidate instanceof Element) || !candidate.isConnected) return null
        let rect
        try {
          rect = candidate.getBoundingClientRect()
        } catch (error) {
          return null
        }
        if (rect.width === 0 && rect.height === 0) return null
        const above = rect.top > 32
        const labelTop = above ? rect.top - 24 : rect.bottom + 6
        const labelLeft = Math.max(6, Math.min(rect.left, window.innerWidth - 336))
        return h(
          React.Fragment,
          null,
          h('div', {
            key: 'box',
            className: 'dsh-toolbox-highlight',
            style: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          }),
          h(
            'div',
            { key: 'label', className: 'dsh-toolbox-highlight-label', style: { left: labelLeft, top: labelTop } },
            hoverLabel(candidate)
          )
        )
      }

      function renderPickBar() {
        return h(
          'div',
          { className: 'dsh-toolbox-pickbar', 'data-dsh-toolbox-ui': '', role: 'status' },
          h(IconCrosshair, { size: 15 }),
          h('span', { className: 'dsh-toolbox-pickbar-text' }, t('picking.hint')),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-toolbox-pickbar-close',
              'data-dsh-toolbox-ui': '',
              title: t('picking.cancel'),
              'aria-label': t('picking.cancel'),
              onClick: function cancel() {
                update({ picking: false, candidate: null, tip: null })
              }
            },
            h(IconClose, { size: 13 })
          )
        )
      }

      function renderToast() {
        const toast = snapshot.toast
        if (!toast) return null
        const error = toast.kind === 'error'
        const actionable = toast.action === 'insert' && snapshot.lastCapture !== null && snapshot.draftReady === true
        return h(
          'div',
          {
            key: 'toast-' + String(toast.seq),
            className: 'dsh-toolbox-toast' + (error ? ' dsh-toolbox-toast-error' : '') + (actionable ? ' is-actionable' : ''),
            'data-dsh-toolbox-ui': '',
            role: 'status',
            'aria-live': 'polite'
          },
          h('span', { className: 'dsh-toolbox-toast-icon' }, error ? h(IconAlert, { size: 14 }) : h(IconCheck, { size: 14 })),
          h('span', null, toast.text),
          actionable
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-toolbox-toast-action',
                  'data-dsh-toolbox-ui': '',
                  onClick: insertCaptured
                },
                t('toast.insert')
              )
            : null
        )
      }

      return ReactDOM.createPortal(
        h(
          React.Fragment,
          null,
          h('style', { key: 'style' }, CSS),
          h(ToolboxTray, { key: 'tray', t: t }),
          snapshot.picking ? renderPickBar() : null,
          snapshot.picking ? renderHighlight() : null,
          renderTip(),
          renderToast()
        ),
        document.body
      )
    }
    //#endregion

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          function registerLocale() {
            return ctx.locale.register(NS, { zh: zh, en: en })
          },
          'toolbox: locale'
        )

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('shell.overlay', function injectHost() {
          return ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'toolbox',
              order: 20,
              locale: NS
            },
            ToolboxHost
          )
        })

        ctx.slots.inject('conversation.composer.dock', function injectBridge() {
          return ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'toolbox-bridge',
              order: 2,
              locale: NS
            },
            ComposerBridge
          )
        })

        ctx.effect(
          function clearUiOnDispose() {
            return function disposeUi() {
              update({ picking: false, candidate: null, tip: null, toast: null })
            }
          },
          'toolbox: clear ui state'
        )
      }
    }
  }
})
