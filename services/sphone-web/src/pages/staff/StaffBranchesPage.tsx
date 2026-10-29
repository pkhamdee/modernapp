import { useState, type FormEvent } from 'react'
import {
  addBranch,
  backOfficePaths,
  editBranch,
  reinstateBranch,
  retireBranch,
  type BackOfficeBranch,
} from '../../api/backOffice.ts'
import { problemMessage, useReloadableApi } from '../../api/client.ts'
import { Status } from '../../components/Status.tsx'

/** Branches offered for Store Pickup: add, edit, retire (and undo a retire). */
export function StaffBranchesPage() {
  const [branches, reload] = useReloadableApi<BackOfficeBranch[]>(backOfficePaths.branches())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleRetired(branch: BackOfficeBranch) {
    if (!branch.isRetired && !window.confirm(`ปิด "${branch.name}"? ลูกค้าจะเลือกรับสินค้าที่สาขานี้ไม่ได้อีก`)) return
    setError(null)
    try {
      await (branch.isRetired ? reinstateBranch(branch.code) : retireBranch(branch.code))
      reload()
    } catch {
      setError('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    }
  }

  if (branches.status !== 'success') return <Status state={branches} />

  return (
    <section>
      <div className="staff-toolbar">
        <h1>สาขา</h1>
        {!adding && (
          <button type="button" className="button button-small" onClick={() => setAdding(true)}>
            + เพิ่มสาขา
          </button>
        )}
      </div>
      {adding && (
        <div className="card">
          <BranchForm
            branch={null}
            onDone={(saved) => {
              setAdding(false)
              if (saved) reload()
            }}
          />
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ul className="staff-list">
        {branches.data.map((b) => (
          <li key={b.code} className={b.isRetired ? 'staff-item retired' : 'staff-item'}>
            {editing === b.code ? (
              <BranchForm
                branch={b}
                onDone={(saved) => {
                  setEditing(null)
                  if (saved) reload()
                }}
              />
            ) : (
              <div className="staff-item-body">
                <strong>{b.name}</strong>
                <span className="muted">
                  {b.address} {b.province}
                </span>
                <span className="muted">
                  รหัส {b.code}
                  {b.isRetired && ' · ปิดแล้ว'}
                </span>
                <div className="staff-actions">
                  <button type="button" className="button button-small button-outline" onClick={() => setEditing(b.code)}>
                    แก้ไข
                  </button>
                  <button type="button" className="button button-small button-outline" onClick={() => toggleRetired(b)}>
                    {b.isRetired ? 'เปิดอีกครั้ง' : 'ปิดสาขา'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function BranchForm({ branch, onDone }: { branch: BackOfficeBranch | null; onDone: (saved: boolean) => void }) {
  const [code, setCode] = useState(branch?.code ?? '')
  const [name, setName] = useState(branch?.name ?? '')
  const [address, setAddress] = useState(branch?.address ?? '')
  const [province, setProvince] = useState(branch?.province ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (branch) await editBranch(branch.code, { name, address, province })
      else await addBranch({ code: code.trim().toLowerCase(), name, address, province })
      onDone(true)
    } catch (e) {
      setError(problemMessage(e, 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="form staff-item-body" noValidate>
      <strong>{branch ? `แก้ไข ${branch.name}` : 'สาขาใหม่'}</strong>
      {!branch && (
        <label className="form-field">
          <span>รหัสสาขา (a-z, 0-9, -)</span>
          <input value={code} placeholder="bkk-bangna" autoCapitalize="none" maxLength={50} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      <label className="form-field">
        <span>ชื่อสาขา</span>
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="form-field">
        <span>ที่อยู่</span>
        <textarea value={address} maxLength={500} rows={2} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="form-field">
        <span>จังหวัด</span>
        <input value={province} maxLength={100} onChange={(e) => setProvince(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="staff-actions">
        <button type="submit" className="button button-small" disabled={saving}>
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        <button type="button" className="button button-small button-outline" onClick={() => onDone(false)}>
          ยกเลิก
        </button>
      </div>
    </form>
  )
}
