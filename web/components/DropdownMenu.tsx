import Link from 'next/link'
import React from 'react'

type Item = { href: string; label: string }

type Props = {
  label: string
  baseHref: string
  items: Item[]
  currentPath?: string
}

export default function DropdownMenu({ label, baseHref, items, currentPath = '' }: Props) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLAnchorElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const menuId = React.useId()
  const isActive = (href: string) => currentPath === href
  const linkClass = (href: string) => (isActive(href) ? 'text-blue-600 font-semibold' : 'text-gray-700 hover:text-gray-900')

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
        aria-label={`${label} submenu`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); focusNext(false) }
          if (e.key === 'ArrowUp') { e.preventDefault(); focusNext(true) }
          if (e.key === 'Home') { e.preventDefault(); focusFirstItem() }
          if (e.key === 'End') { e.preventDefault(); const els = menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'); els && els[els.length-1]?.focus() }
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus() }
        }}
      >
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="block px-3 py-2 text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" role="menuitem" tabIndex={-1}>
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

