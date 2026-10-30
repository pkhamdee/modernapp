import { Link, Outlet } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { BrandLogo } from './BrandLogo.tsx'

export function AppLayout() {
  const { session } = useAuth()

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          <BrandLogo />
        </Link>
        <nav className="header-nav">
          <Link to="/auction" className="header-link">
            ประมูล
          </Link>
          {session?.role === 'Customer' ? (
            <Link to="/account" className="header-link">
              บัญชีของฉัน
            </Link>
          ) : (
            <Link to="/sign-in" className="header-link">
              เข้าสู่ระบบ
            </Link>
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">ผ่อนง่าย ใช้แค่บัตรประชาชนใบเดียว</footer>
    </div>
  )
}
