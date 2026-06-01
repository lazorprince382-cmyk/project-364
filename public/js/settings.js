/**
 * Profile (display name + photo) saved on your staff login account.
 * Theme, tips, and stream labels stay in this browser only.
 */
(function () {
  const P = 'ocean_';
  const TOKEN_KEY = 'ocean_staff_token';
  const PROFILE_KEY = 'ocean_staff_profile';

  function scopeSuffixFromUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      let staffRole = '';
      let staffEmail = '';
      try {
        const raw = sessionStorage.getItem(PROFILE_KEY) || '';
        if (raw) {
          const st = JSON.parse(raw);
          staffRole = String((st && st.role) || '')
            .trim()
            .toLowerCase();
          staffEmail = String((st && st.email) || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_');
        }
      } catch (_) {}
      const cl = String(p.get('class') || '')
        .trim()
        .toLowerCase();
      if (!cl) {
        const path = String(window.location.pathname || '').toLowerCase();
        if (path.indexOf('director-dashboard') !== -1) return '_director_' + (staffEmail || 'account');
        if (path.indexOf('head-dashboard') !== -1) return '_head_' + (staffEmail || 'account');
        if (path.indexOf('skill-dashboard') !== -1) {
          const subject = String(p.get('subject') || '')
            .trim()
            .toLowerCase();
          return '_skill_' + (subject || '_') + '_' + (staffEmail || staffRole || 'account');
        }
        return '';
      }
      const st = String(p.get('stream') || '')
        .trim()
        .toLowerCase();
      return '_' + cl + '_' + (st || '_');
    } catch (_) {
      return '';
    }
  }

  function get(key) {
    try {
      return localStorage.getItem(P + key);
    } catch {
      return null;
    }
  }

  function set(key, val) {
    try {
      if (val == null || val === '') localStorage.removeItem(P + key);
      else localStorage.setItem(P + key, val);
    } catch (_) {}
  }

  function getStaffProfile() {
    try {
      const raw = sessionStorage.getItem(PROFILE_KEY) || '';
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function hasStaffSession() {
    return !!(sessionStorage.getItem(TOKEN_KEY) && getStaffProfile());
  }

  function authHeaders() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function mergeStaffSession(patch) {
    const prev = getStaffProfile() || {};
    const next = Object.assign({}, prev, patch || {});
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    return next;
  }

  async function refreshStaffProfileFromServer() {
    if (!sessionStorage.getItem(TOKEN_KEY)) return null;
    try {
      const res = await fetch('/api/auth/staff-me', { headers: authHeaders() });
      if (!res.ok) return null;
      const row = await res.json();
      mergeStaffSession({
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        role: row.role,
        class_level: row.class_level,
        stream: row.stream,
        avatar_url: row.avatar_url || null,
      });
      return row;
    } catch (_) {
      return null;
    }
  }

  async function saveStaffProfile(patch) {
    const res = await fetch('/api/auth/staff-profile', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      if (res.status === 404 && text.indexOf('<!DOCTYPE') !== -1) {
        throw new Error(
          'Server is out of date. Stop npm run dev in the terminal, start it again, then hard-refresh this page (Ctrl+F5).'
        );
      }
      throw new Error(data.error || 'Could not save profile');
    }
    mergeStaffSession({
      display_name: data.display_name,
      avatar_url: data.avatar_url || null,
    });
    return data;
  }

  function getDisplayName() {
    const st = getStaffProfile();
    if (hasStaffSession()) {
      if (st && st.display_name && String(st.display_name).trim()) {
        return String(st.display_name).trim();
      }
      return '';
    }
    const suffix = scopeSuffixFromUrl();
    if (suffix) {
      return get('displayName' + suffix) || '';
    }
    return get('displayName') || '';
  }

  function setDisplayName(name) {
    const suffix = scopeSuffixFromUrl();
    if (suffix) set('displayName' + suffix, name);
    else set('displayName', name);
  }

  function getThemeValue() {
    const suffix = scopeSuffixFromUrl();
    if (suffix) {
      return get('theme' + suffix) || 'ocean';
    }
    return get('theme') || 'ocean';
  }

  function setThemeValue(theme) {
    const suffix = scopeSuffixFromUrl();
    if (suffix) set('theme' + suffix, theme);
    else set('theme', theme);
  }

  function getDashUiValue() {
    const suffix = scopeSuffixFromUrl();
    const key = suffix ? 'dashUi' + suffix : 'dashUi';
    const v = get(key) || 'default';
    return v === 'clear-ocean' ? 'clear-ocean' : 'default';
  }

  function setDashUiValue(ui) {
    const suffix = scopeSuffixFromUrl();
    const key = suffix ? 'dashUi' + suffix : 'dashUi';
    set(key, ui === 'clear-ocean' ? 'clear-ocean' : 'default');
  }

  function applyDashUi() {
    const ui = getDashUiValue();
    if (ui === 'clear-ocean') {
      document.documentElement.setAttribute('data-dash-ui', 'clear-ocean');
    } else {
      document.documentElement.removeAttribute('data-dash-ui');
    }
    if (window.OceanWelcomeBanner && typeof window.OceanWelcomeBanner.onDashUiChange === 'function') {
      window.OceanWelcomeBanner.onDashUiChange();
    }
    try {
      window.dispatchEvent(new CustomEvent('ocean-dash-ui-changed', { detail: { ui: ui } }));
    } catch (_) {}
  }

  function ensureDashUiPicker() {
    if (!document.body.classList.contains('app-dash')) return null;
    let block = document.getElementById('settings-dash-ui-block');
    if (block) return block;
    const themeWrap =
      document.getElementById('settings-theme') &&
      document.getElementById('settings-theme').closest('div');
    const form = document.querySelector('#panel-settings .form-grid') || document.querySelector('.form-grid');
    if (!form) return null;
    block = document.createElement('div');
    block.id = 'settings-dash-ui-block';
    block.className = 'settings-dash-ui-block';
    block.innerHTML =
      '<h4 class="settings-section-title">Change UI</h4>' +
      '<p class="settings-hint">Dashboard look on this device. Pick <strong>Clear Ocean</strong> for the new layout, or <strong>Default</strong> to switch back.</p>' +
      '<div class="settings-ui-picker" role="listbox" aria-label="Dashboard UI">' +
      '<button type="button" class="settings-ui-option" data-dash-ui="default">' +
      '<strong>Default</strong><span>Original Ocean dashboard</span></button>' +
      '<button type="button" class="settings-ui-option" data-dash-ui="clear-ocean">' +
      '<strong>Clear Ocean</strong><span>Blue wave banner, stat cards &amp; red actions</span></button>' +
      '</div>';
    if (themeWrap && themeWrap.parentNode === form) {
      form.insertBefore(block, themeWrap);
    } else {
      const nameWrap = document.getElementById('settings-display-name');
      const anchor = nameWrap && nameWrap.closest('div');
      if (anchor && anchor.parentNode === form) {
        form.insertBefore(block, anchor.nextSibling);
      } else {
        form.insertBefore(block, form.firstChild);
      }
    }
    return block;
  }

  function bindDashUiPicker() {
    const block = ensureDashUiPicker();
    if (!block) return;
    const current = getDashUiValue();
    block.querySelectorAll('.settings-ui-option').forEach(function (btn) {
      const val = btn.getAttribute('data-dash-ui');
      btn.classList.toggle('is-selected', val === current);
      if (btn.dataset.dashUiBound) return;
      btn.dataset.dashUiBound = '1';
      btn.addEventListener('click', function () {
        setDashUiValue(val);
        applyDashUi();
        block.querySelectorAll('.settings-ui-option').forEach(function (b) {
          b.classList.toggle('is-selected', b.getAttribute('data-dash-ui') === getDashUiValue());
        });
        const flash = document.getElementById('flash');
        if (flash) {
          flash.innerHTML =
            '<div class="msg ok">' +
            (getDashUiValue() === 'clear-ocean' ? 'Clear Ocean UI applied.' : 'Default UI restored.') +
            '</div>';
          setTimeout(function () {
            flash.innerHTML = '';
          }, 2800);
        }
      });
    });
  }

  function getAvatarUrl() {
    const st = getStaffProfile();
    if (hasStaffSession()) {
      return st && st.avatar_url ? String(st.avatar_url) : '';
    }
    const suffix = scopeSuffixFromUrl();
    if (suffix) {
      return get('avatarUrl' + suffix) || '';
    }
    return get('avatarUrl') || '';
  }

  function setAvatarUrl(url) {
    if (hasStaffSession()) return;
    const suffix = scopeSuffixFromUrl();
    if (suffix) set('avatarUrl' + suffix, url);
    else set('avatarUrl', url);
  }

  function updateAvatarPreview(url) {
    const preview = document.getElementById('settings-avatar-preview');
    const removeBtn = document.getElementById('settings-avatar-remove');
    if (preview) {
      if (url) {
        preview.src = url;
        preview.style.display = '';
      } else {
        preview.removeAttribute('src');
        preview.style.display = 'none';
      }
    }
    if (removeBtn) {
      removeBtn.disabled = !url;
      removeBtn.style.display = hasStaffSession() ? '' : 'none';
    }
  }

  function ensureRemoveAvatarButton() {
    const fileInp = document.getElementById('settings-avatar-file');
    if (!fileInp || document.getElementById('settings-avatar-remove')) return;
    const wrap = fileInp.parentElement;
    if (!wrap) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.id = 'settings-avatar-remove';
    btn.textContent = 'Remove photo';
    btn.style.marginTop = '0.45rem';
    btn.addEventListener('click', async function () {
      if (!hasStaffSession()) {
        alert('Sign in to remove your profile photo from your account.');
        return;
      }
      if (!getAvatarUrl()) return;
      if (!window.confirm('Remove your profile photo from your staff account?')) return;
      try {
        await saveStaffProfile({ avatar_url: null });
        updateAvatarPreview('');
        syncProfileBar();
        try {
          window.dispatchEvent(new CustomEvent('ocean-profile-updated'));
        } catch (_) {}
        const flash = document.getElementById('flash');
        if (flash) {
          flash.innerHTML = '<div class="msg ok">Profile photo removed from your account.</div>';
          setTimeout(function () {
            flash.innerHTML = '';
          }, 3500);
        }
      } catch (e) {
        alert(e.message || 'Could not remove photo');
      }
    });
    wrap.appendChild(btn);
  }

  function getStreamLabelOverrides() {
    try {
      const raw = localStorage.getItem('ocean_stream_labels') || '{}';
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function saveStreamLabelOverrides(nextMap) {
    try {
      localStorage.setItem('ocean_stream_labels', JSON.stringify(nextMap || {}));
    } catch (_) {}
  }

  function currentStreamSlug() {
    try {
      const p = new URLSearchParams(window.location.search);
      return String(p.get('stream') || '')
        .trim()
        .toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function applyTheme() {
    const t = getThemeValue();
    if (t === 'ocean') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', t);
    }
  }

  function syncProfileBar() {
    const name = getDisplayName() || '';
    const url = getAvatarUrl() || '';
    const barName = document.getElementById('profile-bar-name');
    const barImg = document.getElementById('profile-bar-avatar');
    if (barName) {
      barName.textContent = name ? name : 'Teacher';
    }
    if (barImg) {
      if (url) {
        barImg.src = url;
        barImg.alt = name || 'Profile';
        barImg.style.display = '';
      } else {
        barImg.removeAttribute('src');
        barImg.style.display = 'none';
      }
    }
  }

  function applyTipsVisibility() {
    const off = get('showTips') === '0';
    document.querySelectorAll('.js-optional-tip').forEach(function (el) {
      el.style.display = off ? 'none' : '';
    });
  }

  function bindPasswordChangeForm() {
    const curInp = document.getElementById('settings-current-password');
    const newInp = document.getElementById('settings-new-password');
    const btn = document.getElementById('settings-change-password');
    const msg = document.getElementById('settings-password-msg');
    const block = document.querySelector('.settings-password-block');
    if (!curInp || !newInp || !btn) return;
    if (block) block.style.display = hasStaffSession() ? '' : 'none';
    if (!hasStaffSession()) return;

    btn.addEventListener('click', async function () {
      const current = curInp.value;
      const next = newInp.value;
      if (!current || !next) {
        if (msg) {
          msg.textContent = 'Enter your current and new password.';
          msg.style.display = 'block';
        }
        return;
      }
      if (next.length < 6) {
        if (msg) {
          msg.textContent = 'New password must be at least 6 characters.';
          msg.style.display = 'block';
        }
        return;
      }
      btn.disabled = true;
      if (msg) msg.style.display = 'none';
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ current_password: current, new_password: next }),
        });
        const data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok) throw new Error(data.error || 'Could not change password');
        curInp.value = '';
        newInp.value = '';
        if (msg) {
          msg.textContent = data.message || 'Account password has been changed.';
          msg.style.display = 'block';
          msg.style.color = 'var(--accent, #4ade80)';
        }
        const flash = document.getElementById('flash');
        if (flash) {
          flash.innerHTML = '<div class="msg ok">' + (data.message || 'Account password has been changed.') + '</div>';
          setTimeout(function () {
            flash.innerHTML = '';
          }, 4000);
        }
      } catch (e) {
        if (msg) {
          msg.textContent = e.message || 'Could not change password';
          msg.style.display = 'block';
          msg.style.color = 'var(--brand-red-soft, #f87171)';
        }
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindSettingsForm() {
    const themeSel = document.getElementById('settings-theme');
    const nameInp = document.getElementById('settings-display-name');
    const fileInp = document.getElementById('settings-avatar-file');
    const preview = document.getElementById('settings-avatar-preview');
    const saveBtn = document.getElementById('settings-save');
    const tipsChk = document.getElementById('settings-show-tips');
    const streamInp = document.getElementById('settings-stream-name');
    const streamHint = document.getElementById('settings-stream-hint');
    const streamSlug = currentStreamSlug();
    const defaultStreamLabels = {
      waves: 'Waves',
      pearls: 'Pearls',
      dolphins: 'Dolphins',
      whales: 'Whales',
    };

    if (themeSel) {
      themeSel.value = getThemeValue();
      themeSel.addEventListener('change', function () {
        setThemeValue(themeSel.value);
        applyTheme();
      });
    }

    if (nameInp) {
      nameInp.value = getDisplayName() || '';
    }

    if (streamInp) {
      if (!streamSlug) {
        streamInp.value = '';
        streamInp.disabled = true;
        if (streamHint) streamHint.textContent = 'No stream on this class.';
      } else {
        const labels = getStreamLabelOverrides();
        streamInp.value = String(labels[streamSlug] || defaultStreamLabels[streamSlug] || streamSlug);
        streamInp.disabled = false;
        if (streamHint) {
          streamHint.textContent =
            'Editing stream "' + streamSlug + '" changes how it displays on this device.';
        }
      }
    }

    if (tipsChk) {
      tipsChk.checked = get('showTips') !== '0';
    }

    const avatarHint = fileInp && fileInp.parentElement ? fileInp.parentElement.querySelector('.settings-hint') : null;
    if (avatarHint) {
      avatarHint.textContent = hasStaffSession()
        ? 'Saved on your staff account.'
        : 'Sign in to upload a photo.';
    }

    bindPasswordChangeForm();

    ensureRemoveAvatarButton();
    updateAvatarPreview(getAvatarUrl() || '');

    if (fileInp && preview) {
      fileInp.addEventListener('change', async function () {
        const f = fileInp.files[0];
        if (!f) return;
        if (!hasStaffSession()) {
          alert('Sign in to save a profile photo on your account.');
          fileInp.value = '';
          return;
        }
        const fd = new FormData();
        fd.append('avatar', f);
        try {
          const res = await fetch('/api/profile/avatar', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + sessionStorage.getItem(TOKEN_KEY) },
            body: fd,
          });
          const data = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          mergeStaffSession({ avatar_url: data.url });
          updateAvatarPreview(data.url);
          syncProfileBar();
          try {
            window.dispatchEvent(new CustomEvent('ocean-profile-updated'));
          } catch (_) {}
        } catch (e) {
          alert(e.message || 'Could not upload photo');
        }
        fileInp.value = '';
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        const flash = document.getElementById('flash');
        try {
          if (hasStaffSession() && nameInp) {
            const trimmed = nameInp.value.trim();
            if (!trimmed) {
              alert('Enter a display name.');
              return;
            }
            await saveStaffProfile({ display_name: trimmed });
          } else if (nameInp) {
            setDisplayName(nameInp.value.trim());
          }

          if (tipsChk) set('showTips', tipsChk.checked ? '1' : '0');
          if (themeSel) setThemeValue(themeSel.value);
          if (streamInp && streamSlug) {
            const labels = getStreamLabelOverrides();
            const nextLabel = String(streamInp.value || '').trim();
            if (nextLabel) labels[streamSlug] = nextLabel;
            else delete labels[streamSlug];
            saveStreamLabelOverrides(labels);
            try {
              window.dispatchEvent(
                new CustomEvent('ocean-stream-labels-updated', {
                  detail: { stream: streamSlug, label: nextLabel, labels: labels },
                })
              );
            } catch (_) {}
          }
          applyDashUi();
          applyTheme();
          applyTipsVisibility();
          syncProfileBar();
          try {
            window.dispatchEvent(new CustomEvent('ocean-profile-updated'));
          } catch (_) {}
          if (flash) {
            flash.innerHTML =
              '<div class="msg ok">' +
              (hasStaffSession()
                ? 'Profile saved on your staff account.'
                : 'Settings saved on this device.') +
              '</div>';
            setTimeout(function () {
              flash.innerHTML = '';
            }, 3500);
          }
        } catch (e) {
          if (flash) {
            flash.innerHTML =
              '<div class="msg err">' + (e.message || 'Could not save profile') + '</div>';
          } else {
            alert(e.message || 'Could not save profile');
          }
        }
      });
    }
  }

  async function boot() {
    if (hasStaffSession()) {
      await refreshStaffProfileFromServer();
    }
    applyDashUi();
    applyTheme();
    syncProfileBar();
    applyTipsVisibility();
    bindSettingsForm();
    bindDashUiPicker();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && hasStaffSession()) {
      refreshStaffProfileFromServer()
        .then(function () {
          syncProfileBar();
          updateAvatarPreview(getAvatarUrl() || '');
        })
        .catch(function () {});
    }
  });

  window.OceanSettings = {
    applyTheme: applyTheme,
    applyDashUi: applyDashUi,
    getDashUiValue: getDashUiValue,
    setDashUiValue: setDashUiValue,
    syncProfileBar: syncProfileBar,
    applyTipsVisibility: applyTipsVisibility,
    getDisplayName: getDisplayName,
    getAvatarUrl: getAvatarUrl,
    refreshStaffProfileFromServer: refreshStaffProfileFromServer,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
