/**
 * Ember Halo — Admin Collaboration API
 * Mutual approval required before any data sharing.
 * All actions audit-logged.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CollabLevel = 'basic_connection' | 'overflow_support' | 'calendar_coordination' | 'special_request_support' | 'city_coverage' | 'full_partner';

// ── SEND REQUEST ──────────────────────────────────────────────

export async function sendCollaborationRequest(params: {
  requester_admin_id: string;
  receiver_admin_id: string;
  level: CollabLevel;
  note?: string;
}) {
  if (params.requester_admin_id === params.receiver_admin_id) {
    throw new Error('Cannot collaborate with yourself');
  }

  // Check not already connected
  const { data: existing } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .select('id, status')
    .or(
      `and(requester_admin_id.eq.${params.requester_admin_id},receiver_admin_id.eq.${params.receiver_admin_id}),` +
      `and(requester_admin_id.eq.${params.receiver_admin_id},receiver_admin_id.eq.${params.requester_admin_id})`
    )
    .maybeSingle();  // null when no existing collab — .single() would throw

  if (existing) {
    if (existing.status === 'active') throw new Error('Already connected');
    if (existing.status === 'pending') throw new Error('Request already pending');
  }

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .insert({
      requester_admin_id: params.requester_admin_id,
      receiver_admin_id: params.receiver_admin_id,
      level: params.level,
      status: 'pending',
      request_note: params.note ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: params.requester_admin_id,
    action: 'collaboration_requested',
    entity_type: 'collaboration',
    entity_id: data.id,
    metadata: { receiver: params.receiver_admin_id, level: params.level },
  });

  // Notify receiver via n8n
  await triggerN8nEvent('collaboration_request_received', {
    collaboration_id: data.id,
    requester_admin_id: params.requester_admin_id,
    receiver_admin_id: params.receiver_admin_id,
    level: params.level,
  });

  return data;
}

// ── RESPOND TO REQUEST ────────────────────────────────────────

export async function respondToCollaboration(params: {
  admin_id: string;   // must be the receiver
  collaboration_id: string;
  action: 'accepted' | 'rejected';
}) {
  const { data: collab, error } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .select('*')
    .eq('id', params.collaboration_id)
    .eq('receiver_admin_id', params.admin_id)
    .eq('status', 'pending')
    .single();

  if (error || !collab) throw new Error('Collaboration request not found or already resolved');

  const newStatus = params.action === 'accepted' ? 'active' : 'rejected';

  const { data, error: updateErr } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', params.collaboration_id)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: params.admin_id,
    action: `collaboration_${params.action}`,
    entity_type: 'collaboration',
    entity_id: params.collaboration_id,
  });

  return data;
}

// ── REVOKE COLLABORATION ──────────────────────────────────────

export async function revokeCollaboration(adminId: string, collaborationId: string) {
  const { data: collab } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .select('id, requester_admin_id, receiver_admin_id')
    .eq('id', collaborationId)
    .or(`requester_admin_id.eq.${adminId},receiver_admin_id.eq.${adminId}`)
    .maybeSingle();  // null when not found — .single() would throw

  if (!collab) throw new Error('Collaboration not found or unauthorized');

  const isRequester = collab.requester_admin_id === adminId;
  const updateField = isRequester ? 'requester_revoked' : 'receiver_revoked';

  await supabase
    .schema('ember_halo')
    .from('collaborations')
    .update({
      [updateField]: true,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .eq('id', collaborationId);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: 'collaboration_revoked',
    entity_type: 'collaboration',
    entity_id: collaborationId,
  });

  return { ok: true };
}

// ── LIST COLLABORATIONS ───────────────────────────────────────

export async function listCollaborations(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .select(`
      id, level, status, request_note, created_at, updated_at,
      requester_admin_id, receiver_admin_id
    `)
    .or(`requester_admin_id.eq.${adminId},receiver_admin_id.eq.${adminId}`)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map(c => ({
    ...c,
    direction: c.requester_admin_id === adminId ? 'outgoing' : 'incoming',
    partner_admin_id: c.requester_admin_id === adminId ? c.receiver_admin_id : c.requester_admin_id,
  }));
}

async function triggerN8nEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const base = process.env.N8N_WEBHOOK_BASE_URL;
  if (!base) return;
  try {
    await fetch(`${base}/ember-halo/${eventType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventType, ...payload, timestamp: new Date().toISOString() }),
    });
  } catch { /* non-fatal */ }
}
