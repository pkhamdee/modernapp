import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { BrandLogo } from './BrandLogo.tsx'

const NAV_ID = 'staff-nav'

/**
 * Shell of the Staff back office (/staff/*), designed desktop-first. From the desktop breakpoint (1280px) the
 * sections are a sidebar beside the page; below it they slide out from the left behind a menu button. The menu
 * and sign-out show only to a signed-in Staff member.
 */
export function StaffLayout() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const isStaff = session?.role === 'Staff'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const nav = useRef<HTMLElement>(null)
  const closeMenu = () => setMenuOpen(false)

  // While the slide-out menu is open, focus moves into it, and Escape closes it from anywhere on the page and
  // returns focus to the menu button.
  useEffect(() => {
    if (!menuOpen) return
    nav.current?.querySelector('a')?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <div className="app staff-layout">
      <header className="app-header staff-header">
        <Link to="/staff" className="brand" onClick={closeMenu}>
          <BrandLogo />
          <small>ระบบหลังร้าน</small>
        </Link>
        {isStaff && (
          <div className="staff-header-actions">
            <button
              ref={menuButton}
              type="button"
              className="header-link staff-menu-button"
              aria-expanded={menuOpen}
              aria-controls={NAV_ID}
              onClick={() => setMenuOpen((open) => !open)}
            >
              เมนู
            </button>
            <button
              type="button"
              className="header-link"
              onClick={() => {
                signOut()
                navigate('/staff/sign-in', { replace: true })
              }}
            >
              ออกจากระบบ
            </button>
          </div>
        )}
      </header>
      <div className="staff-body">
        {isStaff && (
          <>
            <nav
              ref={nav}
              id={NAV_ID}
              className={menuOpen ? 'staff-nav open' : 'staff-nav'}
              aria-label="เมนูหลังร้าน"
            >
              <NavLink to="/staff/handovers" onClick={closeMenu}>
                ส่งมอบสินค้า
              </NavLink>
              <NavLink to="/staff/products" onClick={closeMenu}>
                สินค้า
              </NavLink>
              <NavLink to="/staff/product-categories" onClick={closeMenu}>
                ประเภทสินค้า
              </NavLink>
              <NavLink to="/staff/branches" onClick={closeMenu}>
                สาขา
              </NavLink>
              <NavLink to="/staff/auctions" onClick={closeMenu}>
                ประมูล
              </NavLink>
            </nav>
            {/* Tapping beside the open slide-out menu closes it; keyboard users have Escape and the button. */}
            {menuOpen && <div className="staff-nav-backdrop" aria-hidden="true" onClick={closeMenu} />}
          </>
        )}
        <main className="app-main staff-main">
          <Outlet />
        </main>
      </div>
      {isStaff && <footer className="app-footer">เข้าสู่ระบบในชื่อ {session.displayName ?? session.username}</footer>}
    </div>
  )
}
