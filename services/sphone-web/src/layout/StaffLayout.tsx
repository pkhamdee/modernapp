import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { BrandLogo } from './BrandLogo.tsx'

/** Shell of the Staff back office (/staff/*). The section links show only to a signed-in Staff member. */
export function StaffLayout() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const isStaff = session?.role === 'Staff'

  return (
    <div className="app">
      <header className="app-header staff-header">
        <Link to="/staff" className="brand">
          <BrandLogo />
          <small>ระบบหลังร้าน</small>
        </Link>
        {isStaff && (
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
        )}
      </header>
      {isStaff && (
        <nav className="staff-nav" aria-label="เมนูหลังร้าน">
          <NavLink to="/staff/products">สินค้า</NavLink>
          <NavLink to="/staff/product-categories">ประเภทสินค้า</NavLink>
          <NavLink to="/staff/branches">สาขา</NavLink>
          <NavLink to="/staff/auctions">ประมูล</NavLink>
          <NavLink to="/staff/handovers">ส่งมอบสินค้า</NavLink>
        </nav>
      )}
      <main className="app-main">
        <Outlet />
      </main>
      {isStaff && <footer className="app-footer">เข้าสู่ระบบในชื่อ {session.displayName ?? session.username}</footer>}
    </div>
  )
}
