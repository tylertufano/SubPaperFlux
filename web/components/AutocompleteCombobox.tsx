import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

export type AutocompleteOption = {
  id: string
  label: string
}

type BaseProps = {
  id: string
  label: string
  placeholder?: string
  options: AutocompleteOption[]
  noOptionsLabel: string
  helpText?: string
  helpTextId?: string
  disabled?: boolean
  describedBy?: string
}

type MultiProps = BaseProps & {
  value: string[]
  onChange: (next: string[]) => void
  getRemoveLabel?: (option: AutocompleteOption) => string
}

type SingleProps = BaseProps & {
  value: string | null
  onChange: (next: string | null) => void
  clearLabel?: string
}

type HighlightableOption = AutocompleteOption & { index: number }

function normalizeOptions(options: AutocompleteOption[]): AutocompleteOption[] {
  return options
    .filter(option => option && typeof option.id === 'string' && typeof option.label === 'string')
    .map(option => ({ id: option.id, label: option.label }))
}

function buildOptionLookup(options: AutocompleteOption[]): Map<string, AutocompleteOption> {
  const map = new Map<string, AutocompleteOption>()
  for (const option of options) {
    if (!map.has(option.id)) {
      map.set(option.id, option)
    }
  }
  return map
}

function useOutsideBlur(ref: RefObject<HTMLElement>, handler: () => void) {
  useEffect(() => {
    function handlePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null
      if (!ref.current || !target) return
      if (ref.current.contains(target)) return
      handler()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('touchstart', handlePointer)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('touchstart', handlePointer)
    }
  }, [ref, handler])
}

