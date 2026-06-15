/**
 * Private staff direct messages (per login account).
 */
(function () {
  const TOKEN_KEY = 'ocean_staff_token';
  const PROFILE_KEY = 'ocean_staff_profile';

  let pollTimer = null;
  let unreadPollTimer = null;
  let markSeenTimer = null;
  let lastSeenMessageIds = new Set();
  let pollPrimed = false;
  let contacts = [];
  let activePeerId = null;
  let activeObservePeerId = null;
  let activeGroupId = null;
  let activeClassChannel = null;
  let observerMode = false;
  let newChatMode = 'dm';
  let selectedGroupMemberIds = new Set();
  let inboxRows = [];
  let totalUnreadCount = 0;
  let lastThreadSnapshot = '';
  let voiceSharePending = null;
  let activeHeaderProfile = null;

  function isDirectorDashboard() {
    return document.body.classList.contains('app-director');
  }

  function isHeadDashboard() {
    return document.body.classList.contains('app-head');
  }

  function messagesPanelEl() {
    return document.getElementById('panel-messages') || document.getElementById('panel-skill-messages');
  }

  function messagesPanelId() {
    const p = messagesPanelEl();
    return p ? p.id : '';
  }

  function isSkillDashboard() {
    return !!document.getElementById('panel-skill-messages');
  }

  function isClassDashboard() {
    return !!document.getElementById('panel-messages') && !isDirectorDashboard() && !isHeadDashboard();
  }

  function isTeacherDmDashboard() {
    return isClassDashboard() || isSkillDashboard();
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function isLocalhost() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1';
  }

  function authHeaders(json) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const h = token ? { Authorization: 'Bearer ' + token } : {};
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function expectedDashboardRole() {
    if (isDirectorDashboard()) return 'director';
    if (isHeadDashboard()) return 'head_teacher';
    return null;
  }

  async function syncStaffProfile() {
    const res = await fetch('/api/auth/staff-me', { headers: authHeaders() });
    const out = await parseResponse(res);
    if (!out.ok || !out.data) return null;
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(out.data));
    return out.data;
  }

  function sessionMatchesDashboard(st) {
    if (!st || !st.role) return false;
    if (String(st.role) === 'system_admin' || String(st.role) === 'ghost') return true;
    const want = expectedDashboardRole();
    if (want) return st.role === want;
    const ok = ['director', 'head_teacher', 'class_teacher', 'skill_teacher'];
    return ok.indexOf(String(st.role)) !== -1;
  }

  function isGhostObserverMode() {
    const auth = window.OceanStaffAuth;
    if (auth && typeof auth.isSystemAdminStaff === 'function') {
      return auth.isSystemAdminStaff(currentStaff());
    }
    if (auth && typeof auth.isGhostStaff === 'function') {
      return auth.isGhostStaff(currentStaff());
    }
    const st = currentStaff();
    const r = st && String(st.role);
    return r === 'system_admin' || r === 'ghost';
  }

  function isObservingStaffChat() {
    return isGhostObserverMode() && activeObservePeerId != null;
  }

  /** Read-only observer UI is for System admin only. */
  function isReadOnlyMessageView() {
    if (!isGhostObserverMode()) return false;
    return isObservingStaffChat() || !!activeClassChannel || !!activeGroupId;
  }

  function ensureObserverHint() {
    if (document.getElementById('dm-observer-hint')) return;
    const form = document.getElementById('form-leader-message');
    if (!form || !form.parentNode) return;
    const hint = document.createElement('p');
    hint.id = 'dm-observer-hint';
    hint.className = 'class-messages-feedback';
    hint.hidden = true;
    hint.style.color = 'var(--muted)';
    hint.style.fontSize = '0.88rem';
    hint.style.margin = '0.35rem 0 0';
    form.parentNode.insertBefore(hint, form);
  }

  async function ensureStaffAuth() {
    const wantRole = expectedDashboardRole();
    let st = currentStaff();
    const token = sessionStorage.getItem(TOKEN_KEY);

    if (token && st && sessionMatchesDashboard(st)) {
      await syncStaffProfile();
      return true;
    }

    if (token && st && !sessionMatchesDashboard(st)) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(PROFILE_KEY);
      st = null;
    } else if (token && !st) {
      const synced = await syncStaffProfile();
      if (synced && sessionMatchesDashboard(synced)) return true;
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(PROFILE_KEY);
    }

    if (sessionStorage.getItem(TOKEN_KEY) && currentStaff()) return true;

    if (!isLocalhost()) {
      setFeedback(
        'Sign in with your staff account to use private messages. Each person only sees their own inbox.',
        false
      );
      return false;
    }

    if (isTeacherDmDashboard()) {
      setFeedback(
        'Sign in with your staff account (your school email), then open Messages again.',
        false
      );
      return false;
    }

    const res = await fetch('/api/auth/dev-session?as=' + encodeURIComponent(wantRole || 'head_teacher'));
    const out = await parseResponse(res);
    if (!out.ok || !out.data || !out.data.token) {
      setFeedback((out.data && out.data.error) || 'Could not start test session.', false);
      return false;
    }
    sessionStorage.setItem(TOKEN_KEY, out.data.token);
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(out.data.staff || {}));
    return true;
  }

  function isImagePath(path, name) {
    const s = String(path || '') + ' ' + String(name || '');
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s);
  }

  function isAudioAttachment(path, name) {
    if (window.OceanDmVoice && window.OceanDmVoice.isAudioAttachment) {
      return window.OceanDmVoice.isAudioAttachment(path, name);
    }
    const s = String(path || '') + ' ' + String(name || '');
    return /voice-note|\.(webm|ogg|m4a|mp3|wav|aac|opus)$/i.test(s);
  }

  function updateAttachPreview() {
    const input = document.getElementById('leader-messages-attachment');
    const label = document.getElementById('dm-attach-name');
    if (!label) return;
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (!file) {
      label.textContent = '';
      label.hidden = true;
      return;
    }
    label.hidden = false;
    const isVoice =
      /^voice-note/i.test(file.name) || (file.type && String(file.type).indexOf('audio/') === 0);
    const kind = isVoice ? 'Voice note' : file.name;
    label.textContent = kind + (file.size ? ' (' + Math.round(file.size / 1024) + ' KB)' : '');
  }

  function currentStaff() {
    try {
      const raw = sessionStorage.getItem(PROFILE_KEY) || '';
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function myStaffId() {
    const st = currentStaff();
    return st && st.id != null ? Number(st.id) : null;
  }

  function myRoleLabel() {
    const st = currentStaff();
    if (st && st.workspace_label) return st.workspace_label;
    if (st && st.role) return roleLabel(st.role);
    return isDirectorDashboard() ? 'Director' : 'Head teacher';
  }

  function myDisplayName() {
    const st = currentStaff();
    if (st && st.display_name && String(st.display_name).trim()) return String(st.display_name).trim();
    return isDirectorDashboard() ? 'Director' : 'Head teacher';
  }

  const CLASS_TITLES = {
    daycare: 'Day Care',
    baby: 'Baby Class',
    middle: 'Middle Class',
    top: 'Top Class',
    primary1: 'Primary One',
    primary2: 'Primary Two',
  };

  function staffScopeLabel(row) {
    if (!row) return '—';
    if (row.scope_label) return row.scope_label;
    const r = String(row.role || '').trim();
    const cl = String(row.class_level || '').trim();
    if (r === 'class_teacher' && cl) {
      const title = CLASS_TITLES[cl] || cl;
      const st = String(row.stream || '').trim();
      return st ? title + ' · ' + st : title;
    }
    if (r === 'skill_teacher' && cl) return cl;
    return '—';
  }

  function contactWorkspaceLine(c) {
    if (!c) return '';
    if (c.workspace_label) return c.workspace_label;
    const parts = [c.role_label || roleLabel(c.role)];
    if (c.class_label) parts.push(c.class_label);
    return parts.join(' · ');
  }

  function mapStaffRowToContact(r) {
    return {
      id: r.id,
      email: r.email,
      display_name: r.display_name,
      role: r.role,
      role_label: roleLabel(r.role),
      class_level: r.class_level,
      stream: r.stream || '',
      avatar_url: r.avatar_url || null,
      scope_label: staffScopeLabel(r),
      workspace_label: contactWorkspaceLine({
        role: r.role,
        role_label: roleLabel(r.role),
        class_level: r.class_level,
        stream: r.stream,
        class_label: staffScopeLabel(r),
      }),
    };
  }

  function staffAvatarHtml(url, name, className) {
    const label = escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?');
    const cls = 'dm-staff-avatar' + (className ? ' ' + className : '');
    if (url && String(url).trim()) {
      return (
        '<img class="' +
        cls +
        '" src="' +
        escapeHtml(String(url).trim()) +
        '" alt="" width="36" height="36" loading="lazy" />'
      );
    }
    return '<span class="' + cls + ' dm-staff-avatar-initial" aria-hidden="true">' + label + '</span>';
  }

  function ensureDmProfileModal() {
    let modal = document.getElementById('dm-profile-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'dm-profile-modal';
    modal.className = 'modal-overlay dm-profile-modal';
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML =
      '<div class="modal dm-profile-card" role="dialog" aria-modal="true" aria-labelledby="dm-profile-name">' +
      '<button type="button" class="dm-profile-close" aria-label="Close">×</button>' +
      '<div id="dm-profile-photo" class="dm-profile-photo"></div>' +
      '<h3 id="dm-profile-name" class="dm-profile-name"></h3>' +
      '<p id="dm-profile-role" class="dm-profile-role"></p>' +
      '<p id="dm-profile-email" class="dm-profile-email"></p>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeDmProfile();
    });
    const close = modal.querySelector('.dm-profile-close');
    if (close) close.addEventListener('click', closeDmProfile);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeDmProfile();
    });
    return modal;
  }

  function openDmProfile(profile) {
    if (!profile) return;
    const modal = ensureDmProfileModal();
    const name = String(profile.display_name || profile.name || 'Staff').trim() || 'Staff';
    const role = String(profile.workspace_label || profile.role_label || profile.role || '').trim();
    const email = String(profile.email || '').trim();
    const avatar = String(profile.avatar_url || '').trim();
    const photo = document.getElementById('dm-profile-photo');
    const nameEl = document.getElementById('dm-profile-name');
    const roleEl = document.getElementById('dm-profile-role');
    const emailEl = document.getElementById('dm-profile-email');
    if (photo) {
      photo.innerHTML = avatar
        ? '<img src="' + escapeHtml(avatar) + '" alt="" />'
        : '<span aria-hidden="true">' + escapeHtml(name.charAt(0).toUpperCase() || '?') + '</span>';
    }
    if (nameEl) nameEl.textContent = name;
    if (roleEl) {
      roleEl.textContent = role;
      roleEl.hidden = !role;
    }
    if (emailEl) {
      emailEl.textContent = email;
      emailEl.hidden = !email;
    }
    modal.removeAttribute('hidden');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeDmProfile() {
    const modal = document.getElementById('dm-profile-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
  }

  function hasOpenChat() {
    return !!(activePeerId || activeGroupId || activeClassChannel);
  }

  function dashboardClassContext() {
    const dash = window.__oceanDashboard;
    if (!dash || !dash.classLevel) return null;
    return { classLevel: dash.classLevel, stream: dash.stream || '' };
  }

  function syncObserverComposeUi() {
    const form = document.getElementById('form-leader-message');
    const hint = document.getElementById('dm-observer-hint');
    const readOnly = isReadOnlyMessageView();
    if (form) form.hidden = readOnly;
    if (window.OceanDmVoice && window.OceanDmVoice.syncVoiceUi) {
      window.OceanDmVoice.syncVoiceUi(readOnly);
    }
    if (hint) {
      if (!isGhostObserverMode()) {
        hint.hidden = true;
        hint.textContent = '';
      } else {
        ensureObserverHint();
        hint.hidden = !readOnly;
        if (readOnly) {
          hint.textContent = activeClassChannel
            ? 'Viewing class & skill messages (read-only). Use New chat to message someone directly.'
            : activeGroupId
            ? 'Viewing as system admin — read-only group chat. Use New chat to message someone directly.'
            : 'Viewing as system admin — read-only conversation. Use New chat to message someone directly.';
        }
      }
    }
  }

  function updateClearChatButton() {
    const btn = document.getElementById('dm-clear-chat-btn');
    if (!btn) return;
    btn.hidden = !hasOpenChat() || isReadOnlyMessageView();
  }

  function classMessageSenderLabel() {
    const name = myDisplayName();
    if (name && String(name).trim()) return String(name).trim();
    try {
      const dash = dashboardClassContext();
      const suffix = dash
        ? '_' + String(dash.classLevel || '').trim().toLowerCase() + '_' + (String(dash.stream || '').trim().toLowerCase() || '_')
        : '';
      const n =
        (suffix && localStorage.getItem('ocean_displayName' + suffix)) ||
        localStorage.getItem('ocean_displayName');
      if (n && String(n).trim()) return String(n).trim();
    } catch (_) {}
    return 'Teacher';
  }

  function setNewChatMode(mode) {
    newChatMode = mode === 'group' ? 'group' : 'dm';
    selectedGroupMemberIds = new Set();
    const dmTab = document.getElementById('dm-new-mode-dm');
    const groupTab = document.getElementById('dm-new-mode-group');
    const hint = document.getElementById('dm-new-mode-hint');
    const groupFields = document.getElementById('dm-new-group-fields');
    const createBtn = document.getElementById('dm-create-group-btn');
    if (dmTab) dmTab.classList.toggle('is-active', newChatMode === 'dm');
    if (groupTab) groupTab.classList.toggle('is-active', newChatMode === 'group');
    if (groupFields) groupFields.hidden = newChatMode !== 'group';
    if (createBtn) createBtn.hidden = newChatMode !== 'group';
    if (hint) {
      hint.textContent =
        newChatMode === 'group'
          ? 'Select staff, name the group, then tap Create group. Only members can see and send messages.'
          : 'Tap someone’s account to open a private chat. Only that login sees your messages.';
    }
    const search = document.getElementById('dm-account-search');
    renderAccountList(search ? search.value : '');
  }

  function roleLabel(role) {
    const map = {
      director: 'Director',
      head_teacher: 'Head teacher',
      class_teacher: 'Class teacher',
      skill_teacher: 'Skill teacher',
    };
    return map[String(role || '').trim()] || String(role || '').replace(/_/g, ' ');
  }

  function dmNewModalEl() {
    return document.getElementById('dm-new-modal');
  }

  function openDmNewModal() {
    const modal = dmNewModalEl();
    if (!modal) return;
    modal.removeAttribute('hidden');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeDmNewModal() {
    const modal = dmNewModalEl();
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
  }

  function voiceShareModalEl() {
    return document.getElementById('dm-voice-share-modal');
  }

  function ensureVoiceShareModal() {
    if (voiceShareModalEl()) return;
    const overlay = document.createElement('div');
    overlay.id = 'dm-voice-share-modal';
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'dm-voice-share-title');
    overlay.setAttribute('hidden', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="modal dm-new-modal-card dm-voice-share-modal-card">' +
      '<h3 id="dm-voice-share-title">Share voice note</h3>' +
      '<p class="dir-muted dm-new-mode-hint">Choose a staff account. The voice note will be sent as a private message.</p>' +
      '<label class="sr-only" for="dm-voice-share-search">Search accounts</label>' +
      '<input id="dm-voice-share-search" type="search" class="dm-account-search" placeholder="Search name, email, role, or class…" autocomplete="off" />' +
      '<div id="dm-voice-share-list" class="dm-account-list" role="listbox" aria-label="Staff accounts"></div>' +
      '<div class="dm-new-modal-actions">' +
      '<button type="button" class="btn" id="dm-voice-share-cancel">Cancel</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const cancelBtn = document.getElementById('dm-voice-share-cancel');
    const search = document.getElementById('dm-voice-share-search');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeVoiceShareModal);
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeVoiceShareModal();
    });
    if (search) {
      search.addEventListener('input', function () {
        renderVoiceShareAccountList(search.value);
      });
    }
  }

  function openVoiceShareModal() {
    ensureVoiceShareModal();
    const modal = voiceShareModalEl();
    if (!modal) return;
    modal.removeAttribute('hidden');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeVoiceShareModal() {
    const modal = voiceShareModalEl();
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    voiceSharePending = null;
  }

  function renderVoiceShareAccountList(filterText) {
    const list = document.getElementById('dm-voice-share-list');
    if (!list) return;
    const q = String(filterText || '')
      .trim()
      .toLowerCase();
    const rows = contacts.filter(function (c) {
      if (!q) return true;
      const hay =
        (c.display_name || '') +
        ' ' +
        (c.email || '') +
        ' ' +
        (c.role || '') +
        ' ' +
        (c.scope_label || '') +
        ' ' +
        (c.workspace_label || '') +
        ' ' +
        (c.role_label || '');
      return hay.toLowerCase().indexOf(q) !== -1;
    });
    if (filterText === 'Loading…') {
      list.innerHTML = '<p class="dm-inbox-empty">Loading staff accounts…</p>';
      return;
    }
    if (!rows.length) {
      list.innerHTML =
        '<p class="dm-inbox-empty">No matching staff accounts. Active accounts from Staff &amp; accounts appear here.</p>';
      return;
    }
    list.innerHTML = '';
    rows.forEach(function (c) {
      const roleTxt = String(c.role || '').trim() || roleLabel(c.role);
      const scopeTxt = staffScopeLabel(c);
      const avatarBlock = staffAvatarHtml(c.avatar_url, c.display_name, 'dm-account-avatar');
      const bodyHtml =
        '<span class="dm-account-body">' +
        '<strong class="dm-account-name">' +
        escapeHtml(c.display_name) +
        '</strong>' +
        '<span class="dm-account-meta">' +
        '<span class="dm-account-role">' +
        escapeHtml(roleTxt) +
        '</span>' +
        '<span class="dm-account-scope">' +
        escapeHtml(scopeTxt) +
        '</span>' +
        '</span>' +
        '<span class="dm-account-email">' +
        escapeHtml(c.email || '') +
        '</span>' +
        '</span>';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dm-account-item';
      btn.innerHTML = avatarBlock + bodyHtml;
      btn.addEventListener('click', function () {
        shareVoiceToStaff(c);
      });
      list.appendChild(btn);
    });
  }

  async function shareVoiceToStaff(contact) {
    const pending = voiceSharePending;
    if (!pending || !contact) return;
    if (isReadOnlyMessageView()) {
      flash('You cannot share messages in read-only mode.', false);
      return;
    }
    const targetName = contact.display_name || contact.email || 'staff member';
    closeVoiceShareModal();
    try {
      const url = new URL(pending.path, window.location.origin).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error('load failed');
      const blob = await res.blob();
      const fileName = pending.name || 'voice-note.webm';
      const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });
      const fd = new FormData();
      fd.append('recipient_staff_id', String(contact.id));
      fd.append('body', '');
      fd.append('attachment', file);
      const sendRes = await fetch('/api/staff-messages', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      const out = await parseResponse(sendRes);
      if (!out.ok) {
        flash((out.data && out.data.error) || 'Could not share voice note.', false);
        return;
      }
      flash('Voice note sent to ' + targetName + '.', true);
      await loadInbox();
    } catch (_) {
      flash('Could not share voice note.', false);
    }
  }

  async function openVoiceSharePicker(path, name) {
    if (isReadOnlyMessageView()) {
      flash('You cannot share messages in read-only mode.', false);
      return;
    }
    if (!sessionStorage.getItem(TOKEN_KEY)) {
      flash('Sign in to share voice notes.', false);
      return;
    }
    voiceSharePending = { path: path, name: name || 'voice-note.webm' };
    ensureVoiceShareModal();
    openVoiceShareModal();
    const search = document.getElementById('dm-voice-share-search');
    if (search) search.value = '';
    renderVoiceShareAccountList('Loading…');
    const loaded = await loadContacts();
    renderVoiceShareAccountList('');
    if (search) search.focus();
    if (loaded && !loaded.ok) {
      flash(loaded.error || 'Could not load staff accounts.', false);
    } else if (!contacts.length) {
      flash('No other active staff accounts to share with.', false);
    }
  }

  function setFeedback(text, ok) {
    const el = document.getElementById('leader-messages-feedback');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'class-messages-feedback' + (text ? (ok ? ' ok' : ' err') : '');
  }

  function flash(text, ok) {
    const el = document.getElementById('flash');
    if (!el) return;
    el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + escapeHtml(text) + '</div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 3500);
  }

  function staleServerMessage(status, text) {
    if (status !== 404 || !text || text.indexOf('<!DOCTYPE') === -1) return null;
    return 'Server is out of date. Stop npm run dev in the terminal, start it again, then hard-refresh this page (Ctrl+F5).';
  }

  async function parseResponse(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    const stale = staleServerMessage(res.status, text);
    if (stale && (!data || !data.error)) data = { error: stale };
    return { ok: res.ok, status: res.status, data: data, text: text };
  }

  function isPanelActive() {
    const p = messagesPanelEl();
    return !!(p && p.classList.contains('active'));
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
      if (sameDay) {
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
      return '';
    }
  }

  function formatInboxTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now - d;
      if (diff < 86400000) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' });
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_) {
      return '';
    }
  }

  function resetThreadSnapshot() {
    lastThreadSnapshot = '';
  }

  function threadSnapshot(messages) {
    return (messages || [])
      .map(function (m) {
        return [
          m.id,
          m.body || '',
          m.attachment_path || '',
          m.attachment_original_name || '',
          m.created_at || '',
          m.receipt_tick != null ? m.receipt_tick : '',
          m.is_mine ? 1 : 0,
        ].join('\x1e');
      })
      .join('\x1f');
  }

  function patchReceiptTicks(messages) {
    (messages || []).forEach(function (m) {
      if (!m.is_mine || m.receipt_tick == null) return;
      const row = document.querySelector(
        '#leader-messages-thread .dm-bubble-row[data-message-id="' + String(m.id) + '"]'
      );
      if (!row) return;
      const foot = row.querySelector('.dm-bubble-foot');
      if (!foot) return;
      const tick = Number(m.receipt_tick);
      let tickEl = foot.querySelector('.dm-msg-ticks');
      if (!tickEl) {
        appendReceiptTicks(foot, tick);
        return;
      }
      if (Number(tickEl.getAttribute('data-tick')) === tick) return;
      tickEl.setAttribute('data-tick', String(tick));
      tickEl.textContent = tick === 1 ? '✓' : '✓✓';
      tickEl.setAttribute('aria-label', tick === 3 ? 'Read' : tick === 2 ? 'Delivered' : 'Sent');
    });
  }

  function shouldSkipThreadRender(messages) {
    const snap = threadSnapshot(messages);
    const thread = document.getElementById('leader-messages-thread');
    if (!thread || !thread.querySelector('.dm-bubble-row')) return false;
    if (snap !== lastThreadSnapshot) return false;
    return true;
  }

  function voicePlaybackLocked() {
    return !!(window.OceanDmVoice && window.OceanDmVoice.isPlaybackLocked && window.OceanDmVoice.isPlaybackLocked());
  }

  function appendReceiptTicks(div, tick) {
    if (tick == null || tick < 1) return;
    const span = document.createElement('span');
    span.className = 'class-msg-ticks dm-msg-ticks';
    span.setAttribute('data-tick', String(tick));
    span.setAttribute(
      'aria-label',
      tick === 3 ? 'Read' : tick === 2 ? 'Delivered' : 'Sent'
    );
    span.textContent = tick === 1 ? '✓' : '✓✓';
    div.appendChild(span);
  }

  function ensureDmLightbox() {
    let lb = document.getElementById('dm-image-lightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.id = 'dm-image-lightbox';
    lb.className = 'dm-lightbox modal-overlay';
    lb.setAttribute('hidden', '');
    lb.setAttribute('aria-hidden', 'true');
    lb.innerHTML =
      '<div class="dm-lightbox-inner" role="dialog" aria-modal="true" aria-label="Photo preview">' +
      '<button type="button" class="dm-lightbox-close" aria-label="Close">×</button>' +
      '<img id="dm-lightbox-img" class="dm-lightbox-img" alt="" />' +
      '<p id="dm-lightbox-caption" class="dm-lightbox-caption"></p>' +
      '<a id="dm-lightbox-open" class="btn btn-sm dm-lightbox-open" href="#" target="_blank" rel="noopener">Open full size</a>' +
      '</div>';
    document.body.appendChild(lb);
    lb.addEventListener('click', function (e) {
      if (e.target === lb) closeDmLightbox();
    });
    const closeBtn = lb.querySelector('.dm-lightbox-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDmLightbox);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lb.classList.contains('open')) closeDmLightbox();
    });
    return lb;
  }

  function openDmLightbox(src, caption) {
    const lb = ensureDmLightbox();
    const img = document.getElementById('dm-lightbox-img');
    const cap = document.getElementById('dm-lightbox-caption');
    const open = document.getElementById('dm-lightbox-open');
    if (img) {
      img.src = src;
      img.alt = caption || 'Photo';
    }
    if (cap) cap.textContent = caption || '';
    if (open) open.href = src;
    lb.removeAttribute('hidden');
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
  }

  function closeDmLightbox() {
    const lb = document.getElementById('dm-image-lightbox');
    if (!lb) return;
    lb.classList.remove('open');
    lb.setAttribute('hidden', '');
    lb.setAttribute('aria-hidden', 'true');
    const img = document.getElementById('dm-lightbox-img');
    if (img) img.removeAttribute('src');
  }

  function fileKindLabel(name) {
    const n = String(name || '').toLowerCase();
    if (/\.(pdf)$/i.test(n)) return 'PDF document';
    if (/\.(docx?|odt)$/i.test(n)) return 'Word document';
    if (/\.(xlsx?|ods|csv)$/i.test(n)) return 'Spreadsheet';
    if (/\.(pptx?|odp)$/i.test(n)) return 'Presentation';
    if (/\.(zip|rar|7z)$/i.test(n)) return 'Archive';
    if (/\.(mp4|mov|webm|avi)$/i.test(n)) return 'Video';
    if (/\.(mp3|wav|m4a)$/i.test(n)) return 'Audio';
    return 'File';
  }

  function appendAttachment(div, m) {
    if (!m.attachment_path) return;
    const aWrap = document.createElement('div');
    aWrap.className = 'class-msg-attach';
    const path = m.attachment_path;
    const name = m.attachment_original_name || 'attachment';
    if (isAudioAttachment(path, name)) {
      if (window.OceanDmVoice && window.OceanDmVoice.appendVoicePlayer) {
        window.OceanDmVoice.appendVoicePlayer(aWrap, m, escapeHtml);
      }
      div.appendChild(aWrap);
      return;
    }
    if (isImagePath(path, name)) {
      const imgBtn = document.createElement('button');
      imgBtn.type = 'button';
      imgBtn.className = 'dm-attach-img-btn';
      imgBtn.setAttribute('aria-label', 'View photo');
      const img = document.createElement('img');
      img.className = 'dm-attach-img';
      img.src = path;
      img.alt = name;
      img.loading = 'lazy';
      imgBtn.appendChild(img);
      imgBtn.addEventListener('click', function () {
        openDmLightbox(path, name);
      });
      aWrap.appendChild(imgBtn);
    } else {
      const fileCard = document.createElement('a');
      fileCard.href = path;
      fileCard.target = '_blank';
      fileCard.rel = 'noopener';
      fileCard.className = 'dm-file-card';
      fileCard.download = name;
      fileCard.innerHTML =
        '<span class="dm-file-icon" aria-hidden="true">📎</span>' +
        '<span class="dm-file-info">' +
        '<strong class="dm-file-name">' +
        escapeHtml(name) +
        '</strong>' +
        '<span class="dm-file-kind">' +
        escapeHtml(fileKindLabel(name)) +
        ' · Tap to open</span>' +
        '</span>';
      aWrap.appendChild(fileCard);
    }
    const openLink = document.createElement('a');
    openLink.href = path;
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.className = 'dm-attach-link';
    openLink.textContent = isImagePath(path, name) ? 'Open / download' : 'Open file';
    if (!isImagePath(path, name)) openLink.setAttribute('download', name);
    aWrap.appendChild(openLink);
    div.appendChild(aWrap);
  }

  function appendOwnMessageFoot(div, m, isGroup) {
    const foot = document.createElement('div');
    foot.className = 'dm-bubble-foot';
    if (m.body && !isReadOnlyMessageView()) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'class-msg-delete dm-msg-edit';
      edit.textContent = 'Edit';
      edit.addEventListener('click', async function () {
        await editOwnMessage(m, isGroup);
      });
      foot.appendChild(edit);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'class-msg-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', async function () {
      if (!window.confirm('Delete this message?')) return;
      let resp;
      if (activeClassChannel) {
        const u =
          '/api/class-messages/' +
          encodeURIComponent(String(m.id)) +
          '?viewerLabel=' +
          encodeURIComponent(classMessageSenderLabel());
        resp = await fetch(u, { method: 'DELETE', headers: authHeaders() });
      } else {
        const scopeQ = isGroup ? '?scope=group' : '';
        resp = await fetch('/api/staff-messages/' + encodeURIComponent(String(m.id)) + scopeQ, {
          method: 'DELETE',
          headers: authHeaders(),
        });
      }
      const outDel = await parseResponse(resp);
      if (!outDel.ok) {
        setFeedback((outDel.data && outDel.data.error) || 'Could not delete.', false);
        return;
      }
      await refreshChat();
    });
    foot.appendChild(del);
    appendReceiptTicks(foot, m.receipt_tick != null ? Number(m.receipt_tick) : 1);
    div.appendChild(foot);
  }

  async function editOwnMessage(m, isGroup) {
    if (!m || !m.id) return;
    const current = String(m.body || '');
    const next = window.prompt('Edit message', current);
    if (next == null) return;
    const body = String(next).trim();
    if (!body) {
      setFeedback('Message text cannot be empty. Delete it instead.', false);
      return;
    }
    if (body === current.trim()) return;
    let resp;
    if (activeClassChannel) {
      const u =
        '/api/class-messages/' +
        encodeURIComponent(String(m.id)) +
        '?viewerLabel=' +
        encodeURIComponent(classMessageSenderLabel());
      resp = await fetch(u, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ body: body }),
      });
    } else {
      const scopeQ = isGroup ? '?scope=group' : '';
      resp = await fetch('/api/staff-messages/' + encodeURIComponent(String(m.id)) + scopeQ, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ body: body }),
      });
    }
    const out = await parseResponse(resp);
    if (!out.ok) {
      setFeedback((out.data && out.data.error) || 'Could not edit message.', false);
      return;
    }
    resetThreadSnapshot();
    await refreshChat();
  }

  function unreadBadgeLabel(n) {
    const x = Math.max(0, Number(n) || 0);
    if (x > 99) return '99+';
    return String(x);
  }

  function syncUnreadBadgesFromInbox(serverTotal) {
    let total = 0;
    inboxRows.forEach(function (row) {
      if (row.last_is_mine) row.unread_count = 0;
      total += Number(row.unread_count) || 0;
    });
    if (serverTotal != null) {
      total = Math.max(0, Number(serverTotal) || 0);
    }
    updateMessageTabBadges(total);
    renderInbox();
  }

  function updateMessageTabBadges(total) {
    totalUnreadCount = Math.max(0, Number(total) || 0);
    const show = totalUnreadCount > 0;
    const label = show ? unreadBadgeLabel(totalUnreadCount) : '';
    ['messages', 'skill-messages'].forEach(function (tabName) {
      document.querySelectorAll('[data-tab="' + tabName + '"]').forEach(function (tab) {
        let badge = tab.querySelector('.dm-tab-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'dm-tab-badge';
          if (getComputedStyle(tab).position === 'static') tab.style.position = 'relative';
          tab.appendChild(badge);
        }
        if (show) {
          badge.hidden = false;
          badge.removeAttribute('hidden');
          badge.textContent = totalUnreadCount > 1 ? label : '';
          badge.classList.toggle('dm-tab-badge--dot', totalUnreadCount === 1);
          badge.setAttribute(
            'aria-label',
            totalUnreadCount === 1 ? '1 unread message' : totalUnreadCount + ' unread messages'
          );
          tab.classList.add('has-dm-unread');
        } else {
          badge.hidden = true;
          badge.setAttribute('hidden', '');
          badge.textContent = '';
          badge.classList.remove('dm-tab-badge--dot');
          badge.removeAttribute('aria-label');
          tab.classList.remove('has-dm-unread');
        }
      });
    });
    try {
      document.dispatchEvent(
        new CustomEvent('ocean-dm-unread', { detail: { total: totalUnreadCount } })
      );
    } catch (_) {}
  }

  async function fetchUnreadSummary() {
    if (!sessionStorage.getItem(TOKEN_KEY)) return null;
    const res = await fetch('/api/staff-messages/unread-summary', { headers: authHeaders() });
    const out = await parseResponse(res);
    if (!out.ok || !out.data) return null;
    return out.data;
  }

  async function refreshUnreadBadges() {
    const sum = await fetchUnreadSummary();
    if (!sum) return;
    if (inboxRows.length) {
      inboxRows.forEach(function (row) {
        let n = 0;
        if (row.kind === 'group' && sum.by_group) {
          const key = String(row.group_id);
          n = sum.by_group[key] != null ? Number(sum.by_group[key]) : 0;
        } else if (row.kind !== 'group' && sum.by_peer) {
          const key = String(row.staff_id);
          n = sum.by_peer[key] != null ? Number(sum.by_peer[key]) : 0;
        }
        if (row.last_is_mine) n = 0;
        row.unread_count = n;
      });
    }
    syncUnreadBadgesFromInbox(sum.total);
  }

  function clearUnreadForPeer(peerId) {
    const pid = Number(peerId);
    if (!pid || Number.isNaN(pid)) return;
    inboxRows.forEach(function (row) {
      if (Number(row.staff_id) === pid) {
        row.unread_count = 0;
      }
    });
    syncUnreadBadgesFromInbox(null);
  }

  function markMessagesSeenNow(rows) {
    if (isReadOnlyMessageView()) return;
    if (activeClassChannel) {
      const v = classMessageSenderLabel();
      const ids = rows
        .filter(function (r) {
          return !r.is_mine;
        })
        .map(function (r) {
          return r.id;
        });
      if (!ids.length) return;
      fetch('/api/class-messages/seen', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ viewerLabel: v, messageIds: ids }),
      }).catch(function () {});
      return;
    }
    const me = myStaffId();
    if (!me) return;
    if (!isPanelActive() || document.visibilityState !== 'visible') return;
    if (activeGroupId) {
      clearUnreadForGroup(activeGroupId);
      return;
    }
    if (activePeerId) clearUnreadForPeer(activePeerId);
    const ids = rows
      .filter(function (r) {
        return !r.is_mine;
      })
      .map(function (r) {
        return r.id;
      });
    clearTimeout(markSeenTimer);
    if (!ids.length) return;
    markSeenTimer = setTimeout(function () {
      fetch('/api/staff-messages/seen', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ messageIds: ids }),
      })
        .then(function () {
          return refreshUnreadBadges();
        })
        .catch(function () {});
    }, 80);
  }

  function refreshOpenChatReceipts() {
    if (!isPanelActive() || !hasOpenChat()) return;
    if (voicePlaybackLocked()) return;
    loadActiveThread();
  }

  function notifyNewMessages(rows) {
    if (!pollPrimed || !window.OceanMessageNotify) return;
    const incoming = rows.filter(function (r) {
      return !lastSeenMessageIds.has(r.id) && !r.is_mine;
    });
    if (!incoming.length) return;
    const inOpenChat = activeGroupId
      ? true
      : activePeerId &&
        incoming.every(function (r) {
          return Number(r.sender_staff_id) === Number(activePeerId);
        });
    const first = incoming[0];
    const who = first.sender_name || 'Staff';
    const preview =
      (String(first.body || '').trim().slice(0, 120) ||
        (first.attachment_path
          ? isAudioAttachment(first.attachment_path, first.attachment_original_name)
            ? 'Sent a voice message'
            : 'Sent an attachment'
          : 'New message')) +
      (incoming.length > 1 ? ' (+' + (incoming.length - 1) + ' more)' : '');
    if (!inOpenChat) {
      window.OceanMessageNotify.notifyIncoming(who + ' · ' + (first.sender_role_label || ''), preview);
      refreshUnreadBadges();
    }
  }

  function setChatHeader(peer, group) {
    const nameEl = document.getElementById('dm-chat-peer-name');
    const roleEl = document.getElementById('dm-chat-peer-role');
    const avatarEl = document.getElementById('dm-chat-peer-avatar');
    activeHeaderProfile = null;
    if (group) {
      activeHeaderProfile = {
        display_name: group.name || 'Group',
        workspace_label: (group.member_count || 0) + ' members · Group chat',
      };
      if (nameEl) nameEl.textContent = group.name || 'Group';
      if (roleEl) {
        roleEl.textContent = (group.member_count || 0) + ' members · Group chat';
      }
      if (avatarEl) {
        avatarEl.innerHTML = staffAvatarHtml(null, group.name, 'dm-chat-header-avatar');
      }
    } else if (peer) {
      activeHeaderProfile = {
        display_name: peer.display_name || 'Staff',
        workspace_label: contactWorkspaceLine(peer),
        role_label: peer.role_label || roleLabel(peer.role),
        email: peer.email || '',
        avatar_url: peer.avatar_url || '',
      };
      if (nameEl) nameEl.textContent = peer.display_name || 'Staff';
      if (roleEl) {
        const email = peer.email ? String(peer.email).trim() : '';
        const line = contactWorkspaceLine(peer);
        if (isGhostObserverMode() && (peer.observer || isObservingStaffChat())) {
          roleEl.textContent = line || 'Staff conversation (read-only)';
        } else {
          roleEl.textContent = email ? line + ' · ' + email : line;
        }
      }
      if (avatarEl) {
        avatarEl.innerHTML = staffAvatarHtml(peer.avatar_url, peer.display_name, 'dm-chat-header-avatar');
      }
    } else {
      if (nameEl) nameEl.textContent = 'Select a chat';
      if (roleEl) roleEl.textContent = '';
      if (avatarEl) avatarEl.innerHTML = '';
    }
    if (avatarEl) {
      avatarEl.classList.toggle('is-clickable', !!activeHeaderProfile);
      avatarEl.setAttribute('aria-hidden', activeHeaderProfile ? 'false' : 'true');
      if (activeHeaderProfile) {
        avatarEl.setAttribute('role', 'button');
        avatarEl.setAttribute('tabindex', '0');
        avatarEl.setAttribute('aria-label', 'View profile photo');
      } else {
        avatarEl.removeAttribute('role');
        avatarEl.removeAttribute('tabindex');
        avatarEl.removeAttribute('aria-label');
      }
    }
    updateClearChatButton();
    syncObserverComposeUi();
    syncDmLayout();
  }

  function isLeadershipBrowsingClassWorkspace() {
    const st = currentStaff();
    if (!st || isDirectorDashboard() || isHeadDashboard()) return false;
    return st.role === 'director' || st.role === 'head_teacher';
  }

  function ensureDmEmptyPane() {
    const chat = document.getElementById('dm-chat');
    if (!chat || document.getElementById('dm-chat-empty')) return;
    const el = document.createElement('div');
    el.id = 'dm-chat-empty';
    el.className = 'dm-chat-empty';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="dm-chat-empty-inner">' +
      '<p class="dm-chat-empty-title">Select a chat</p>' +
      '<p class="dm-chat-empty-hint">Choose a conversation from the list or start a new chat.</p>' +
      '</div>';
    const threadCard = chat.querySelector('.dm-thread-card');
    if (threadCard) chat.insertBefore(el, threadCard);
  }

  function syncDmLayout() {
    const app = document.getElementById('dm-app');
    if (!app) return;
    ensureDmEmptyPane();
    const hasChat = hasOpenChat();
    app.classList.toggle('dm-has-active-chat', hasChat);
    const empty = document.getElementById('dm-chat-empty');
    if (empty) {
      empty.hidden = hasChat;
      empty.setAttribute('aria-hidden', hasChat ? 'true' : 'false');
    }
    if (!hasChat) app.classList.remove('dm-chat-open');
  }

  function openMobileChat(open) {
    const app = document.getElementById('dm-app');
    if (!app) return;
    if (open && !hasOpenChat()) return;
    app.classList.toggle('dm-chat-open', !!open);
    syncDmLayout();
  }

  function renderInbox() {
    const list = document.getElementById('dm-inbox-list');
    if (!list) return;
    if (!inboxRows.length) {
      list.innerHTML = observerMode
        ? '<p class="dm-inbox-empty">No class or staff conversations yet.</p>'
        : '<p class="dm-inbox-empty">No conversations yet. Class &amp; skill messages appear here when sent; tap <strong>New chat</strong> for a private staff message.</p>';
      return;
    }
    list.innerHTML = '';
    inboxRows.forEach(function (row) {
      const isGroup = row.kind === 'group';
      const isClassChannel = row.kind === 'class_channel';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'dm-inbox-item' +
        (isGroup ? ' dm-inbox-item-group' : '') +
        (isClassChannel ? ' dm-inbox-item-class' : '');
      if (isClassChannel && activeClassChannel) {
        const ac = activeClassChannel;
        if (
          ac.class_level === row.class_level &&
          (ac.stream || '') === (row.stream || '') &&
          (ac.skill_subject || '') === (row.skill_subject || '')
        ) {
          btn.classList.add('is-active');
        }
      }
      if (isGroup && Number(activeGroupId) === Number(row.group_id)) btn.classList.add('is-active');
      if (
        !isGroup &&
        !isClassChannel &&
        Number(activePeerId) === Number(row.staff_id) &&
        (row.peer_staff_id == null
          ? !activeObservePeerId
          : Number(activeObservePeerId) === Number(row.peer_staff_id))
      ) {
        btn.classList.add('is-active');
      }
      const preview = row.last_preview || '';
      const unread = row.last_is_mine ? 0 : Number(row.unread_count) || 0;
      const unreadHtml =
        unread > 0
          ? '<span class="dm-unread-badge" aria-label="' +
            unread +
            ' unread">' +
            escapeHtml(unreadBadgeLabel(unread)) +
            '</span>'
          : '';
      const avatar = isGroup
        ? staffAvatarHtml(null, row.name, 'dm-inbox-avatar')
        : staffAvatarHtml(row.avatar_url, row.display_name, 'dm-inbox-avatar');
      btn.innerHTML =
        '<span class="dm-inbox-item-row">' +
        avatar +
        '<span class="dm-inbox-item-body">' +
        '<span class="dm-inbox-item-top">' +
        '<strong class="dm-inbox-name">' +
        (isGroup ? '👥 ' : isClassChannel ? '📋 ' : '') +
        escapeHtml(row.display_name || row.name) +
        '</strong>' +
        '<span class="dm-inbox-top-end">' +
        unreadHtml +
        '<span class="dm-inbox-time">' +
        escapeHtml(formatInboxTime(row.last_at)) +
        '</span></span></span>' +
        '<span class="dm-inbox-role">' +
        escapeHtml(row.workspace_label || contactWorkspaceLine(row)) +
        '</span>' +
        '<span class="dm-inbox-preview">' +
        escapeHtml(preview) +
        '</span></span></span>';
      btn.addEventListener('click', function () {
        if (isClassChannel) {
          selectClassChannel(row);
          return;
        }
        if (isGroup && row.group_id) {
          selectGroup(Number(row.group_id));
          return;
        }
        if (row.peer_staff_id && row.staff_id) {
          selectObservedPair(Number(row.staff_id), Number(row.peer_staff_id));
          return;
        }
        if (row.staff_id) selectPeer(Number(row.staff_id));
      });
      list.appendChild(btn);
    });
  }

  async function markConversationRead(peerId, groupId) {
    if (!sessionStorage.getItem(TOKEN_KEY) || isGhostObserverMode() || activeClassChannel) return;
    const gid = Number(groupId);
    const pid = Number(peerId);
    try {
      if (!Number.isNaN(gid) && gid > 0) {
        await fetch('/api/staff-messages/read-with', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ group_id: gid }),
        });
        return;
      }
      if (!Number.isNaN(pid) && pid > 0) {
        await fetch('/api/staff-messages/read-with', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ with: pid }),
        });
      }
    } catch (_) {}
  }

  function clearUnreadForGroup(groupId) {
    const gid = Number(groupId);
    if (!gid || Number.isNaN(gid)) return;
    inboxRows.forEach(function (row) {
      if (row.kind === 'group' && Number(row.group_id) === gid) {
        row.unread_count = 0;
      }
    });
    syncUnreadBadgesFromInbox(null);
  }

  async function loadClassMessageChannels() {
    const u = new URL('/api/class-messages/channels', window.location.origin);
    const ctx = dashboardClassContext();
    if (!isGhostObserverMode() && ctx) {
      u.searchParams.set('classLevel', ctx.classLevel);
      if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    }
    try {
      const res = await fetch(u, { headers: authHeaders() });
      const out = await parseResponse(res);
      if (!out.ok || !out.data || !Array.isArray(out.data.channels)) return [];
      return out.data.channels;
    } catch (_) {
      return [];
    }
  }

  async function loadInbox() {
    const res = await fetch('/api/staff-messages/inbox', { headers: authHeaders() });
    const out = await parseResponse(res);
    if (!out.ok) {
      inboxRows = [];
      observerMode = false;
      renderInbox();
      syncUnreadBadgesFromInbox(0);
      if (out.status === 401) {
        setFeedback('Sign in again (Admin) to use private messages.', false);
      } else {
        setFeedback((out.data && out.data.error) || 'Could not load conversations.', false);
      }
      return;
    }
    let staffRows = [];
    if (out.data && Array.isArray(out.data.conversations)) {
      staffRows = out.data.conversations;
      observerMode = !!out.data.observer_mode;
    } else if (Array.isArray(out.data)) {
      staffRows = out.data;
      observerMode = false;
    }
    if (!isGhostObserverMode()) {
      staffRows = staffRows.filter(function (r) {
        return !r.peer_staff_id;
      });
    }
    const classChannels = await loadClassMessageChannels();
    inboxRows = classChannels.concat(staffRows).sort(function (a, b) {
      const ta = new Date(a.last_at || 0).getTime();
      const tb = new Date(b.last_at || 0).getTime();
      return tb - ta;
    });
    if (isGhostObserverMode() && out.data) {
      observerMode = !!out.data.observer_mode || classChannels.length > 0;
    }
    renderInbox();
    if (isPanelActive()) {
      if (activeClassChannel) await loadActiveThread();
      else if (activeGroupId) await loadActiveThread();
      else if (activePeerId) await loadActiveThread();
    }
    await refreshUnreadBadges();
  }

  async function loadContacts() {
    const me = myStaffId();
    if (isDirectorDashboard() || isHeadDashboard() || isGhostObserverMode()) {
      const res = await fetch('/api/director/staff', { headers: authHeaders() });
      const out = await parseResponse(res);
      if (!out.ok) {
        contacts = [];
        return { ok: false, error: (out.data && out.data.error) || 'Could not load staff accounts.' };
      }
      const rows = Array.isArray(out.data) ? out.data : [];
      contacts = rows
        .filter(function (r) {
          return r.active && Number(r.id) !== Number(me);
        })
        .map(mapStaffRowToContact);
      return { ok: true };
    }
    const res = await fetch('/api/staff-messages/contacts', { headers: authHeaders() });
    const out = await parseResponse(res);
    if (!out.ok) {
      contacts = [];
      return { ok: false, error: (out.data && out.data.error) || 'Could not load staff accounts.' };
    }
    contacts = Array.isArray(out.data) ? out.data : [];
    return { ok: true };
  }

  function renderThread(messages, peer, group) {
    const thread = document.getElementById('leader-messages-thread');
    if (!thread) return;
    const isGroup = !!group;
    setChatHeader(peer, group);
    if (!hasOpenChat()) {
      thread.innerHTML =
        '<p class="class-messages-empty">Choose a chat from the list, start a private message, or create a group.</p>';
      return;
    }
    if (!messages.length) {
      lastThreadSnapshot = '';
      thread.innerHTML = '<p class="class-messages-empty">No messages yet. Say hello.</p>';
      markMessagesSeenNow(messages);
      return;
    }
    notifyNewMessages(messages);
    lastSeenMessageIds = new Set(
      messages.map(function (r) {
        return r.id;
      })
    );
    pollPrimed = true;

    const snap = threadSnapshot(messages);
    if (shouldSkipThreadRender(messages)) {
      patchReceiptTicks(messages);
      markMessagesSeenNow(messages);
      return;
    }
    if (voicePlaybackLocked()) {
      if (window.OceanDmVoice && window.OceanDmVoice.pauseAllPlayback) {
        window.OceanDmVoice.pauseAllPlayback();
      }
    }
    lastThreadSnapshot = snap;

    const threadEl = thread;
    const wasNearBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 80;
    thread.innerHTML = '';
    messages.forEach(function (m) {
      const row = document.createElement('div');
      row.className = 'dm-bubble-row' + (m.is_mine ? ' is-own' : '');
      if (m.id != null) row.dataset.messageId = String(m.id);
      const avatarUrl = m.is_mine ? (currentStaff() && currentStaff().avatar_url) || null : m.sender_avatar_url;
      const avatarName = m.is_mine ? myDisplayName() : m.sender_name;
      const avatarProfile = {
        display_name: avatarName || (m.is_mine ? 'You' : 'Staff'),
        role_label: m.is_mine ? myRoleLabel() : m.sender_role_label || roleLabel(m.sender_role),
        avatar_url: avatarUrl || '',
      };
      if (!m.is_mine) {
        const av = document.createElement('div');
        av.className = 'dm-bubble-avatar-wrap is-clickable';
        av.setAttribute('role', 'button');
        av.setAttribute('tabindex', '0');
        av.setAttribute('aria-label', 'View profile photo');
        av.innerHTML = staffAvatarHtml(avatarUrl, avatarName, 'dm-bubble-avatar');
        av.addEventListener('click', function () {
          openDmProfile(avatarProfile);
        });
        av.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDmProfile(avatarProfile);
          }
        });
        row.appendChild(av);
      }
      const div = document.createElement('div');
      div.className = 'class-msg-bubble dm-bubble';
      if (m.is_mine) div.classList.add('is-own');
      const meta = document.createElement('div');
      meta.className = 'class-msg-meta';
      const who = m.is_mine ? 'You' : m.sender_name || 'Staff';
      const role = m.is_mine ? myRoleLabel() : m.sender_role_label || roleLabel(m.sender_role);
      meta.innerHTML =
        '<strong>' +
        escapeHtml(who) +
        '</strong>' +
        ' <span class="dm-msg-role">' +
        escapeHtml(role) +
        '</span>' +
        ' · ' +
        escapeHtml(formatTime(m.created_at));
      div.appendChild(meta);
      if (m.body) {
        const b = document.createElement('div');
        b.className = 'class-msg-body';
        b.textContent = m.body;
        div.appendChild(b);
      }
      appendAttachment(div, m);
      if (m.is_mine) appendOwnMessageFoot(div, m, isGroup);
      row.appendChild(div);
      if (m.is_mine) {
        const avMine = document.createElement('div');
        avMine.className = 'dm-bubble-avatar-wrap dm-bubble-avatar-own is-clickable';
        avMine.setAttribute('role', 'button');
        avMine.setAttribute('tabindex', '0');
        avMine.setAttribute('aria-label', 'View your profile photo');
        avMine.innerHTML = staffAvatarHtml(avatarUrl, avatarName, 'dm-bubble-avatar');
        avMine.addEventListener('click', function () {
          openDmProfile(avatarProfile);
        });
        avMine.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDmProfile(avatarProfile);
          }
        });
        row.appendChild(avMine);
      }
      thread.appendChild(row);
    });
    requestAnimationFrame(function () {
      if (wasNearBottom) thread.scrollTop = thread.scrollHeight;
    });
    markMessagesSeenNow(messages);
    syncDmLayout();
  }

  async function loadDmThread(peerId) {
    const thread = document.getElementById('leader-messages-thread');
    if (!thread || !peerId) return;
    let url = '/api/staff-messages/thread?with=' + encodeURIComponent(String(peerId));
    if (activeObservePeerId) {
      url += '&with_peer=' + encodeURIComponent(String(activeObservePeerId));
    }
    const res = await fetch(url, {
      headers: authHeaders(),
    });
    const out = await parseResponse(res);
    if (!out.ok) {
      const msg = (out.data && out.data.error) || 'Could not load messages.';
      thread.innerHTML = '<p class="class-messages-empty">' + escapeHtml(msg) + '</p>';
      return;
    }
    const peer = out.data && out.data.peer;
    const messages = (out.data && out.data.messages) || [];
    renderThread(messages, peer, null);
  }

  async function loadGroupThread(groupId) {
    const thread = document.getElementById('leader-messages-thread');
    if (!thread || !groupId) return;
    const res = await fetch('/api/staff-messages/thread?group=' + encodeURIComponent(String(groupId)), {
      headers: authHeaders(),
    });
    const out = await parseResponse(res);
    if (!out.ok) {
      const msg = (out.data && out.data.error) || 'Could not load group messages.';
      thread.innerHTML = '<p class="class-messages-empty">' + escapeHtml(msg) + '</p>';
      return;
    }
    const group = out.data && out.data.group;
    const messages = (out.data && out.data.messages) || [];
    renderThread(messages, null, group);
  }

  async function loadClassChannelThread(channel) {
    const thread = document.getElementById('leader-messages-thread');
    if (!thread || !channel) return;
    const u = new URL('/api/class-messages', window.location.origin);
    u.searchParams.set('classLevel', channel.class_level);
    if (channel.stream) u.searchParams.set('stream', channel.stream);
    if (channel.skill_subject) u.searchParams.set('skillSubject', channel.skill_subject);
    u.searchParams.set('viewerLabel', classMessageSenderLabel());
    const res = await fetch(u);
    const out = await parseResponse(res);
    if (!out.ok) {
      const msg = (out.data && out.data.error) || 'Could not load class messages.';
      thread.innerHTML = '<p class="class-messages-empty">' + escapeHtml(msg) + '</p>';
      return;
    }
    const rows = Array.isArray(out.data) ? out.data : [];
    const meLabel = classMessageSenderLabel().toLowerCase();
    const pseudoPeer = {
      display_name: channel.display_name || 'Class messages',
      workspace_label: channel.workspace_label || 'Class & skill channel',
      observer: isGhostObserverMode(),
    };
    const mapped = rows.map(function (m) {
      const from = String(m.sender_label || '').trim().toLowerCase();
      return {
        id: m.id,
        sender_name: m.sender_label || 'Staff',
        sender_role_label: m.skill_subject ? 'Skill channel' : 'Class staff',
        body: m.body,
        attachment_path: m.attachment_path,
        attachment_original_name: m.attachment_original_name,
        created_at: m.created_at,
        is_mine: !isGhostObserverMode() && from === meLabel,
        receipt_tick: m.receipt_tick != null ? Number(m.receipt_tick) : null,
      };
    });
    renderThread(mapped, pseudoPeer, null);
  }

  function closeCurrentChat() {
    activePeerId = null;
    activeObservePeerId = null;
    activeGroupId = null;
    activeClassChannel = null;
    lastSeenMessageIds = new Set();
    pollPrimed = false;
    resetThreadSnapshot();
    renderThread([], null, null);
    syncObserverComposeUi();
    openMobileChat(false);
  }

  async function selectClassChannel(row) {
    if (!row || row.kind !== 'class_channel' || !row.class_level) return;
    activeClassChannel = {
      class_level: String(row.class_level).trim(),
      stream: row.stream != null ? String(row.stream).trim() : '',
      skill_subject: row.skill_subject != null ? String(row.skill_subject).trim() : '',
      display_name: row.display_name,
      workspace_label: row.workspace_label,
    };
    activePeerId = null;
    activeObservePeerId = null;
    activeGroupId = null;
    lastSeenMessageIds = new Set();
    pollPrimed = false;
    resetThreadSnapshot();
    setFeedback('', true);
    openMobileChat(true);
    pausePolling();
    await loadClassChannelThread(activeClassChannel);
    syncObserverComposeUi();
    startPolling();
  }

  async function loadActiveThread() {
    if (activeClassChannel) return loadClassChannelThread(activeClassChannel);
    if (activeGroupId) return loadGroupThread(activeGroupId);
    if (activePeerId) return loadDmThread(activePeerId);
  }

  async function selectObservedPair(staffA, staffB) {
    activePeerId = staffA;
    activeObservePeerId = staffB;
    activeGroupId = null;
    activeClassChannel = null;
    lastSeenMessageIds = new Set();
    pollPrimed = false;
    resetThreadSnapshot();
    setFeedback('', true);
    openMobileChat(true);
    pausePolling();
    await loadDmThread(staffA);
    syncObserverComposeUi();
    startPolling();
  }

  async function selectPeer(peerId) {
    const pid = Number(peerId);
    if (!pid || Number.isNaN(pid)) return;
    activePeerId = pid;
    activeObservePeerId = null;
    activeGroupId = null;
    activeClassChannel = null;
    lastSeenMessageIds = new Set();
    pollPrimed = false;
    resetThreadSnapshot();
    setFeedback('', true);
    clearUnreadForPeer(peerId);
    openMobileChat(true);
    pausePolling();
    await markConversationRead(pid, null);
    await loadDmThread(pid);
    syncObserverComposeUi();
    await loadInbox();
    startPolling();
  }

  async function selectGroup(groupId) {
    activeGroupId = groupId;
    activePeerId = null;
    activeObservePeerId = null;
    activeClassChannel = null;
    lastSeenMessageIds = new Set();
    pollPrimed = false;
    resetThreadSnapshot();
    setFeedback('', true);
    clearUnreadForGroup(groupId);
    openMobileChat(true);
    pausePolling();
    await markConversationRead(null, groupId);
    await loadGroupThread(groupId);
    syncObserverComposeUi();
    await loadInbox();
    startPolling();
  }

  async function refreshChat() {
    if (hasOpenChat()) await loadActiveThread();
    await loadInbox();
  }

  async function clearCurrentChat() {
    if (!hasOpenChat()) return;
    if (isReadOnlyMessageView()) {
      setFeedback('This chat is read-only for system admin.', false);
      return;
    }
    if (!window.confirm('Clear all messages in this chat? This cannot be undone.')) return;
    let url = '/api/staff-messages/clear';
    let body;
    if (activeClassChannel && activeClassChannel.class_level) {
      url = '/api/class-messages/clear';
      body = {
        classLevel: activeClassChannel.class_level,
        stream: activeClassChannel.stream || '',
        skillSubject: activeClassChannel.skill_subject || '',
      };
    } else if (activeGroupId) {
      body = { group_id: Number(activeGroupId) };
    } else if (activePeerId) {
      body = { with: Number(activePeerId) };
    } else {
      setFeedback('Select a chat first.', false);
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    const out = await parseResponse(res);
    if (!out.ok) {
      const msg = (out.data && out.data.error) || 'Could not clear chat.';
      setFeedback(msg, false);
      flash(msg, false);
      return;
    }
    setFeedback('Chat cleared.', true);
    closeCurrentChat();
    await loadInbox();
  }

  async function createGroupFromModal() {
    const nameEl = document.getElementById('dm-group-name');
    const name = nameEl ? String(nameEl.value || '').trim() : '';
    if (!name) {
      setFeedback('Enter a group name.', false);
      return;
    }
    const memberIds = Array.from(selectedGroupMemberIds);
    if (!memberIds.length) {
      setFeedback('Select at least one other staff member.', false);
      return;
    }
    const createBtn = document.getElementById('dm-create-group-btn');
    if (createBtn) createBtn.disabled = true;
    const res = await fetch('/api/staff-messages/groups', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ name: name, member_ids: memberIds }),
    });
    const out = await parseResponse(res);
    if (createBtn) createBtn.disabled = false;
    if (!out.ok) {
      const msg = (out.data && out.data.error) || 'Could not create group.';
      setFeedback(msg, false);
      flash(msg, false);
      return;
    }
    if (nameEl) nameEl.value = '';
    selectedGroupMemberIds = new Set();
    closeDmNewModal();
    setFeedback('', true);
    const gid = out.data && out.data.id;
    if (gid) await selectGroup(Number(gid));
    else await loadInbox();
  }

  function toggleGroupMember(staffId) {
    const sid = Number(staffId);
    if (!sid || Number.isNaN(sid)) return;
    if (selectedGroupMemberIds.has(sid)) selectedGroupMemberIds.delete(sid);
    else selectedGroupMemberIds.add(sid);
    const search = document.getElementById('dm-account-search');
    renderAccountList(search ? search.value : '');
  }

  function renderAccountList(filterText) {
    const list = document.getElementById('dm-account-list');
    if (!list) return;
    const q = String(filterText || '')
      .trim()
      .toLowerCase();
    const rows = contacts.filter(function (c) {
      if (!q) return true;
      const hay =
        (c.display_name || '') +
        ' ' +
        (c.email || '') +
        ' ' +
        (c.role || '') +
        ' ' +
        (c.scope_label || '') +
        ' ' +
        (c.workspace_label || '') +
        ' ' +
        (c.role_label || '');
      return hay.toLowerCase().indexOf(q) !== -1;
    });
    if (filterText === 'Loading…') {
      list.innerHTML = '<p class="dm-inbox-empty">Loading staff accounts…</p>';
      return;
    }
    if (!rows.length) {
      list.innerHTML =
        '<p class="dm-inbox-empty">No matching staff accounts. Active accounts from Staff &amp; accounts appear here (disabled accounts are not listed).</p>';
      return;
    }
    list.innerHTML = '';
    const isGroupMode = newChatMode === 'group';
    rows.forEach(function (c) {
      const roleTxt = String(c.role || '').trim() || roleLabel(c.role);
      const scopeTxt = staffScopeLabel(c);
      const avatarBlock = staffAvatarHtml(c.avatar_url, c.display_name, 'dm-account-avatar');
      const bodyHtml =
        '<span class="dm-account-body">' +
        '<strong class="dm-account-name">' +
        escapeHtml(c.display_name) +
        '</strong>' +
        '<span class="dm-account-meta">' +
        '<span class="dm-account-role">' +
        escapeHtml(roleTxt) +
        '</span>' +
        '<span class="dm-account-scope">' +
        escapeHtml(scopeTxt) +
        '</span>' +
        '</span>' +
        '<span class="dm-account-email">' +
        escapeHtml(c.email || '') +
        '</span>' +
        '</span>';
      if (isGroupMode) {
        const label = document.createElement('label');
        label.className = 'dm-account-item dm-account-item-select';
        const checked = selectedGroupMemberIds.has(Number(c.id));
        label.innerHTML =
          '<input type="checkbox" class="dm-account-check" ' +
          (checked ? 'checked ' : '') +
          'data-staff-id="' +
          escapeHtml(String(c.id)) +
          '" />' +
          avatarBlock +
          bodyHtml;
        const cb = label.querySelector('.dm-account-check');
        if (cb) {
          cb.addEventListener('change', function () {
            toggleGroupMember(c.id);
          });
        }
        list.appendChild(label);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dm-account-item';
        btn.innerHTML = avatarBlock + bodyHtml;
        btn.addEventListener('click', async function () {
          closeDmNewModal();
          await selectPeer(Number(c.id));
        });
        list.appendChild(btn);
      }
    });
  }

  function bindNewChatModal() {
    const modal = dmNewModalEl();
    const openBtn = document.getElementById('dm-new-chat-btn');
    const cancelBtn = document.getElementById('dm-new-chat-cancel');
    const search = document.getElementById('dm-account-search');
    const dmTab = document.getElementById('dm-new-mode-dm');
    const groupTab = document.getElementById('dm-new-mode-group');
    const createBtn = document.getElementById('dm-create-group-btn');
    if (dmTab && !dmTab.dataset.bound) {
      dmTab.dataset.bound = '1';
      dmTab.addEventListener('click', function () {
        setNewChatMode('dm');
      });
    }
    if (groupTab && !groupTab.dataset.bound) {
      groupTab.dataset.bound = '1';
      groupTab.addEventListener('click', function () {
        setNewChatMode('group');
      });
    }
    if (createBtn && !createBtn.dataset.bound) {
      createBtn.dataset.bound = '1';
      createBtn.addEventListener('click', function () {
        createGroupFromModal();
      });
    }
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = '1';
      openBtn.addEventListener('click', async function () {
        setNewChatMode('dm');
        selectedGroupMemberIds = new Set();
        openDmNewModal();
        if (search) search.value = '';
        const nameEl = document.getElementById('dm-group-name');
        if (nameEl) nameEl.value = '';
        renderAccountList('Loading…');
        const authed = sessionStorage.getItem(TOKEN_KEY);
        if (!authed) {
          renderAccountList('');
          setFeedback('Sign in with your staff email, then try New chat again.', false);
          return;
        }
        const loaded = await loadContacts();
        renderAccountList('');
        if (search) search.focus();
        if (loaded && !loaded.ok) {
          setFeedback(loaded.error || 'Could not load staff accounts.', false);
        } else if (!contacts.length) {
          setFeedback('No other active staff accounts. Add them under Staff & accounts.', false);
        } else {
          setFeedback('', true);
        }
      });
    }
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', function () {
        renderAccountList(search.value);
      });
    }
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = '1';
      cancelBtn.addEventListener('click', function () {
        closeDmNewModal();
      });
    }
    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = '1';
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeDmNewModal();
      });
    }
  }

  async function submitLeaderMessage(opts) {
    if (!hasOpenChat()) {
      setFeedback('Select or start a chat first.', false);
      return false;
    }
    const bodyEl = document.getElementById('leader-messages-body');
    const fileEl = document.getElementById('leader-messages-attachment');
    const body =
      opts && opts.body != null ? String(opts.body).trim() : bodyEl ? String(bodyEl.value || '').trim() : '';
    const file =
      opts && opts.file
        ? opts.file
        : fileEl && fileEl.files && fileEl.files[0]
        ? fileEl.files[0]
        : null;
    if (!body && !file) {
      setFeedback('Type a message, attach a file, or record a voice note.', false);
      return false;
    }
    const sendBtn = document.getElementById('leader-messages-send');
    if (sendBtn) sendBtn.disabled = true;
    let res;
    const ch = activeClassChannel;
    if (ch && ch.class_level) {
      const fd = new FormData();
      fd.append('class_level', ch.class_level);
      fd.append('stream', ch.stream || '');
      fd.append('skill_subject', ch.skill_subject || '');
      fd.append('sender_label', classMessageSenderLabel());
      fd.append('body', body);
      fd.append('origin_class_level', '');
      fd.append('origin_stream', '');
      if (file) fd.append('attachment', file);
      res = await fetch('/api/class-messages', { method: 'POST', body: fd });
    } else if (activeGroupId) {
      const fd = new FormData();
      fd.append('group_id', String(activeGroupId));
      fd.append('body', body);
      if (file) fd.append('attachment', file);
      res = await fetch('/api/staff-messages', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
    } else if (activePeerId) {
      const fd = new FormData();
      fd.append('recipient_staff_id', String(activePeerId));
      fd.append('body', body);
      if (file) fd.append('attachment', file);
      res = await fetch('/api/staff-messages', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
    } else {
      if (sendBtn) sendBtn.disabled = false;
      setFeedback('Select or start a chat first.', false);
      return false;
    }
    const out = await parseResponse(res);
    if (!out.ok) {
      const msg = (out.data && out.data.error) || 'Could not send message.';
      setFeedback(msg, false);
      flash(msg, false);
      if (sendBtn) sendBtn.disabled = false;
      return false;
    }
    if (bodyEl) bodyEl.value = '';
    if (fileEl) fileEl.value = '';
    updateAttachPreview();
    setFeedback('', true);
    if (sendBtn) sendBtn.disabled = false;
    if (ch && ch.class_level) {
      await loadClassChannelThread(ch);
      await loadInbox();
    } else {
      await refreshChat();
    }
    if (ch && ch.class_level) {
      const row = inboxRows.find(function (r) {
        return (
          r.kind === 'class_channel' &&
          r.class_level === ch.class_level &&
          (r.stream || '') === (ch.stream || '') &&
          (r.skill_subject || '') === (ch.skill_subject || '')
        );
      });
      if (row) row.last_is_mine = true;
    } else if (activeGroupId) {
      const grow = inboxRows.find(function (r) {
        return r.kind === 'group' && Number(r.group_id) === Number(activeGroupId);
      });
      if (grow) grow.last_is_mine = true;
    } else if (activePeerId) {
      const row = inboxRows.find(function (r) {
        return r.kind !== 'group' && r.kind !== 'class_channel' && Number(r.staff_id) === Number(activePeerId);
      });
      if (row) row.last_is_mine = true;
    }
    syncUnreadBadgesFromInbox(0);
    return true;
  }

  function bindForm() {
    const form = document.getElementById('form-leader-message');
    const fileEl = document.getElementById('leader-messages-attachment');
    if (fileEl && !fileEl.dataset.bound) {
      fileEl.dataset.bound = '1';
      fileEl.addEventListener('change', updateAttachPreview);
    }
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      await submitLeaderMessage();
    });
  }

  function bindVoiceNotes() {
    if (!window.OceanDmVoice || !window.OceanDmVoice.bindVoice) return;
    window.OceanDmVoice.bindVoice({
      isReadOnly: isReadOnlyMessageView,
      onSendVoice: async function (file) {
        if (!hasOpenChat() || isReadOnlyMessageView()) return;
        await submitLeaderMessage({ file: file, body: '' });
      },
      onShareVoice: function (path, name) {
        openVoiceSharePicker(path, name);
      },
    });
  }

  function bindClearChat() {
    const btn = document.getElementById('dm-clear-chat-btn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      clearCurrentChat();
    });
  }

  function bindProfileHeader() {
    const avatar = document.getElementById('dm-chat-peer-avatar');
    const peer = document.querySelector('.dm-chat-peer');
    function openActiveProfile() {
      if (activeHeaderProfile) openDmProfile(activeHeaderProfile);
    }
    [avatar, peer].forEach(function (el) {
      if (!el || el.dataset.profileBound) return;
      el.dataset.profileBound = '1';
      el.addEventListener('click', openActiveProfile);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openActiveProfile();
        }
      });
    });
    if (peer && !peer.hasAttribute('tabindex')) {
      peer.setAttribute('tabindex', '0');
      peer.setAttribute('role', 'button');
      peer.setAttribute('aria-label', 'View profile photo');
    }
  }

  function pausePolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function pauseUnreadPolling() {
    if (unreadPollTimer) {
      clearInterval(unreadPollTimer);
      unreadPollTimer = null;
    }
  }

  function startPolling() {
    pausePolling();
    const intervalMs = hasOpenChat() ? 2000 : 12000;
    pollTimer = setInterval(function () {
      if (hasOpenChat()) {
        loadActiveThread().then(function () {
          return loadInbox();
        });
      } else {
        loadInbox();
      }
    }, intervalMs);
  }

  function bindReceiptRefreshOnFocus() {
    if (window.__oceanDmFocusBound) return;
    window.__oceanDmFocusBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshOpenChatReceipts();
    });
    window.addEventListener('focus', refreshOpenChatReceipts);
  }

  function startUnreadPolling() {
    pauseUnreadPolling();
    async function tick() {
      if (!sessionStorage.getItem(TOKEN_KEY)) return;
      if (isPanelActive()) {
        if (hasOpenChat() && !voicePlaybackLocked()) await loadActiveThread();
        await loadInbox();
      } else {
        await refreshUnreadBadges();
      }
    }
    tick();
    unreadPollTimer = setInterval(tick, 4000);
  }

  function updateMeLabel() {
    const el = document.getElementById('dm-me-label');
    if (!el) return;
    const st = currentStaff();
    const parts = [myDisplayName()];
    if (st && st.workspace_label) parts.push(st.workspace_label);
    else parts.push(myRoleLabel());
    if (st && st.email) parts.push(String(st.email).trim());
    el.textContent = parts.filter(Boolean).join(' · ');
  }

  function updateMessagesPanelIntro() {
    const panel = messagesPanelEl();
    if (!panel) return;
    const intro = panel.querySelector('.js-messages-intro');
    if (!intro) return;
    if (isGhostObserverMode()) {
      intro.innerHTML =
        '<strong>Class &amp; skill</strong> messages (📋) and <strong>staff private</strong> chats are listed below. ' +
        'As system admin you can open any conversation <strong>read-only</strong>. Use <strong>New chat</strong> to message someone directly.';
    } else {
      intro.innerHTML =
        'Use <strong>📋 Class &amp; skill</strong> channels to message skill teachers or all staff in this class. ' +
        'Use <strong>New chat</strong> for a private message to another staff member.';
    }
  }

  window.__oceanLeaderMessagesInit = async function () {
    const panel = messagesPanelEl();
    if (!panel) return;
    if (isLeadershipBrowsingClassWorkspace()) return;
    bindNewChatModal();
    bindForm();
    bindVoiceNotes();
    bindClearChat();
    bindProfileHeader();
    const authed = await ensureStaffAuth();
    if (!authed) return;
    updateMessagesPanelIntro();
    if (window.OceanMessageNotify && messagesPanelId()) {
      window.OceanMessageNotify.attachPanelAskOnce(messagesPanelId());
    }
    updateMeLabel();
    const backBtn = document.getElementById('dm-back-btn');
    if (backBtn && !backBtn.dataset.bound) {
      backBtn.dataset.bound = '1';
      backBtn.addEventListener('click', function () {
        closeCurrentChat();
      });
    }
    const ref = document.getElementById('leader-messages-refresh');
    if (ref && !ref.dataset.bound) {
      ref.dataset.bound = '1';
      ref.addEventListener('click', function () {
        setFeedback('', true);
        refreshChat();
      });
    }
    activePeerId = null;
    activeObservePeerId = null;
    activeGroupId = null;
    activeClassChannel = null;
    lastSeenMessageIds = new Set();
    pollPrimed = false;
    openMobileChat(false);
    syncObserverComposeUi();
    loadContacts();
    ensureDmEmptyPane();
    loadInbox().then(function () {
      renderThread([], null, null);
      syncDmLayout();
    });
    bindReceiptRefreshOnFocus();
    startPolling();
    startUnreadPolling();
  };

  window.__oceanLeaderMessagesPause = function () {
    pausePolling();
    refreshUnreadBadges();
  };

  window.__oceanLeaderMessagesStartUnreadWatch = async function () {
    if (!messagesPanelEl() && !document.querySelector('[data-tab="messages"], [data-tab="skill-messages"]')) {
      return;
    }
    if (isLeadershipBrowsingClassWorkspace()) return;
    const authed = await ensureStaffAuth();
    if (!authed) return;
    startUnreadPolling();
  };

  function bootUnreadWatch() {
    if (!document.querySelector('[data-tab="messages"], [data-tab="skill-messages"]')) return;
    setTimeout(function () {
      if (window.__oceanLeaderMessagesStartUnreadWatch) {
        window.__oceanLeaderMessagesStartUnreadWatch();
      }
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootUnreadWatch);
  } else {
    bootUnreadWatch();
  }
})();
