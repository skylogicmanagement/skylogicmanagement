import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, MailPlus, Pencil, RefreshCw, Shield, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import './users.css'

type Role = { id: string; code: string; name: string }
type Permission = { code: string; description: string }
type Member = {
  id: string
  user_id: string
  role_id: string
  active: boolean
  name: string
  email: string
  phone: string
}
type InviteDraft = { email: string; displayName: string; phone: string; roleId: string }

const emptyInvite: InviteDraft = { email: '', displayName: '', phone: '', roleId: '' }

function getUserManagementError(message: string) {
  if (message.includes('organization_user_contacts') || message.includes('create_org_membership') || message.includes('update_org_membership')) {
    return 'Falta aplicar la migración de administración de usuarios. En Supabase > SQL Editor, ejecuta una sola vez el contenido de supabase/migrations/20261125170000_user_management.sql y vuelve a cargar esta sección.'
  }
  return message
}

export function UsersPage({ userId }: { userId: string }) {
  const reduceMotion = useReducedMotion()
  const [orgId, setOrgId] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [rolePermissions, setRolePermissions] = useState<Record<string, Permission[]>>({})
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState(emptyInvite)
  const [profileMember, setProfileMember] = useState<Member | null>(null)
  const [profileDraft, setProfileDraft] = useState({ name: '', phone: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError('No se pudo conectar con Supabase.')
      setLoading(false)
      return
    }

    setError('')
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (membershipError) {
      setError(membershipError.message)
      setLoading(false)
      return
    }
    if (!membership) {
      setError('Tu cuenta no tiene una membresía activa en Sky Logic.')
      setCanManage(false)
      setMembers([])
      setRoles([])
      setLoading(false)
      return
    }

    setOrgId(membership.org_id)
    const [access, rolesResult] = await Promise.all([
      supabase.rpc('has_org_permission', { target_org: membership.org_id, permission: 'users.manage' }),
      supabase.from('roles').select('id, code, name').eq('org_id', membership.org_id).order('name'),
    ])
    if (access.error || rolesResult.error) {
      setError(access.error?.message ?? rolesResult.error?.message ?? 'No se pudieron consultar los roles.')
      setLoading(false)
      return
    }
    setCanManage(access.data === true)
    setRoles(rolesResult.data ?? [])
    if (!access.data) {
      setMembers([])
      setLoading(false)
      return
    }

    const [membersResult, profilesResult, contactsResult, permissionLinksResult, permissionsResult] = await Promise.all([
      supabase.from('memberships').select('id, user_id, role_id, active, created_at').eq('org_id', membership.org_id).order('created_at'),
      supabase.from('user_profiles').select('user_id, display_name, phone').eq('org_id', membership.org_id),
      supabase.from('organization_user_contacts').select('user_id, email').eq('org_id', membership.org_id),
      supabase.from('role_permissions').select('role_id, permission_code').eq('org_id', membership.org_id),
      supabase.from('permissions').select('code, description').order('code'),
    ])
    const queryError = membersResult.error ?? profilesResult.error ?? contactsResult.error ?? permissionLinksResult.error ?? permissionsResult.error
    if (queryError) {
      setError(getUserManagementError(queryError.message))
      setLoading(false)
      return
    }

    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile]))
    const contacts = new Map((contactsResult.data ?? []).map((contact) => [contact.user_id, contact.email]))
    setMembers((membersResult.data ?? []).map((row) => {
      const profile = profiles.get(row.user_id)
      return {
        id: row.id,
        user_id: row.user_id,
        role_id: row.role_id,
        active: row.active,
        name: profile?.display_name ?? 'Usuario sin nombre',
        email: contacts.get(row.user_id) ?? 'Correo no disponible',
        phone: profile?.phone ?? '',
      }
    }))

    const permissionDescriptions = new Map((permissionsResult.data ?? []).map((permission) => [permission.code, permission]))
    const grouped = new Map<string, Permission[]>()
    for (const link of permissionLinksResult.data ?? []) {
      const permission = permissionDescriptions.get(link.permission_code)
      if (!permission) continue
      const roleItems = grouped.get(link.role_id) ?? []
      roleItems.push(permission)
      grouped.set(link.role_id, roleItems)
    }
    setRolePermissions(Object.fromEntries(grouped))
    setLoading(false)
  }, [userId])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  useEffect(() => {
    if (!supabase || !orgId || !canManage) return
    const client = supabase
    const channel = client.channel(`users-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memberships', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles', filter: `org_id=eq.${orgId}` }, () => void loadData())
      .subscribe((status, subscriptionError) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && subscriptionError) {
          setError(subscriptionError.message)
        }
      })
    return () => { void client.removeChannel(channel) }
  }, [canManage, loadData, orgId])

  const roleNames = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles])
  const filteredMembers = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase('es')
    if (!query) return members
    return members.filter((member) =>
      `${member.name} ${member.email} ${member.phone} ${roleNames.get(member.role_id) ?? ''}`
        .toLocaleLowerCase('es')
        .includes(query),
    )
  }, [filter, members, roleNames])

  async function submitInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId || !invite.roleId) return
    setSaving(true)
    setError('')
    setNotice('')
    const { data, error: inviteError } = await supabase.functions.invoke('invite-organization-user', {
      body: {
        orgId,
        email: invite.email.trim(),
        displayName: invite.displayName.trim(),
        phone: invite.phone.trim(),
        roleId: invite.roleId,
      },
    })
    if (inviteError) {
      setError(getUserManagementError(inviteError.message))
    } else if (data?.error) {
      setError(getUserManagementError(String(data.error)))
    } else {
      setNotice(data?.invitationSent
        ? `Invitación enviada a ${invite.email.trim()}. El acceso se activará cuando acepte el correo.`
        : `${invite.displayName.trim()} quedó agregado con una cuenta existente.`)
      setInvite(emptyInvite)
      setInviteOpen(false)
      await loadData()
    }
    setSaving(false)
  }

  async function saveRole(member: Member) {
    if (!supabase || !orgId) return
    const roleId = roleDrafts[member.id] ?? member.role_id
    if (roleId === member.role_id) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: updateError } = await supabase.rpc('update_org_membership', {
      p_org_id: orgId,
      p_membership_id: member.id,
      p_role_id: roleId,
      p_active: member.active,
    })
    if (updateError) {
      setError(getUserManagementError(updateError.message))
    } else {
      setNotice(`Rol actualizado para ${member.name}.`)
      setRoleDrafts((current) => { const next = { ...current }; delete next[member.id]; return next })
      await loadData()
    }
    setSaving(false)
  }

  async function toggleActive(member: Member) {
    if (!supabase || !orgId || member.user_id === userId) return
    const confirmed = window.confirm(
      member.active
        ? `¿Desactivar el acceso de ${member.name}? Su historial y registros se conservarán.`
        : `¿Reactivar el acceso de ${member.name}?`,
    )
    if (!confirmed) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: updateError } = await supabase.rpc('update_org_membership', {
      p_org_id: orgId,
      p_membership_id: member.id,
      p_role_id: member.role_id,
      p_active: !member.active,
    })
    if (updateError) {
      setError(getUserManagementError(updateError.message))
    } else {
      setNotice(member.active ? `Acceso de ${member.name} desactivado.` : `Acceso de ${member.name} reactivado.`)
      await loadData()
    }
    setSaving(false)
  }

  async function saveMemberProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !orgId || !profileMember) return
    const displayName = profileDraft.name.trim()
    if (!displayName) {
      setError('El nombre visible es obligatorio.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    const { error: profileError } = await supabase.from('user_profiles').upsert({
      org_id: orgId,
      user_id: profileMember.user_id,
      display_name: displayName,
      phone: profileDraft.phone.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,user_id' })
    if (profileError) {
      setError(profileError.message)
    } else {
      setNotice(`Perfil actualizado para ${displayName}.`)
      setProfileMember(null)
      await loadData()
    }
    setSaving(false)
  }

  return (
    <motion.section className="users-page" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {!canManage && !loading && !error ? (
        <div className="users-access-denied"><Shield size={22} /><strong>Acceso restringido</strong><span>Necesitas el permiso de administración de usuarios para consultar esta sección.</span></div>
      ) : (
        <>
          <div className="users-toolbar">
            <div className="users-summary"><strong>{loading ? '…' : members.length}</strong><span>cuentas de la organización</span></div>
            <div className="users-toolbar-actions">
              <button className="assets-refresh" type="button" aria-label="Actualizar usuarios" onClick={() => { setLoading(true); void loadData() }} disabled={loading}><RefreshCw size={16} /></button>
              {canManage && <button className="primary-button" type="button" onClick={() => { setInvite(emptyInvite); setInviteOpen(true) }}><MailPlus size={16} /> Invitar usuario</button>}
            </div>
          </div>

          <div className="users-security-note"><ShieldCheck size={18} /><span>El acceso se controla por organización y rol. Los cambios se aplican de inmediato y quedan registrados en la auditoría.</span></div>
          {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
          {notice && <div className="inline-success" role="status"><Check size={16} />{notice}</div>}

          <section className="users-panel">
            <header className="users-panel-heading">
              <div><h2>Miembros y permisos</h2><p>Asigna roles o suspende temporalmente el acceso</p></div>
              <label className="users-filter"><UserRound size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar por nombre, correo o rol" aria-label="Buscar usuarios" /></label>
            </header>
            {loading ? (
              <div className="users-empty"><span className="asset-loading-mark" /><strong>Cargando cuentas…</strong></div>
            ) : !members.length ? (
              <div className="users-empty"><Users size={24} /><strong>Aún no hay miembros</strong><span>Invita al equipo para asignarles un rol dentro de Sky Logic.</span></div>
            ) : !filteredMembers.length ? (
              <div className="users-empty"><strong>No hay coincidencias</strong><span>Prueba con otro nombre, correo o rol.</span></div>
            ) : (
              <div className="users-list">
                {filteredMembers.map((member) => {
                  const roleId = roleDrafts[member.id] ?? member.role_id
                  const changed = roleId !== member.role_id
                  const isSelf = member.user_id === userId
                  return (
                    <article className={`user-row${member.active ? '' : ' user-row-inactive'}`} key={member.id}>
                      <span className="user-avatar"><UserRound size={18} /></span>
                      <div className="user-identity">
                        <strong>{member.name}{isSelf && <small className="user-self-badge">Tu cuenta</small>}</strong>
                        <span>{member.email}</span>{member.phone && <small>{member.phone}</small>}
                        {canManage && <button className="user-edit-profile" type="button" onClick={() => { setError(''); setNotice(''); setProfileDraft({ name: member.name === 'Usuario sin nombre' ? '' : member.name, phone: member.phone }); setProfileMember(member) }}><Pencil size={12} /> Editar nombre</button>}
                      </div>
                      <div className="user-role-control">
                        <label htmlFor={`role-${member.id}`}>Rol</label>
                        <select id={`role-${member.id}`} value={roleId} onChange={(event) => setRoleDrafts((current) => ({ ...current, [member.id]: event.target.value }))} disabled={!canManage || !member.active || isSelf || saving}>
                          {roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
                        </select>
                        {changed && <button className="user-save-role" type="button" onClick={() => void saveRole(member)} disabled={saving}>Guardar rol</button>}
                      </div>
                      <div className="user-permissions">
                        {(rolePermissions[roleId] ?? []).map((permission) => <span key={permission.code} title={permission.description}>{permission.description}</span>)}
                        {!(rolePermissions[roleId]?.length) && <span>Sin permisos asignados</span>}
                      </div>
                      <div className="user-row-actions">
                        <span className={`user-status${member.active ? ' active' : ''}`}><i />{member.active ? 'Activo' : 'Inactivo'}</span>
                        {canManage && !isSelf && <button className={member.active ? 'user-deactivate' : 'user-reactivate'} type="button" onClick={() => void toggleActive(member)} disabled={saving}>{member.active ? 'Desactivar' : 'Reactivar'}</button>}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {canManage && (
            <section className="users-roles-panel">
              <header className="users-panel-heading"><div><h2>Roles disponibles</h2><p>Los permisos dependen de la configuración aprobada para cada rol</p></div></header>
              <div className="users-role-grid">
                {roles.map((role) => (
                  <article className="users-role-card" key={role.id}>
                    <div className="users-role-title"><ShieldCheck size={17} /><strong>{role.name}</strong></div>
                    <div className="users-role-permissions">{(rolePermissions[role.id] ?? []).map((permission) => <span key={permission.code} title={permission.code}>{permission.description}</span>)}</div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <AnimatePresence>
        {inviteOpen && (
          <motion.div className="users-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInviteOpen(false) }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.section className="users-invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-user-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              <header><div><h2 id="invite-user-title">Invitar usuario</h2><p>Se enviará un enlace de acceso a su correo.</p></div><button className="icon-button" type="button" aria-label="Cerrar formulario" onClick={() => setInviteOpen(false)}><X size={18} /></button></header>
              <form onSubmit={(event) => void submitInvite(event)}>
                <label>Nombre completo<input required maxLength={120} value={invite.displayName} onChange={(event) => setInvite((current) => ({ ...current, displayName: event.target.value }))} /></label>
                <label>Correo electrónico<input required type="email" autoComplete="email" maxLength={254} value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} /></label>
                <label>Teléfono <span>(opcional)</span><input type="tel" maxLength={40} value={invite.phone} onChange={(event) => setInvite((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label>Rol<select required value={invite.roleId} onChange={(event) => setInvite((current) => ({ ...current, roleId: event.target.value }))}><option value="">Selecciona un rol...</option>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
                <div className="users-invite-note"><Shield size={15} /><span>La persona recibirá un correo y podrá iniciar sesión después de aceptar la invitación.</span></div>
                <footer><button className="secondary-button" type="button" onClick={() => setInviteOpen(false)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || !invite.roleId}><MailPlus size={15} />{saving ? 'Enviando…' : 'Enviar invitación'}</button></footer>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {profileMember && (
          <motion.div className="users-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setProfileMember(null) }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.section className="users-invite-modal" role="dialog" aria-modal="true" aria-labelledby="edit-member-profile-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              <header><div><h2 id="edit-member-profile-title">Nombre del usuario</h2><p>Este nombre se verá en operaciones, asignaciones y auditoría.</p></div><button className="icon-button" type="button" aria-label="Cerrar formulario" onClick={() => setProfileMember(null)}><X size={18} /></button></header>
              <form onSubmit={(event) => void saveMemberProfile(event)}>
                {error && <div className="inline-error" role="alert"><AlertTriangle size={17} />{error}</div>}
                <label>Nombre visible<input required autoFocus maxLength={120} value={profileDraft.name} onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. María Gómez" /></label>
                <label>Teléfono <span>(opcional)</span><input type="tel" maxLength={40} value={profileDraft.phone} onChange={(event) => setProfileDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
                <footer><button className="secondary-button" type="button" onClick={() => setProfileMember(null)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar nombre'}</button></footer>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