function OptionList({
  id,
  options,
  highlightedId,
  onSelect,
  noOptionsLabel,
}: {
  id: string
  options: HighlightableOption[]
  highlightedId: string | null
  onSelect: (option: AutocompleteOption) => void
  noOptionsLabel: string
}) {
  if (options.length === 0) {
    return (
      <div
        id={id}
        role="listbox"
        className="absolute left-0 right-0 mt-1 rounded-md border border-gray-200 bg-white p-2 text-sm text-gray-500 shadow-lg"
      >
        {noOptionsLabel}
      </div>
    )
  }

  return (
    <ul
      id={id}
      role="listbox"
      className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
    >
      {options.map(option => {
        const optionId = `${id}-${option.index}`
        const isActive = highlightedId === optionId
        return (
          <li key={option.id} role="presentation">
            <button
              type="button"
              id={optionId}
              role="option"
              aria-selected={isActive}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${
                isActive ? 'bg-blue-100 text-blue-900' : 'text-gray-900 hover:bg-gray-100'
              }`}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onSelect(option)}
            >
              {option.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function AutocompleteMultiSelect({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  noOptionsLabel,
  helpText,
  helpTextId,
  disabled,
  describedBy,
  getRemoveLabel,
}: MultiProps) {
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
  const optionLookup = useMemo(() => buildOptionLookup(normalizedOptions), [normalizedOptions])
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const listboxId = `${id}-listbox`

  const selectedOptions = useMemo(() => {
    return value.map(id => optionLookup.get(id) ?? { id, label: id })
  }, [value, optionLookup])

  const filteredOptions = useMemo(() => {
    const lower = query.trim().toLowerCase()
    return normalizedOptions
      .filter(option => !value.includes(option.id))
      .filter(option => {
        if (!lower) return true
        return option.label.toLowerCase().includes(lower)
      })
      .map((option, index) => ({ ...option, index }))
  }, [normalizedOptions, value, query])

  useEffect(() => {
    if (!isOpen) {
      setHighlightedId(null)
      return
    }
    const firstOption = filteredOptions[0]
    setHighlightedId(firstOption ? `${listboxId}-${firstOption.index}` : null)
  }, [filteredOptions, isOpen, listboxId])

  const closeList = useCallback(() => setIsOpen(false), [])

  useOutsideBlur(containerRef, closeList)

  function selectOption(option: AutocompleteOption) {
    if (disabled) return
    if (value.includes(option.id)) return
    onChange([...value, option.id])
    setQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function removeOption(idToRemove: string) {
    if (disabled) return
    onChange(value.filter(id => id !== idToRemove))
    inputRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIsOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      setHighlightedId(prev => {
        if (!prev) return `${listboxId}-${filteredOptions[0].index}`
        const currentIndex = filteredOptions.findIndex(option => `${listboxId}-${option.index}` === prev)
        const nextIndex = currentIndex < filteredOptions.length - 1 ? currentIndex + 1 : 0
        return `${listboxId}-${filteredOptions[nextIndex].index}`
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      setHighlightedId(prev => {
        if (!prev) return `${listboxId}-${filteredOptions[filteredOptions.length - 1].index}`
        const currentIndex = filteredOptions.findIndex(option => `${listboxId}-${option.index}` === prev)
        const nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredOptions.length - 1
        return `${listboxId}-${filteredOptions[nextIndex].index}`
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      if (!highlightedId) return
      const option = filteredOptions.find(opt => `${listboxId}-${opt.index}` === highlightedId)
      if (option) {
        selectOption(option)
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false)
      setHighlightedId(null)
    } else if (event.key === 'Backspace' && query === '' && value.length > 0) {
      removeOption(value[value.length - 1])
    }
  }

  const removeLabelFor = (option: AutocompleteOption) => {
    if (getRemoveLabel) return getRemoveLabel(option)
    return `Remove ${option.label}`
  }

  const resolvedHelpTextId = helpText ? helpTextId ?? `${id}-help` : undefined
  const describedByValue = [describedBy, resolvedHelpTextId]
    .filter(Boolean)
    .join(' ')
    .trim()
    || undefined

  return (
    <div className="flex flex-col" ref={containerRef}>
      <label className="text-sm font-medium text-gray-700" htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className="relative mt-1">
        <div
          className={`input flex min-h-[2.5rem] flex-wrap items-center gap-1 ${disabled ? 'bg-gray-100 text-gray-500' : ''}`}
        >
          {selectedOptions.map(option => (
            <span
              key={option.id}
              className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-sm text-gray-800"
            >
              {option.label}
              <button
                type="button"
                className="text-gray-600 hover:text-gray-900"
                onClick={() => removeOption(option.id)}
                aria-label={removeLabelFor(option)}
                disabled={disabled}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${id}-input`}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-activedescendant={highlightedId ?? undefined}
            aria-describedby={describedByValue}
            className="flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0 disabled:text-gray-500"
            placeholder={selectedOptions.length === 0 ? placeholder : ''}
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onClick={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoComplete="off"
          />
        </div>
        {isOpen && (
          <OptionList
            id={listboxId}
            options={filteredOptions}
            highlightedId={highlightedId}
            onSelect={selectOption}
            noOptionsLabel={noOptionsLabel}
          />
        )}
      </div>
      {helpText && (
        <p id={resolvedHelpTextId} className="mt-1 text-sm text-gray-600">
          {helpText}
        </p>
      )}
    </div>
  )
}

export function AutocompleteSingleSelect({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  noOptionsLabel,
  helpText,
  helpTextId,
  disabled,
  describedBy,
  clearLabel,
}: SingleProps) {
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
  const optionLookup = useMemo(() => buildOptionLookup(normalizedOptions), [normalizedOptions])
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const listboxId = `${id}-listbox`

  const selectedOption = value ? optionLookup.get(value) ?? { id: value, label: value } : null

  const filteredOptions = useMemo(() => {
    const lower = query.trim().toLowerCase()
    return normalizedOptions
      .filter(option => {
        if (!lower) return true
        return option.label.toLowerCase().includes(lower)
      })
      .map((option, index) => ({ ...option, index }))
  }, [normalizedOptions, query])

  useEffect(() => {
    if (!isOpen) {
      setHighlightedId(null)
      return
    }
    const firstOption = filteredOptions[0]
    setHighlightedId(firstOption ? `${listboxId}-${firstOption.index}` : null)
  }, [filteredOptions, isOpen, listboxId])

  useEffect(() => {
    if (!selectedOption) {
      setQuery('')
    } else {
      setQuery(selectedOption.label)
    }
  }, [selectedOption?.id, selectedOption?.label])

  const closeList = useCallback(() => setIsOpen(false), [])

  useOutsideBlur(containerRef, closeList)

  function selectOption(option: AutocompleteOption) {
    if (disabled) return
    onChange(option.id)
    setIsOpen(false)
    setQuery(option.label)
    inputRef.current?.blur()
  }

  function clearSelection() {
    if (disabled) return
    onChange(null)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIsOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      setHighlightedId(prev => {
        if (!prev) return `${listboxId}-${filteredOptions[0].index}`
        const currentIndex = filteredOptions.findIndex(option => `${listboxId}-${option.index}` === prev)
        const nextIndex = currentIndex < filteredOptions.length - 1 ? currentIndex + 1 : 0
        return `${listboxId}-${filteredOptions[nextIndex].index}`
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      setHighlightedId(prev => {
        if (!prev) return `${listboxId}-${filteredOptions[filteredOptions.length - 1].index}`
        const currentIndex = filteredOptions.findIndex(option => `${listboxId}-${option.index}` === prev)
        const nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredOptions.length - 1
        return `${listboxId}-${filteredOptions[nextIndex].index}`
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      if (!highlightedId) return
      const option = filteredOptions.find(opt => `${listboxId}-${opt.index}` === highlightedId)
      if (option) {
        selectOption(option)
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false)
      setHighlightedId(null)
    }
  }

  const resolvedHelpTextId = helpText ? helpTextId ?? `${id}-help` : undefined
  const describedByValue = [describedBy, resolvedHelpTextId]
    .filter(Boolean)
    .join(' ')
    .trim()
    || undefined

  return (
    <div className="flex flex-col" ref={containerRef}>
      <label className="text-sm font-medium text-gray-700" htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className="relative mt-1">
        <div className={`input flex items-center gap-2 ${disabled ? 'bg-gray-100 text-gray-500' : ''}`}>
          <input
            ref={inputRef}
            id={`${id}-input`}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-activedescendant={highlightedId ?? undefined}
            aria-describedby={describedByValue}
            className="h-full w-full border-0 bg-transparent p-0 text-sm text-gray-900 focus:outline-none focus:ring-0 disabled:text-gray-500"
            placeholder={placeholder}
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setIsOpen(true)
            }}
            onFocus={() => {
              setIsOpen(true)
              if (!selectedOption) {
                setQuery('')
              }
            }}
            onClick={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoComplete="off"
          />
          {selectedOption && (
            <button
              type="button"
              className="text-sm text-gray-600 hover:text-gray-900"
              onClick={clearSelection}
              aria-label={clearLabel ?? 'Clear selection'}
              disabled={disabled}
            >
              ×
            </button>
          )}
        </div>
        {isOpen && (
          <OptionList
            id={listboxId}
            options={filteredOptions}
            highlightedId={highlightedId}
            onSelect={selectOption}
            noOptionsLabel={noOptionsLabel}
          />
        )}
      </div>
      {helpText && (
        <p id={resolvedHelpTextId} className="mt-1 text-sm text-gray-600">
          {helpText}
        </p>
      )}
    </div>
  )
}

export default AutocompleteMultiSelect
