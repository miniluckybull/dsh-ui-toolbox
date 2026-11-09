/*
 * DSH UI Toolbox — browser half (dsh-ui-toolbox).
 *
 * Surfaces:
 *   1. sidebar.footer.action id "toolbox"        — the resident tool entry, rendered in the
 *                                                  sidebar footer beside the account/Settings
 *                                                  row. In wide mode the icon overlays the
 *                                                  right end of that row and the host settings
 *                                                  area is narrowed to make room; it never
 *                                                  floats, so it cannot cover the task list,
 *                                                  the account menu or the Settings dialog.
 *   2. shell.overlay        id "toolbox"         — hosts one body portal with the transient
 *                                                  picker UI: highlight box, hover tooltip,
 *                                                  picking hint and result toast. The portal
 *                                                  paints above host modals (Settings uses
 *                                                  z-index 1000) so picking feedback stays
 *                                                  visible; only the icon lives in the sidebar.
 *   3. conversation.composer.dock id "toolbox-bridge" — publishes the session's
 *                                                  InputActions + session id so a capture
 *                                                  can insert a compact reference chip
 *                                                  into the composer.
 *   4. conversation.user.text.node key "elementRef" — renders one captured element in a
 *                                                  user message as a small chip instead of
 *                                                  the full context block; the model text
 *                                                  is unchanged.
 *   Plus two root services: an `@` input-trigger source named "element" (chip codec that
 *   resolves the captured context at submit time) and a user-text rule that folds the
 *   serialized block back into the chip.
 *
 * Current tool: element picker. Click the sidebar footer icon, then hover the live UI
 * (ArrowUp / ArrowDown moves between parent and first child); a click captures the
 * element's React component chain, CSS selector, box, text, attributes and key computed
 * styles and inserts a compact `@label` chip into the current composer. The full context is
 * stored locally and travels with the message for the model, while the conversation shows
 * only the chip. A capture made while no chat composer is on screen (Settings, Plugins, the
 * welcome page) is queued in memory and inserted as chips as soon as a composer appears, so
 * nothing ever has to be pasted as a wall of text.
 *
 * The detailed feature description lives in this bundle's locale `meta.description`
 * (the plugin inventory entry); the tray itself only carries the icon, a short tooltip
 * and transient picking/result feedback.
 *
 * Constraints: one browser-global file, no JSX, `react` and `react-dom` are the only
 * modules required at runtime, no harness package imports, colors exclusively through
 * --dsw-* theme tokens. The body portal is only used for the transient picker feedback;
 * it is the one way to paint above a host modal that portals itself to document.body.
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
      'toast.elementAdded': '已添加元素引用',
      'toast.elementQueued': '已暂存元素引用，进入会话后自动插入',
      'toast.queuedInserted': '已插入暂存的元素引用',
      'ctx.element': '元素',
      'ctx.component': '组件',
      'ctx.selector': '选择器',
      'ctx.box': '位置',
      'ctx.text': '文本',
      'ctx.attrs': '属性',
      'ctx.styles': '关键样式',
      'ctx.html': '结构',
      'ctx.ancestors': '祖先链',
      'ctx.title': '（以下内容由 DSH 工具箱的元素选取器采集，来自当前 Web 界面）'
    }

    const en = {
      'tray.label': 'Toolbox',
      'tool.select': 'Select element',
      'tool.exit': 'Stop picking',
      'picking.hint': 'Click to capture · ↑↓ change level · Esc to cancel',
      'picking.cancel': 'Stop picking',
      'toast.elementAdded': 'Element reference added',
      'toast.elementQueued': 'Element reference saved — it will be inserted when you open a chat',
      'toast.queuedInserted': 'Saved element references inserted',
      'ctx.element': 'element',
      'ctx.component': 'component',
      'ctx.selector': 'selector',
      'ctx.box': 'box',
      'ctx.text': 'text',
      'ctx.attrs': 'attributes',
      'ctx.styles': 'key styles',
      'ctx.html': 'markup',
      'ctx.ancestors': 'ancestors',
      'ctx.title': '(captured by the DSH Toolbox element picker from the live Web UI)'
    }
    //#endregion

    //#region constants
    const STORE_DEFAULT = {
      picking: false,
      candidate: null,
      tip: null,
      toast: null
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
/* Sidebar footer entry. It lives in the sidebar's own footer slot (below host
   modals) so it can never float over the task list, the account menu or the
   Settings dialog. In wide mode it overlays the right end of the account row;
   the host settings area is narrowed to match while this entry is mounted. */
