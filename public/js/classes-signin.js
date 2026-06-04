(function () {
  const auth = window.OceanStaffAuth;
  if (!auth) return;

  const REMEMBER_KEY = 'ocean_classes_remember_email';

  function roleOk(staff, roles) {
    if (auth.roleAllowed) return auth.roleAllowed(staff, roles);
    return !!(staff && roles.indexOf(staff.role) >= 0);
  }

  const SIGNIN_PRESETS = {
    class: {
      title: 'Sign in to open this class',
      subtitle: 'Use your school email and password to continue.',
      roles: ['class_teacher', 'head_teacher', 'director', 'system_admin'],
      wrongRoleError: 'This sign-in is not for your account type.',
    },
    skill: {
      title: 'Sign in to open this subject',
      subtitle: 'Use your school email and password to continue.',
      roles: ['skill_teacher', 'head_teacher', 'director', 'system_admin'],
      wrongRoleError: 'This sign-in is not for your account type.',
    },
    head: {
      title: 'Head teacher sign in',
      subtitle: 'Use your school email and password to continue.',
      roles: ['head_teacher', 'director', 'system_admin'],
      wrongRoleError: 'This sign-in is not for your account type.',
      kind: 'head',
    },
  };

  const overlay = document.getElementById('class-signin-overlay');
  const titleEl = document.getElementById('class-signin-title');
  const subtitleEl = document.getElementById('class-signin-subtitle');
  const form = document.getElementById('class-signin-form');
  const errEl = document.getElementById('class-signin-err');
  const emailInput = document.getElementById('class-signin-email');
  const rememberInput = document.getElementById('class-signin-remember');
  const cancelBtn = document.getElementById('class-signin-cancel');
  const closeBtn = document.getElementById('class-signin-close');
  const forgotBtn = document.getElementById('class-signin-forgot');

  if (!overlay || !form) return;

  let pending = null;

  function loadRememberedEmail() {
    if (!emailInput || !rememberInput) return;
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        emailInput.value = saved;
        rememberInput.checked = true;
      }
    } catch (_) {}
  }

  function persistRememberedEmail(email) {
    if (!rememberInput) return;
    try {
      if (rememberInput.checked && email) {
        localStorage.setItem(REMEMBER_KEY, email);
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch (_) {}
  }

  function showError(msg) {
    if (!errEl) return;
    if (msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }

  function hideOverlay() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    pending = null;
    showError('');
    form.reset();
    if (rememberInput) rememberInput.checked = true;
    loadRememberedEmail();
  }

  function showOverlay(opts, message) {
    pending = opts;
    if (titleEl) titleEl.textContent = opts.title || 'Sign in to open this class';
    if (subtitleEl) {
      subtitleEl.textContent = opts.subtitle || 'Use your school email and password to continue.';
    }
    showError(message || '');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    loadRememberedEmail();
    if (emailInput) {
      setTimeout(function () {
        emailInput.focus();
      }, 50);
    }
  }

  function goAfterAuth(staff, opts) {
    if (
      opts.kind === 'head' &&
      (staff.role === 'director' || staff.role === 'system_admin' || staff.role === 'ghost')
    ) {
      window.location.href = '/director-dashboard.html';
      return true;
    }
    if (opts.kind === 'class' && staff.role === 'class_teacher') {
      const parsed = auth.parseClassDashboardUrl(opts.targetUrl);
      if (parsed && !auth.staffMatchesClassTarget(staff, parsed.classLevel, parsed.stream)) {
        auth.clearSession();
        showOverlay(
          opts,
          'This account is for a different class. Sign in with the teacher account for this class.'
        );
        return false;
      }
    }
    window.location.href = opts.targetUrl;
    return true;
  }

  function classTeacherMayUseSession(staff, opts) {
    if (!staff || staff.role !== 'class_teacher' || opts.kind !== 'class') return true;
    const parsed = auth.parseClassDashboardUrl(opts.targetUrl);
    if (!parsed) return true;
    return auth.staffMatchesClassTarget(staff, parsed.classLevel, parsed.stream);
  }

  function leadershipMustSignInForWorkspace(opts) {
    const staff = auth.getStoredStaff();
    if (!staff) return false;
    if (opts.kind !== 'class' && opts.kind !== 'skill') return false;
    return auth.isLeadershipStaff && auth.isLeadershipStaff(staff);
  }

  function tryNavigate(opts) {
    if (leadershipMustSignInForWorkspace(opts)) {
      auth.clearSession();
      showOverlay(opts);
      return;
    }
    const staff = auth.getStoredStaff();
    const token = sessionStorage.getItem(auth.TOKEN_KEY);
    if (token && staff) {
      if (!roleOk(staff, opts.roles)) {
        auth.clearSession();
        showOverlay(opts, opts.wrongRoleError || 'This account cannot open this area.');
        return;
      }
      if (!classTeacherMayUseSession(staff, opts)) {
        auth.clearSession();
        showOverlay(opts, 'Sign in with the account for this class.');
        return;
      }
      goAfterAuth(staff, opts);
      return;
    }
    showOverlay(opts);
  }

  function requestAccess(presetKey, targetUrl, extra) {
    const base = SIGNIN_PRESETS[presetKey] || SIGNIN_PRESETS.class;
    const opts = Object.assign({ targetUrl: targetUrl, kind: presetKey }, base, extra || {});
    tryNavigate(opts);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!pending) return;
    showError('');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = document.getElementById('class-signin-password').value;
    fetch('/api/auth/staff-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { res: res, body: body };
        });
      })
      .then(function (x) {
        if (!x.res.ok) {
          showError(x.body.error || 'Sign-in failed');
          return;
        }
        const staff = x.body.staff;
        if (!staff || !roleOk(staff, pending.roles)) {
          showError(pending.wrongRoleError || 'This account cannot open this area.');
          return;
        }
        persistRememberedEmail(email);
        auth.setSession(x.body.token, staff);
        if (auth.isLeadershipStaff && auth.isLeadershipStaff(staff) && auth.grantClassWorkspaceEntry) {
          auth.grantClassWorkspaceEntry();
        }
        const target = pending;
        if (goAfterAuth(staff, target)) hideOverlay();
      })
      .catch(function () {
        showError('Cannot reach the server. Make sure the school app is running (npm start).');
      });
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideOverlay);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', hideOverlay);
  }

  if (forgotBtn) {
    forgotBtn.addEventListener('click', function () {
      showError('Contact your school director to reset your password.');
    });
  }

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideOverlay();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) hideOverlay();
  });

  function openFromQuery() {
    const q = new URLSearchParams(window.location.search);
    const kind = q.get('signin');
    const next = q.get('next');
    if (!kind || !next || !auth.isSafeNext) return;
    if (!auth.isSafeNext(next)) return;
    const preset = SIGNIN_PRESETS[kind];
    if (!preset) return;
    requestAccess(kind, next);
    const clean = window.location.pathname;
    window.history.replaceState({}, '', clean);
  }

  loadRememberedEmail();
  openFromQuery();

  window.ClassesPageAuth = {
    requestAccess: requestAccess,
    tryNavigate: tryNavigate,
    hide: hideOverlay,
  };
})();
