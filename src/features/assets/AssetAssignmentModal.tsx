import { useState } from 'react'
import { AlertTriangle, Check, Link2, UserRound, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'

export type CurrentAssetAssignment = {
  id: string
  asset_id: string
  assigned_asset_id: string | null
  assigned_user_id: string | null
  assignment_type: 'asset' | 'user' | 'operation'
  started_at: string
  reason: string | null
}
type AssignmentAsset = { id: string; org_id: string; name: string; internal_code: string; asset_type_code: string; status: string }
type AssignmentMember = { user_id: string; display_name: string }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AssetAssignmentModal({
  asset,
  assets,
  members,
  assignments,
  onClose,
  onChanged,
}: {
  asset: AssignmentAsset
  assets: AssignmentAsset[]
  members: AssignmentMember[]
  assignments: CurrentAssetAssignment[]
  onClose: () => void
  onChanged: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [assignmentType, setAssignmentType] = useState<'asset' | 'user'>(asset.asset_type_code === 'drone' ? 'user' : 'asset')
  const [assignedAssetId, setAssignedAssetId] = useState('')
  const [assignedUserId, setAssignedUserId] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const currentAssetAssignment = assignments.find(({ assignment_type }) => assignment_type === 'asset')
  const currentUserAssignment = assignments.find(({ assignment_type }) => assignment_type === 'user')
  const assetNames = new Map(assets.map((item) => [item.id, `${item.name} · ${item.internal_code}`]))
  const memberNames = new Map(members.map((member) => [member.user_id, member.display_name]))
  const availableDrones = assets.filter((candidate) =>
    candidate.asset_type_code === 'drone'
    && candidate.id !== asset.id
    && candidate.status === 'available',
  )

  async function createAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: assignmentError } = await supabase.rpc('assign_asset', {
      p_org_id: asset.org_id,
      p_asset_id: asset.id,
      p_assignment_type: assignmentType,
      p_assigned_asset_id: assignmentType === 'asset' ? assignedAssetId : null,
      p_assigned_user_id: assignmentType === 'user' ? assignedUserId : null,
      p_reason: reason.trim() || null,
    })
    if (assignmentError) {
      setError(assignmentError.message)
      setSaving(false)
      return
    }
    setNotice('Asignación registrada en el historial.')
    await onChanged()
    setSaving(false)
  }

  async function endAssignment(assignmentId: string) {
    if (!supabase) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: assignmentError } = await supabase.rpc('end_asset_assignment', {
      p_org_id: asset.org_id,
      p_assignment_id: assignmentId,
    })
    if (assignmentError) {
      setError(assignmentError.message)
      setSaving(false)
      return
    }
    setNotice('Asignación finalizada; el registro histórico se conservó.')
    await onChanged()
    setSaving(false)
  }

  return (
    <div className="asset-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <motion.section
        className="asset-form-card asset-assignment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-assignment-title"
        initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
      >
        <div className="asset-form-heading">
          <div><span className="eyebrow">TRAZABILIDAD</span><h2 id="asset-assignment-title">Asignaciones · {asset.name}</h2><p>Asocia un componente a un dron o registra a su responsable actual.</p></div>
          <button className="icon-button" type="button" aria-label="Cerrar asignaciones" onClick={onClose} disabled={saving}><X size={18} /></button>
        </div>

        <div className="asset-current-assignments">
          <h3>Asignaciones actuales</h3>
          {!currentAssetAssignment && !currentUserAssignment ? (
            <p>Este activo no tiene asignaciones manuales activas.</p>
          ) : (
            <>
              {currentAssetAssignment && (
                <article>
                  <span className="asset-assignment-kind"><Link2 size={14} /> Dron</span>
                  <div><strong>{assetNames.get(currentAssetAssignment.assigned_asset_id ?? '') ?? 'Dron'}</strong><small>Desde {formatDate(currentAssetAssignment.started_at)}{currentAssetAssignment.reason ? ` · ${currentAssetAssignment.reason}` : ''}</small></div>
                  <button className="asset-assignment-end" type="button" onClick={() => void endAssignment(currentAssetAssignment.id)} disabled={saving}>Liberar</button>
                </article>
              )}
              {currentUserAssignment && (
                <article>
                  <span className="asset-assignment-kind"><UserRound size={14} /> Responsable</span>
                  <div><strong>{memberNames.get(currentUserAssignment.assigned_user_id ?? '') ?? 'Usuario'}</strong><small>Desde {formatDate(currentUserAssignment.started_at)}{currentUserAssignment.reason ? ` · ${currentUserAssignment.reason}` : ''}</small></div>
                  <button className="asset-assignment-end" type="button" onClick={() => void endAssignment(currentUserAssignment.id)} disabled={saving}>Liberar</button>
                </article>
              )}
            </>
          )}
        </div>

        <form className="asset-assignment-form" onSubmit={(event) => void createAssignment(event)}>
          <h3>Nueva asignación</h3>
          <label>Tipo de asignación<select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value === 'user' ? 'user' : 'asset')}>
            {asset.asset_type_code !== 'drone' && <option value="asset">Asociar a un dron</option>}
            <option value="user">Asignar responsable</option>
          </select></label>
          {assignmentType === 'asset' ? (
            <label>Dron<select required value={assignedAssetId} onChange={(event) => setAssignedAssetId(event.target.value)}>
              <option value="">Selecciona un dron disponible</option>
              {availableDrones.map((drone) => <option value={drone.id} key={drone.id}>{drone.name} · {drone.internal_code}</option>)}
            </select></label>
          ) : (
            <label>Responsable<select required value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)}>
              <option value="">Selecciona un miembro</option>
              {members.map((member) => <option value={member.user_id} key={member.user_id}>{member.display_name}</option>)}
            </select></label>
          )}
          <label>Motivo u observación <span className="optional-label">Opcional</span><textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <p className="asset-assignment-hint"><AlertTriangle size={14} /> Solo los activos disponibles pueden asignarse. La base guarda la asignación y su liberación en el historial; no se elimina.</p>
          {notice && <div className="asset-assignment-notice" role="status"><Check size={15} />{notice}</div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="asset-form-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cerrar</button>
            <button className="primary-button" type="submit" disabled={saving || asset.status !== 'available' || (assignmentType === 'asset' && !availableDrones.length) || (assignmentType === 'user' && !members.length) || (assignmentType === 'asset' && Boolean(currentAssetAssignment)) || (assignmentType === 'user' && Boolean(currentUserAssignment))}>
              {saving ? 'Guardando…' : 'Registrar asignación'}
            </button>
          </div>
        </form>
      </motion.section>
    </div>
  )
}
