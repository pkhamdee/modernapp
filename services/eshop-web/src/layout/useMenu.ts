import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Open/closed state of a header menu behind a menu button (the Customer phone menu, the Staff slide-out menu).
 * While it is open, Escape closes it from anywhere on the page and returns focus to the button (`menuButton`, to
 * put on the button). With `focusInto`, opening the menu also moves focus to the first link inside that element.
 */
export function useMenu(focusInto?: RefObject<HTMLElement | null>) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    focusInto?.current?.querySelector('a')?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen, focusInto])

  return {
    menuOpen,
    menuButton,
    toggleMenu: () => setMenuOpen((open) => !open),
    closeMenu: () => setMenuOpen(false),
  }
}
