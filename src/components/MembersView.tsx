'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  RefreshCw,
  Trash2,
  Mail,
  Shield,
  UserCog,
  X,
  Plus,
  Copy,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';

/**
 * Workspace members, invitations, and teams (Phase 5).
 * - Members: list with roles, change role, remove (owner/admin only).
 * - Invitations: pending email invites with copy-link + revoke.
 * - Teams: create teams and manage their membership.
 * All mutations hit /api/v1/members and /api/v1/teams which enforce RBAC.
 */

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

interface MemberView {
  id: string;
  userId: string;
  email: string;
  role: Role;
  status: string;
  createdAt: string;
  isSelf: boolean;
}

interface InvitationView {
  id: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: string;
  status: string;
  createdAt: string;
}

interface TeamMemberView {
  userId: string;
  email: string;
  createdAt: string;
}

interface TeamView {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  members: TeamMemberView[];
}

export default function MembersView({ lang }: { lang: 'ar' | 'en' }) {
  const ar = lang === 'ar';
  const [members, setMembers] = useState<MemberView[]>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [inviting, setInviting] = useState(false);
  // Team form
  const [teamName, setTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memRes, teamRes] = await Promise.all([fetchWithAuth('/api/v1/members'), fetchWithAuth('/api/v1/teams')]);
      const memData = await memRes.json();
      const teamData = await teamRes.json();
      if (!memRes.ok) {
        setError(memData?.error || (ar ? 'تعذر تحميل الأعضاء' : 'Failed to load members'));
        return;
      }
      setMembers(memData.members || []);
      setInvitations(memData.invitations || []);
      setTeams(teamData.teams || []);
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ في الاتصال' : 'Connection error'));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || (ar ? 'فشل إرسال الدعوة' : 'Invite failed'));
        return;
      }
      setInviteEmail('');
      flash(
        data?.addedDirectly
          ? ar
            ? 'تمت إضافة العضو مباشرة'
            : 'Member added directly'
          : ar
            ? 'تم إرسال الدعوة'
            : 'Invitation sent',
      );
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (userId: string, role: Role) => {
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'changeRole', userId, role }),
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error || (ar ? 'فشل تغيير الدور' : 'Change role failed'));
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    }
  };

  const handleRemove = async (userId: string) => {
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', userId }),
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error || (ar ? 'فشل إزالة العضو' : 'Remove failed'));
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    setError(null);
    try {
      await fetchWithAuth('/api/v1/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revokeInvite', invitationId }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    }
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return;
    setCreatingTeam(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/v1/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: teamName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error || (ar ? 'فشل إنشاء الفريق' : 'Create team failed'));
      else setTeamName('');
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    setError(null);
    try {
      await fetchWithAuth('/api/v1/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', teamId }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    }
  };

  const handleToggleTeamMember = async (teamId: string, userId: string, isMember: boolean) => {
    setError(null);
    try {
      await fetchWithAuth('/api/v1/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isMember ? 'removeMember' : 'addMember', teamId, userId }),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? 'خطأ' : 'Error'));
    }
  };

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/?invite=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const roleLabel = (r: Role) =>
    ({
      owner: ar ? 'مالك' : 'Owner',
      admin: ar ? 'مشرف' : 'Admin',
      editor: ar ? 'محرر' : 'Editor',
      viewer: ar ? 'مشاهد' : 'Viewer',
    })[r];

  return (
    <div className="space-y-6">
      {/* Status banners */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* MEMBERS */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-900">{ar ? 'أعضاء مساحة العمل' : 'Workspace Members'}</h3>
          </div>
          <button onClick={load} className="text-slate-400 hover:text-slate-600" title={ar ? 'تحديث' : 'Refresh'}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Invite form */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Mail className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={ar ? 'البريد الإلكتروني للعضو الجديد' : 'New member email'}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {(['admin', 'editor', 'viewer'] as Role[]).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            <UserPlus className="w-4 h-4" />
            {inviting ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'دعوة' : 'Invite'}
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {members.length === 0 && !loading && (
            <div className="px-6 py-8 text-center text-sm text-slate-400">
              {ar ? 'لا يوجد أعضاء بعد' : 'No members yet'}
            </div>
          )}
          {members.map((m) => (
            <div key={m.id} className="px-6 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 truncate">{m.email || m.userId}</span>
                  {m.isSelf && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                      {ar ? 'أنت' : 'You'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {m.role === 'owner' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                    <Shield className="w-3.5 h-3.5" />
                    {roleLabel('owner')}
                  </span>
                ) : (
                  <select
                    value={m.role}
                    onChange={(e) => handleChangeRole(m.userId, e.target.value as Role)}
                    disabled={m.isSelf}
                    className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                    {(['admin', 'editor', 'viewer'] as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                )}
                {!m.isSelf && m.role !== 'owner' && (
                  <button
                    onClick={() => handleRemove(m.userId)}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                    title={ar ? 'إزالة العضو' : 'Remove member'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PENDING INVITATIONS */}
      {invitations.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <Mail className="w-5 h-5 text-sky-600" />
            <h3 className="font-semibold text-slate-900">{ar ? 'دعوات معلقة' : 'Pending Invitations'}</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {invitations.map((inv) => (
              <div key={inv.id} className="px-6 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{inv.email}</div>
                  <div className="text-xs text-slate-400">
                    {roleLabel(inv.role)} · {ar ? 'تنتهي' : 'expires'}{' '}
                    {new Date(inv.expiresAt).toLocaleDateString(ar ? 'ar' : 'en')}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copyInviteLink(inv.token)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50"
                    title={ar ? 'نسخ رابط الدعوة' : 'Copy invite link'}
                  >
                    {copiedToken === inv.token ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedToken === inv.token ? (ar ? 'تم النسخ' : 'Copied') : ar ? 'نسخ الرابط' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                    title={ar ? 'إلغاء الدعوة' : 'Revoke invitation'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TEAMS */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-3xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <UserCog className="w-5 h-5 text-violet-600" />
          <h3 className="font-semibold text-slate-900">{ar ? 'الفرق' : 'Teams'}</h3>
        </div>
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder={ar ? 'اسم الفريق الجديد' : 'New team name'}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            onClick={handleCreateTeam}
            disabled={creatingTeam || !teamName.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {ar ? 'إنشاء فريق' : 'Create team'}
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {teams.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-slate-400">
              {ar ? 'لا توجد فرق بعد' : 'No teams yet'}
            </div>
          )}
          {teams.map((team) => {
            const memberIds = new Set(team.members.map((m) => m.userId));
            return (
              <div key={team.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{team.name}</div>
                    <div className="text-xs text-slate-400">
                      {team.members.length} {ar ? 'أعضاء' : 'members'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteTeam(team.id)}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                    title={ar ? 'حذف الفريق' : 'Delete team'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const isMember = memberIds.has(m.userId);
                    return (
                      <button
                        key={m.userId}
                        onClick={() => handleToggleTeamMember(team.id, m.userId, isMember)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          isMember
                            ? 'bg-violet-50 border-violet-200 text-violet-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                        title={
                          isMember ? (ar ? 'إزالة من الفريق' : 'Remove from team') : ar ? 'إضافة للفريق' : 'Add to team'
                        }
                      >
                        {m.email || m.userId}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
