import type { ApiState } from '../api/client.ts'

/** Loading and error states shared by every page that reads from sphone-api. */
export function Status({ state }: { state: ApiState<unknown> }) {
  if (state.status === 'loading') {
    return <p className="status" role="status">กำลังโหลด…</p>
  }
  if (state.status === 'error') {
    return (
      <p className="status status-error" role="alert">
        ขออภัย ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง
      </p>
    )
  }
  return null
}
