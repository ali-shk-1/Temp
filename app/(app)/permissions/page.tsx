'use client';

/**
 * app/permissions/page.tsx — direct port of frontend/permissions.html.
 * Ali-only. The original relied on nav-link visibility + backend 403s,
 * so this page itself checks isAliUser() and redirects, rather than
 * assuming the nav already gated access.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthedPage from '@/components/AuthedPage';
import { api } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { isAliUser } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  principal: 'Principal',
  vice_principal: 'Vice Principal',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

interface PermUser {
  user_id: number;
  username: string;
  is_active: boolean;
}

interface RoleEntry {
  role: string;
  users: PermUser[];
  permissions: Record<string, boolean>;
  page_visibility?: Record<string, boolean>;
}

interface PermGroup {
  label: string;
  permissions: { key: string; label: string }[];
}

interface PermPage {
  key: string;
  label: string;
}

interface PermData {
  groups: PermGroup[];
  roles: RoleEntry[];
  pages: PermPage[];
}

export default function PermissionsPage() {
  return (
    <AuthedPage activePage="permissions">
      <PermissionsContent />
    </AuthedPage>
  );
}

function PermissionsContent() {
  const router = useRouter();

  // Hard guard: this page is for ali only. If anyone else somehow lands
  // here (e.g. typed the URL directly), bounce them to the dashboard —
  // the backend would reject every call here anyway (authorize('ali')),
  // but this keeps the UI from ever showing broken/empty controls.
  useEffect(() => {
    if (!isAliUser()) {
      router.replace('/dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [permData, setPermData] = useState<PermData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Change (admin-reset) password modal
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [pwTitle, setPwTitle] = useState('Change Password');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');

  // Change my (ali's) own password modal
  const [myPwModalOpen, setMyPwModalOpen] = useState(false);
  const [myPwCurrent, setMyPwCurrent] = useState('');
  const [myPwNew, setMyPwNew] = useState('');
  const [myPwConfirm, setMyPwConfirm] = useState('');

  // Create account modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createRole, setCreateRole] = useState('');
  const [createRoleLabel, setCreateRoleLabel] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');

  // Rename username modal
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameUserId, setRenameUserId] = useState<number | null>(null);
  const [renameUsername, setRenameUsername] = useState('');

  const permDataRef = useRef<PermData | null>(null);
  permDataRef.current = permData;

  async function loadPermissions() {
    try {
      const res = await api<PermData>('GET', '/api/permissions');
      setPermData(res ?? null);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    }
  }

  useEffect(() => {
    loadPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLiveUpdates({
    'permissions.changed': () => loadPermissions(),
  });

  async function togglePermission(role: string, key: string, checkbox: HTMLInputElement) {
    const allowed = checkbox.checked;
    checkbox.disabled = true;
    try {
      await api('PUT', `/api/permissions/${role}`, { permission_key: key, allowed });
      showToast(`${allowed ? 'Enabled' : 'Disabled'} "${key}" for ${ROLE_LABELS[role] || role}.`);
      setPermData((prev) => {
        if (!prev) return prev;
        const next: PermData = { ...prev, roles: prev.roles.map((r) => ({ ...r, permissions: { ...r.permissions } })) };
        const entry = next.roles.find((r) => r.role === role);
        if (entry) entry.permissions[key] = allowed;
        return next;
      });
    } catch (e: any) {
      checkbox.checked = !allowed; // revert on failure
      showToast(e.message, 'error');
    } finally {
      checkbox.disabled = false;
    }
  }

  async function togglePageVisibility(role: string, pageKey: string, checkbox: HTMLInputElement) {
    const visible = checkbox.checked;
    checkbox.disabled = true;
    try {
      await api('PUT', `/api/permissions/${role}/visibility`, { page_key: pageKey, visible });
      showToast(`${visible ? 'Showed' : 'Hid'} "${pageKey}" page for ${ROLE_LABELS[role] || role}.`);
      setPermData((prev) => {
        if (!prev) return prev;
        const next: PermData = {
          ...prev,
          roles: prev.roles.map((r) => ({ ...r, page_visibility: { ...(r.page_visibility || {}) } })),
        };
        const entry = next.roles.find((r) => r.role === role);
        if (entry) entry.page_visibility![pageKey] = visible;
        return next;
      });
    } catch (e: any) {
      checkbox.checked = !visible; // revert on failure
      showToast(e.message, 'error');
    } finally {
      checkbox.disabled = false;
    }
  }

  function openPwModal(userId: number, username: string) {
    setPwUserId(userId);
    setPwNew('');
    setPwConfirm('');
    setPwTitle(`Change Password — ${username}`);
    setPwModalOpen(true);
  }
  function closePwModal() {
    setPwModalOpen(false);
  }

  function openMyPwModal() {
    setMyPwCurrent('');
    setMyPwNew('');
    setMyPwConfirm('');
    setMyPwModalOpen(true);
  }
  function closeMyPwModal() {
    setMyPwModalOpen(false);
  }

  // ali's self-service password change. Goes through
  // POST /api/auth/change-password (works for any authenticated user)
  // rather than the admin-reset endpoint above, since that one is
  // scoped to admin/principal/vice_principal/accountant/viewer accounts
  // only and requires no current-password check — appropriate for ali
  // resetting someone else's forgotten password, not for ali changing
  // their own.
  async function saveMyPassword() {
    if (!myPwCurrent) {
      showToast('Enter your current password.', 'error');
      return;
    }
    if (!myPwNew || myPwNew.length < 6) {
      showToast('New password must be at least 6 characters.', 'error');
      return;
    }
    if (myPwNew !== myPwConfirm) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    try {
      await api('POST', '/api/auth/change-password', {
        current_password: myPwCurrent,
        new_password: myPwNew,
      });
      showToast('Your password has been updated.');
      closeMyPwModal();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  function openCreateModal(role: string, roleLabel: string) {
    setCreateRole(role);
    setCreateRoleLabel(roleLabel);
    setCreateUsername('');
    setCreatePassword('');
    setCreateModalOpen(true);
  }
  function closeCreateModal() {
    setCreateModalOpen(false);
  }

  async function saveCreate() {
    const username = createUsername.trim();
    const password = createPassword;
    if (!username) {
      showToast('Username is required.', 'error');
      return;
    }
    if (!password || password.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }
    try {
      await api('POST', `/api/permissions/users/${createRole}`, { username, password });
      showToast('Account created.');
      closeCreateModal();
      loadPermissions();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // Enable/disable without deleting the account — its role and every
  // permission toggle set for that role stay exactly as they were;
  // a disabled account just can't log in (see POST /api/auth/login,
  // which checks is_active).
  async function toggleUserActive(userId: number, currentlyActive: boolean) {
    const verb = currentlyActive ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${verb} this account?`)) return;
    try {
      await api('PATCH', `/api/permissions/users/${userId}/toggle`);
      showToast(`Account ${currentlyActive ? 'disabled' : 'enabled'}.`);
      loadPermissions();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  function openRenameModal(userId: number, username: string) {
    setRenameUserId(userId);
    setRenameUsername(username);
    setRenameModalOpen(true);
  }
  function closeRenameModal() {
    setRenameModalOpen(false);
  }

  async function saveRename() {
    const username = renameUsername.trim();
    if (!username) {
      showToast('Username is required.', 'error');
      return;
    }
    try {
      await api('PUT', `/api/permissions/users/${renameUserId}`, { username });
      showToast('Username updated.');
      closeRenameModal();
      loadPermissions();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function savePassword() {
    if (!pwNew || pwNew.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }
    if (pwNew !== pwConfirm) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    try {
      await api('POST', `/api/permissions/users/${pwUserId}/password`, { new_password: pwNew });
      showToast('Password updated.');
      closePwModal();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <>
      {/* Change Password Modal (admin-reset, for admin/principal/vice_principal/accountant/viewer accounts) */}
      <div className={`modal-overlay${pwModalOpen ? ' open' : ''}`}>
        <div className="modal max-w-[380px]">
          <div className="modal-header">
            <h2 className="modal-title">{pwTitle}</h2>
            <button className="modal-close" onClick={closePwModal}>
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>New Password *</label>
              <input
                type="password"
                placeholder="At least 6 characters"
                autoComplete="new-password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Confirm New Password *</label>
              <input
                type="password"
                placeholder="Re-enter password"
                autoComplete="new-password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closePwModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={savePassword}>
                Update Password
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Change My (ali's own) Password Modal */}
      <div className={`modal-overlay${myPwModalOpen ? ' open' : ''}`}>
        <div className="modal max-w-[380px]">
          <div className="modal-header">
            <h2 className="modal-title">Change My Password</h2>
            <button className="modal-close" onClick={closeMyPwModal}>
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Current Password *</label>
              <input
                type="password"
                placeholder="Your current password"
                autoComplete="current-password"
                value={myPwCurrent}
                onChange={(e) => setMyPwCurrent(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>New Password *</label>
              <input
                type="password"
                placeholder="At least 6 characters"
                autoComplete="new-password"
                value={myPwNew}
                onChange={(e) => setMyPwNew(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Confirm New Password *</label>
              <input
                type="password"
                placeholder="Re-enter password"
                autoComplete="new-password"
                value={myPwConfirm}
                onChange={(e) => setMyPwConfirm(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeMyPwModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveMyPassword}>
                Update Password
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Create Account Modal */}
      <div className={`modal-overlay${createModalOpen ? ' open' : ''}`}>
        <div className="modal max-w-[380px]">
          <div className="modal-header">
            <h2 className="modal-title">Create Account — {createRoleLabel}</h2>
            <button className="modal-close" onClick={closeCreateModal}>
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Username *</label>
              <input
                type="text"
                placeholder="Username"
                autoComplete="off"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Password *</label>
              <input
                type="password"
                placeholder="At least 6 characters"
                autoComplete="new-password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeCreateModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveCreate}>
                Create Account
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Rename Username Modal */}
      <div className={`modal-overlay${renameModalOpen ? ' open' : ''}`}>
        <div className="modal max-w-[380px]">
          <div className="modal-header">
            <h2 className="modal-title">Rename Account — {renameUsername}</h2>
            <button className="modal-close" onClick={closeRenameModal}>
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Username *</label>
              <input
                type="text"
                placeholder="New username"
                value={renameUsername}
                onChange={(e) => setRenameUsername(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeRenameModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveRename}>
                Save
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Permissions</h1>
          <span className="ali-badge">Ali — Top Level Access</span>
        </div>

        <div className="card mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold mb-0.5">My Account</div>
              <div className="text-muted text-xs">Change the password for your own "ali" login.</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={openMyPwModal}>
              Change My Password
            </button>
          </div>
        </div>

        <div className="card mb-4">
          <p className="text-muted text-[13px] leading-[1.6]">
            Toggle exactly what each account is allowed to do. Turning something off hides that button/action for
            every user with that role, immediately — no re-login required for pages loaded after the change. Ali
            always has every permission and cannot be restricted here. Each role has exactly one login account —
            create it if missing, or enable/disable it without losing its permission settings.
          </p>
        </div>

        <div id="permissionsContainer">
          {loadError ? (
            <div className="card empty">Failed to load permissions: {loadError}</div>
          ) : !permData ? (
            <div className="card loading">Loading permissions…</div>
          ) : (
            permData.roles.map((roleEntry) => {
              const roleLabel = ROLE_LABELS[roleEntry.role] || roleEntry.role;
              const usernames = roleEntry.users.length
                ? roleEntry.users.map((u) => `${u.username}${u.is_active ? '' : ' (disabled)'}`).join(', ')
                : 'No account currently has this role';
              const firstUser = roleEntry.users[0];

              return (
                <div className="card perm-user-card" key={roleEntry.role}>
                  <div className="perm-user-header">
                    <div>
                      <div className="perm-user-title">{roleLabel}</div>
                      <div className="perm-user-sub">{usernames}</div>
                    </div>
                    {firstUser ? (
                      <div className="flex gap-2 flex-wrap">
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => openRenameModal(firstUser.user_id, firstUser.username)}
                        >
                          Rename
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => openPwModal(firstUser.user_id, firstUser.username)}
                        >
                          Change Password
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => toggleUserActive(firstUser.user_id, firstUser.is_active)}
                        >
                          {firstUser.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => openCreateModal(roleEntry.role, roleLabel)}
                      >
                        Create Account
                      </button>
                    )}
                  </div>

                  <div className="perm-section-title">Nav Pages Visible</div>
                  <div className="perm-pages-grid">
                    {(permData.pages || []).map((p) => (
                      <div className="perm-row border-b-0" key={p.key}>
                        <span>{p.label}</span>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={roleEntry.page_visibility ? roleEntry.page_visibility[p.key] !== false : true}
                            onChange={(e) => togglePageVisibility(roleEntry.role, p.key, e.currentTarget)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </div>
                    ))}
                  </div>

                  <div className="perm-section-title">Actions</div>
                  <div className="perm-groups-wrap">
                    {permData.groups.map((g) => (
                      <div className="perm-group-card" key={g.label}>
                        <div className="perm-group-title">{g.label}</div>
                        <div className="perm-grid">
                          {g.permissions.map((p) => (
                            <div className="perm-row" key={p.key}>
                              <span>{p.label}</span>
                              <label className="toggle-switch">
                                <input
                                  type="checkbox"
                                  checked={!!roleEntry.permissions[p.key]}
                                  onChange={(e) => togglePermission(roleEntry.role, p.key, e.currentTarget)}
                                />
                                <span className="toggle-slider"></span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
