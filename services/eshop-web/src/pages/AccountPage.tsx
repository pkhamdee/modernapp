import { Link, useNavigate } from 'react-router'
import { authPaths, formatMobileNumber, type Me } from '../api/auth.ts'
import { useApi } from '../api/client.ts'
import { useAuth } from '../auth/context.ts'
import { Status } from '../components/Status.tsx'

/** The signed-in Customer's account (behind RequireRole Customer). */
export function AccountPage() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const me = useApi<Me>(authPaths.me())

  return (
    <section className="card column-narrow">
      <h1>บัญชีของฉัน</h1>
      {me.status === 'success' ? (
        <dl className="terms">
          <div>
            <dt>เบอร์มือถือ</dt>
            <dd>{me.data.mobileNumber ? formatMobileNumber(me.data.mobileNumber) : '-'}</dd>
          </div>
          <div>
            <dt>สถานะ</dt>
            <dd>ลูกค้า</dd>
          </div>
        </dl>
      ) : (
        <Status state={me} />
      )}
      <Link to="/contracts" className="button apply-button">
        สัญญาของฉัน
      </Link>
      <Link to="/won-lots" className="button button-secondary">
        ประมูลที่ชนะ
      </Link>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          signOut()
          navigate('/', { replace: true })
        }}
      >
        ออกจากระบบ
      </button>
    </section>
  )
}