.dsh-toolbox-foot {
  box-sizing: border-box;
  position: relative;
  display: flex;
  pointer-events: none;
}
.dsh-toolbox-foot > .dsh-toolbox-tool { pointer-events: auto; }
.dsh-toolbox-foot-float {
  width: 100%;
  height: 0;
  justify-content: flex-end;
}
.dsh-toolbox-foot-float > .dsh-toolbox-tool {
  position: absolute;
  top: 12px;
  right: 2px;
  width: 28px;
  height: 28px;
}
.dsh-toolbox-foot:not(.dsh-toolbox-foot-float) > .dsh-toolbox-tool {
  width: 36px;
  height: 36px;
}
html[data-dsh-toolbox-footer] [class*="settingsArea"] { width: calc(100% - 38px); }
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
.dsh-toolbox-toast-icon { display: inline-flex; flex: none; }
.dsh-toolbox-toast-error .dsh-toolbox-toast-icon { color: var(--dsw-alias-state-error-primary); }
.dsh-toolbox-element-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 240px;
  padding: 0 4px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  line-height: inherit;
  vertical-align: baseline;
}
.dsh-toolbox-element-chip-icon { display: inline-flex; flex: none; color: var(--dsw-alias-state-business-primary); }
.dsh-toolbox-element-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

    /** Show one short toast. */
    function notify(text, kind) {
      const seq = (state.toast && state.toast.seq ? state.toast.seq : 0) + 1
      update({ toast: { text: text, kind: kind || 'info', seq: seq } })
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

    //#region element references
    /**
     * Captured element contexts are referenced from the composer by a short id.
     * The composer keeps a chip (`@label`); the model form is the full context
     * wrapped in a marker the chat user-text rule collapses back to a chip.
     */
    const ELEMENT_REF_KEY = 'dsh-ui-toolbox.elements.v1'
    const ELEMENT_REF_LIMIT = 100
    const ELEMENT_REF_TTL_MS = 7 * 24 * 60 * 60 * 1000
    const elementRefs = new Map()
    let sessionsService = null

    function sanitizeElementLabel(value) {
      const text = String(value == null ? '' : value)
        .replace(/[\[\]|\r\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text.length === 0) return '元素'
      return text.length > 36 ? text.slice(0, 35) + '…' : text
    }

    function elementLabelForInfo(info) {
      return sanitizeElementLabel(info.ariaLabel || info.text || info.tag || '元素')
    }

    function makeElementRefId() {
      return 'el-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    }

    function pruneElementRefs() {
      const cutoff = Date.now() - ELEMENT_REF_TTL_MS
      const kept = Array.from(elementRefs.values())
        .filter(function alive(entry) {
          return entry && entry.at >= cutoff
        })
        .sort(function oldestFirst(a, b) {
          return a.at - b.at
        })
      const tail = kept.slice(Math.max(0, kept.length - ELEMENT_REF_LIMIT))
      elementRefs.clear()
      tail.forEach(function restore(entry) {
        elementRefs.set(entry.id, entry)
      })
    }

    function persistElementRefs() {
      try {
        pruneElementRefs()
        window.localStorage.setItem(ELEMENT_REF_KEY, JSON.stringify(Array.from(elementRefs.values())))
      } catch (error) {
        /* the in-memory map remains authoritative */
      }
    }

    function loadElementRefs() {
      try {
        const raw = window.localStorage.getItem(ELEMENT_REF_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return
        for (const entry of parsed) {
          if (!entry || typeof entry.id !== 'string' || typeof entry.label !== 'string' || typeof entry.text !== 'string') continue
          elementRefs.set(entry.id, {
            id: entry.id,
            label: sanitizeElementLabel(entry.label),
            text: entry.text,
            at: typeof entry.at === 'number' ? entry.at : Date.now()
          })
        }
        pruneElementRefs()
      } catch (error) {
        /* ignore corrupt local state */
      }
    }

    function rememberElementRef(info, text) {
      const entry = { id: makeElementRefId(), label: elementLabelForInfo(info), text: text, at: Date.now() }
      elementRefs.set(entry.id, entry)
      persistElementRefs()
      return entry
    }

    function elementRefOf(id) {
      return elementRefs.get(id) || null
    }

    function elementClipboardText(ref) {
      const entry = elementRefOf(ref)
      return '@' + (entry ? entry.label : ref)
    }

    function serializeElementRef(entry) {
      return '[[' + 'el:' + entry.id + '|' + entry.label + ']]\n' + entry.text
    }

    /**
     * Insert one composer reference chip through the scoped input event. The
     * chip carries the short ref; submit time resolves the full context through
     * the element source codec.
     */
    function insertElementChip(id, label) {
      const actions = bridge.inputActions
      if (!actions) return 'no-composer'
      let scope = null
      try {
        scope = sessionsService && bridge.sessionId ? sessionsService.scope(bridge.sessionId) : null
      } catch (error) {
        scope = null
      }
      if (!scope || typeof scope.bail !== 'function') return 'no-composer'
      const reference = {
        source: 'element',
        ref: id,
        label: label,
        clipboardText: elementClipboardText(id)
      }
      try {
        // Bail dispatch mirrors the host's own insertion path; it runs the
        // session's scoped listener synchronously and returns true when the
        // composer applied the edit.
        let span = actions.captureInsertion()
        if (scope.bail(scope, 'slash/input-insert-reference', { reference: reference, span: span }) === true) return 'inserted'
        span = actions.captureInsertion()
        if (scope.bail(scope, 'slash/input-insert-reference', { reference: reference, span: span }) === true) return 'inserted'
      } catch (error) {
        return 'failed'
      }
      return 'failed'
    }

    /**
     * Captures made while no chat composer is mounted (Settings, Plugins, the
     * welcome screen) wait here. As soon as a chat composer appears they are
     * inserted as chips automatically, so nothing has to be pasted as text.
     */
    const pendingElementRefs = []

    function queuePendingElementRef(entry) {
      const exists = pendingElementRefs.some(function same(ref) {
        return ref.id === entry.id
      })
      if (!exists) pendingElementRefs.push({ id: entry.id, label: entry.label })
    }

    /**
     * Adopt queued references into the mounted composer.
     * @param translate - locale lookup used for the result toast.
     * @returns number of references inserted now.
     */
    function flushPendingElementRefs(translate) {
      if (pendingElementRefs.length === 0 || !bridge.inputActions || !bridge.sessionId) return 0
      let inserted = 0
      const remaining = []
      pendingElementRefs.forEach(function attempt(ref) {
        if (insertElementChip(ref.id, ref.label) === 'inserted') inserted += 1
        else remaining.push(ref)
      })
      pendingElementRefs.length = 0
      remaining.forEach(function keep(ref) {
        pendingElementRefs.push(ref)
      })
      if (inserted > 0 && typeof translate === 'function') {
        notify(translate('toast.queuedInserted'), 'success')
      }
      return inserted
    }

    /** Collapse one serialized element block back to a compact chat chip. */
    const elementTextRule = {
      id: 'elementRef',
      order: 20,
      match(text, from) {
        const marker = /\[\[el:([a-z0-9-]+)\|([^\]\n]*)\]\]/g
        marker.lastIndex = from
        const found = marker.exec(text)
        if (!found) return undefined
        const endToken = '</selected-element>'
        const close = text.indexOf(endToken, found.index)
        if (close < 0) return undefined
        return {
          id: 'elementRef',
          start: found.index,
          end: close + endToken.length,
          data: { id: found[1], label: found[2] || found[1] }
        }
      }
    }

    /** The `@` source owning element chips; serialization reads the captured context. */
    const elementSource = {
      trigger: '@',
      name: 'element',
      showGroupTitle: false,
      async candidates() {
        return []
      },
      onPick() {
        return undefined
      },
      codec: {
        clipboardText(ref) {
          return elementClipboardText(ref)
        },
        serialize(ref) {
          const entry = elementRefOf(ref)
          if (!entry) return Promise.resolve('[[' + 'el:' + ref + ']]')
          return Promise.resolve(serializeElementRef(entry))
        }
      }
    }

    loadElementRefs()
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
     * Chat presentation for one captured element: a compact chip. The message
     * text still carries the full context for the model; this renderer only
     * changes how the user message is displayed.
     */
    function ElementReference(props) {
      const node = props.node || {}
      const data = node.data || {}
      const label = data.label || data.id || '元素'
      return h(
        'span',
        { className: 'dsh-toolbox-element-chip', title: label, 'data-dsh-toolbox-ui': '' },
        h('span', { className: 'dsh-toolbox-element-chip-icon' }, h(IconCrosshair, { size: 12 })),
        h('span', { className: 'dsh-toolbox-element-chip-label' }, label)
      )
    }

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
     * The resident entry in the sidebar footer (`sidebar.footer.action`),
     * rendered to the right of the account/Settings row. Living inside the
     * sidebar's own layout keeps it below host modals, so it never covers the
     * task list, the account menu or the Settings dialog. One cell per tool;
     * the icon is the whole entry, the short label lives in the hover tooltip.
     */
    function ToolboxFooter(props) {
      const t = typeof props.t === 'function' ? props.t : function fallback(key) { return key }
      const snapshot = useStore()
      const picking = snapshot.picking === true
      const wide = props.wide !== false

      // In wide mode the icon overlays the right end of the account row, so the
      // host settings area is narrowed while this entry is mounted.
      React.useEffect(
        function reserveFooterSpace() {
          if (!wide) return undefined
          document.documentElement.setAttribute('data-dsh-toolbox-footer', '')
          return function releaseFooterSpace() {
            document.documentElement.removeAttribute('data-dsh-toolbox-footer')
          }
        },
        [wide]
      )

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
          className: 'dsh-toolbox-foot' + (wide ? ' dsh-toolbox-foot-float' : ''),
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
     * Zero-height companion in the composer dock. It publishes the session's
     * stable InputActions face so the frame-wide tray can insert element
     * reference chips into the resident composer of the current session.
     */
    function ComposerBridge(props) {
      const actions = props.inputActions || null
      const sessionId = props.sessionId || null
      const tRef = React.useRef(typeof props.t === 'function' ? props.t : null)

      React.useEffect(
        function syncTranslator() {
          tRef.current = typeof props.t === 'function' ? props.t : null
        },
        [props.t]
      )

      React.useEffect(
        function bindComposer() {
          bridge.inputActions = actions
          bridge.sessionId = sessionId
          if (actions && sessionId) {
            // A chat composer just appeared: adopt captures queued on other
            // views, then retry once after paint in case the editor was still
            // settling when this effect ran.
            flushPendingElementRefs(tRef.current)
            window.requestAnimationFrame(function retryQueuedRefs() {
              if (bridge.inputActions === actions && bridge.sessionId === sessionId) flushPendingElementRefs(tRef.current)
            })
          }
          return function unbindComposer() {
            if (bridge.inputActions === actions) {
              bridge.inputActions = null
              bridge.sessionId = null
            }
          }
        },
        [actions, sessionId]
      )

      return null
    }

    /**
     * Frame-wide transient surface for the picker. The tool icon itself lives in
     * the sidebar footer; this portal only carries the highlight box, hover
     * tooltip, picking hint and result toast, which must paint above host modals
     * while picking. Its stylesheet ships with this surface and is global.
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
            const entry = rememberElementRef(info, text)
            update({ picking: false, candidate: null, tip: null })
            swallowUntil = Date.now() + 600
            const outcome = insertElementChip(entry.id, entry.label)
            if (outcome === 'inserted') {
              flushPendingElementRefs(translate)
              notify(tRef.current('toast.elementAdded'), 'success')
              // Move focus back to the composer so the user can type the
              // change request right after the chips.
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
              return
            }
            // No composer on screen (Settings, Plugins, welcome…) or the
            // composer refused the edit: keep the reference and insert it as
            // soon as a chat composer appears, instead of pasting a long block.
            queuePendingElementRef(entry)
            if (flushPendingElementRefs(translate) === 0) {
              notify(tRef.current('toast.elementQueued'), 'info')
            }
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
        return h(
          'div',
          {
            key: 'toast-' + String(toast.seq),
            className: 'dsh-toolbox-toast' + (error ? ' dsh-toolbox-toast-error' : ''),
            'data-dsh-toolbox-ui': '',
            role: 'status',
            'aria-live': 'polite'
          },
          h('span', { className: 'dsh-toolbox-toast-icon' }, error ? h(IconAlert, { size: 14 }) : h(IconCheck, { size: 14 })),
          h('span', null, toast.text)
        )
      }

      return ReactDOM.createPortal(
        h(
          React.Fragment,
          null,
          h('style', { key: 'style' }, CSS),
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
      inject: ['slots', 'locale', 'sessions', 'inputTriggers', 'uiConversation'],
      apply(ctx) {
        sessionsService = ctx.get('sessions') || null

        ctx.effect(
          function registerLocale() {
            return ctx.locale.register(NS, { zh: zh, en: en })
          },
          'toolbox: locale'
        )

        const t = ctx.locale.bind(NS)

        ctx.effect(
          function registerElementSource() {
            return ctx.inputTriggers.registerSource(elementSource)
          },
          'toolbox: element trigger source'
        )

        ctx.effect(
          function registerElementTextRule() {
            return ctx.uiConversation.userText.register(elementTextRule)
          },
          'toolbox: element text rule'
        )

        ctx.slots.inject('conversation.user.text.node', function* injectElementChip() {
          yield ctx.slots.register(
            {
              name: 'conversation.user.text.node',
              key: 'elementRef',
              priority: 100,
              locale: NS
            },
            ElementReference
          )
        })

        ctx.slots.inject('sidebar.footer.action', function injectFooterAction() {
          return ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'toolbox',
              order: 30,
              locale: NS
            },
            ToolboxFooter
          )
        })

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
