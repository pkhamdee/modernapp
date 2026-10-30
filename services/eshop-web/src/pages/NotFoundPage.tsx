import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="status">
      <h1>ไม่พบหน้าที่คุณต้องการ</h1>
      <p>
        <Link to="/">กลับไปหน้าสินค้า</Link>
      </p>
    </section>
  )
}
