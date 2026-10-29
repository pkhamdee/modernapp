import { Link, Outlet } from 'react-router'

export function AppLayout() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <strong>S Phone</strong>
            <small>เอส ลีสซิ่ง</small>
          </span>
        </Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">ผ่อนง่าย ใช้แค่บัตรประชาชนใบเดียว</footer>
    </div>
  )
}
