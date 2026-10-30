import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { BrandLogo } from './BrandLogo.tsx'

const NAV_ID = 'site-nav'

/**
 * Shell of the Customer screens: a full-width header bar and a centred frame (`.frame`, up to 1200px) for the
 * page. Below the tablet breakpoint (768px) the sections sit behind a menu button; from 768px they form a top bar.
 */
export function AppLayout() {
  const { session } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeMenu = () => setMenuOpen(false)
  // Catalog covers the home page and every Product Category's page.
  const onCategory = useMatch('/categories/:code') !== null

  // While the phone menu is open, Escape closes it from anywhere on the page and returns focus to the button.
  useEffect(() => {
    if (!menuOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <div className="app">
      <header className="app-header site-header">
        <div className="frame header-bar">
          <Link to="/" className="brand" onClick={closeMenu}>
            <BrandLogo />
          </Link>
          <button
            ref={menuButton}
            type="button"
            className="header-link menu-button"
            aria-expanded={menuOpen}
            aria-controls={NAV_ID}
            onClick={() => setMenuOpen((open) => !open)}
          >
            เมนู
          </button>
          <nav id={NAV_ID} className={menuOpen ? 'site-nav open' : 'site-nav'} aria-label="เมนูหลัก">
            <NavLink
              to="/"
              // "/" would match every page without `end`; on a category page it should match.
              end={!onCategory}
              className="header-link"
              onClick={closeMenu}
            >
              สินค้า
            </NavLink>
            <NavLink to="/auction" className="header-link" onClick={closeMenu}>
              ประมูล
            </NavLink>
            {session?.role === 'Customer' ? (
              <NavLink to="/account" className="header-link" onClick={closeMenu}>
                บัญชีของฉัน
              </NavLink>
            ) : (
              <NavLink to="/sign-in" className="header-link" onClick={closeMenu}>
                เข้าสู่ระบบ
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="frame app-main">
        <Outlet />
      </main>
      <footer className="frame app-footer">ผ่อนง่าย ใช้แค่บัตรประชาชนใบเดียว</footer>
    </div>
  )
}
