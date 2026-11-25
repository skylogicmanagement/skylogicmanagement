import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' })

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return respond(401, { error: 'A valid user session is required' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, { error: 'User invitation service is not configured' })
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token)
  if (callerError || !callerData.user) return respond(401, { error: 'The current user session is invalid' })

  let input: Record<string, unknown>
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) return respond(400, { error: 'Request body must be a JSON object' })
    input = body
  } catch {
    return respond(400, { error: 'Request body must be valid JSON' })
  }

  const orgId = typeof input.orgId === 'string' ? input.orgId : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : ''
  const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
  const roleId = typeof input.roleId === 'string' ? input.roleId : ''
  if (!orgId || !roleId || !displayName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'Organization, role, name, and a valid email address are required' })
  }

  const { data: canManage, error: permissionError } = await callerClient.rpc('has_org_permission', {
    target_org: orgId,
    permission: 'users.manage',
  })
  if (permissionError) return respond(500, { error: permissionError.message })
  if (!canManage) return respond(403, { error: 'You do not have permission to manage users in this organization' })

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: role, error: roleError } = await adminClient
    .from('roles')
    .select('id')
    .eq('id', roleId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (roleError) return respond(500, { error: roleError.message })
  if (!role) return respond(400, { error: 'Selected role does not belong to this organization' })

  let userId: string | null = null
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return respond(500, { error: error.message })
    const existing = data.users.find((user) => user.email?.toLowerCase() === email)
    if (existing) {
      userId = existing.id
      break
    }
    if (data.users.length < 1000) break
  }

  let invitationSent = false
  if (!userId) {
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName },
    })
    if (error) return respond(400, { error: error.message })
    userId = data.user?.id ?? null
    invitationSent = true
  }

  if (!userId) return respond(500, { error: 'Supabase Auth did not return a user identifier' })

  const { data: targetMembership, error: targetMembershipError } = await callerClient
    .from('memberships')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (targetMembershipError) return respond(500, { error: targetMembershipError.message })
  if (targetMembership) {
    if (invitationSent) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId)
      if (cleanupError) {
        return respond(500, { error: `This account already belongs to the organization. The new Auth invitation could not be rolled back: ${cleanupError.message}` })
      }
    }
    return respond(409, { error: 'This account already belongs to the organization' })
  }

  const { error: membershipError } = await callerClient.rpc('create_org_membership', {
    p_org_id: orgId,
    p_user_id: userId,
    p_role_id: roleId,
    p_display_name: displayName,
    p_phone: phone || null,
    p_email: email,
  })
  if (membershipError) {
    if (invitationSent) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId)
      if (cleanupError) {
        return respond(500, { error: `${membershipError.message}. The invited Auth user could not be rolled back: ${cleanupError.message}` })
      }
    }
    return respond(400, { error: membershipError.message })
  }

  return respond(200, {
    userId,
    invitationSent,
    message: invitationSent ? 'Invitation sent and organization access configured' : 'Existing account added to the organization',
  })
})
