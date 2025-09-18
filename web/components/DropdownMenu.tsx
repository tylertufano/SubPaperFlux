import Link from 'next/link'
import React from 'react'
import { useI18n } from '../lib/i18n'

type Item = { href?: string; label: string; onClick?: () => void }

type Props = {
  label: string
  baseHref: string
  items: Item[]
  currentPath?: string
}

export default function DropdownMenu({ label, baseHref, items, currentPath = '' }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLAnchorElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const menuId = React.useId()
  const isActive = (href: string) => currentPath === href
  const baseLinkStyles = 'px-2 py-1 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
  const linkClass = (href: string) =>
    `${baseLinkStyles} ${isActive(href) ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900'}`
  const baseMenuItemClass =
    'block px-3 py-2 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
  const menuLinkClass = (href: string) =>
    `${baseMenuItemClass} ${isActive(href) ? 'text-blue-600 font-semibold' : 'text-gray-700'}`
  const menuButtonClass = `${baseMenuItemClass} w-full text-left text-gray-700`

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return
      const t = e.target as Node
      if (menuRef.current && menuRef.current.contains(t)) return
      if (triggerRef.current && triggerRef.current.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function focusFirstItem() {
    const itemsEls = menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')
    itemsEls && itemsEls[0]?.focus()
  }
  function focusNext(prev = false) {
    const itemsEls = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') || [])
    const active = document.activeElement as HTMLElement | null
    const idx = active ? itemsEls.findIndex((el) => el === active) : -1
    const nextIdx = idx < 0 ? 0 : (idx + (prev ? -1 : 1) + itemsEls.length) % itemsEls.length
    itemsEls[nextIdx]?.focus()
  }

  return (
    <div className="relative inline-block" onMouseLeave={() => setOpen(false)} onMouseEnter={() => setOpen(true)}>
      <Link
        href={baseHref}
        ref={triggerRef as any}
        className={linkClass(baseHref)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={isActive(baseHref) ? 'page' : undefined}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
            setTimeout(focusFirstItem, 0)
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            const els = menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')
            els && els[els.length - 1]?.focus()
          }
        }}
      >
        {label}
        <span className="ml-1 text-gray-500">▾</span>
      </Link>
      <div
        id={menuId}
        ref={menuRef}
        className={(open ? 'block ' : 'hidden ') + 'absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded shadow z-20 min-w-[180px]'}
        role="menu"
        aria-label={t('dropdown_submenu_label', { label })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); focusNext(false) }
          if (e.key === 'ArrowUp') { e.preventDefault(); focusNext(true) }
          if (e.key === 'Home') { e.preventDefault(); focusFirstItem() }
          if (e.key === 'End') { e.preventDefault(); const els = menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'); els && els[els.length-1]?.focus() }
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus() }
        }}
      >
        {items.map((it, idx) => (
          it.href ? (
            <Link
              key={it.href + idx}
              href={it.href}
              className={menuLinkClass(it.href)}
              role="menuitem"
              tabIndex={-1}
              aria-current={isActive(it.href) ? 'page' : undefined}
            >
              {it.label}
            </Link>
          ) : (
            <button
              key={(it.label || 'item') + idx}
              className={menuButtonClass}
              role="menuitem"
              tabIndex={-1}
              onClick={() => { try { it.onClick && it.onClick() } finally { setOpen(false) } }}
            >
              {it.label}
            </button>
          )
        ))}
      </div>
    </div>
  )
}
