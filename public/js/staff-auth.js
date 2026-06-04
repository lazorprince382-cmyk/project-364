(function (global) {
  const TOKEN_KEY = 'ocean_staff_token';
  const STAFF_KEY = 'ocean_staff_profile';
  const DIRECTOR_BROWSE_KEY = 'ocean_director_class_browse';
  const CLASS_WORKSPACE_OK_KEY = 'ocean_class_workspace_ok';
  const LAST_ACTIVITY_KEY = 'ocean_staff_last_activity';
  const SESSION_GRACE_KEY = 'ocean_session_grace';
  const SESSION_ENTRY_KEY = 'ocean_session_entry';
  const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  const IDLE_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  let idleCheckTimer = null;
  let idleListenersBound = false;
  let idleThrottleTimer = null;

  const SKILL_SLUG_MAP = {
    computer: 'Computer',
    salon: 'Salon',
    bakery: 'Bakery',
    fashion: 'Fashion and Design',
    music: 'Music',
  };

  const LEVEL_LABELS = {
    daycare: 'Day Care',
    baby: 'Baby Class',
    middle: 'Middle Class',
    top: 'Top Class',
    primary1: 'Primary One',
    primary2: 'Primary Two',
  };

  function normalizeClassLevelSlug(v) {
    const s = String(v || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (s === 'daycare' || s === 'daycareclass') return 'daycare';
    if (s === 'baby' || s === 'babyclass') return 'baby';
    if (s === 'middle' || s === 'middleclass') return 'middle';
    if (s === 'top' || s === 'topclass') return 'top';
    if (s === 'primary1' || s === 'p1') return 'primary1';
    if (s === 'primary2' || s === 'p2') return 'primary2';
    return String(v || '').trim().toLowerCase();
  }

  function getStoredStaff() {
    const raw = sessionStorage.getItem(STAFF_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function setSession(token, staff) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(STAFF_KEY, JSON.stringify(staff));
    touchActivity();
    sessionStorage.setItem(SESSION_ENTRY_KEY, '1');
  }

  function touchActivity() {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }

  function markGracefulUnload() {
    try {
      sessionStorage.setItem(SESSION_GRACE_KEY, '1');
    } catch (_) {}
  }

  function sessionIdleExpired() {
    const last = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || 0);
    if (!last) return true;
    return Date.now() - last > IDLE_TIMEOUT_MS;
  }

  function expireSessionAndRedirect(opts) {
    opts = opts || {};
    clearSession();
    if (opts.loginViaClasses && opts.classesKind) {
      redirectToClassesSignIn(opts.classesKind, window.location.pathname + window.location.search);
      return;
    }
    redirectToLogin(opts.loginPath || '/admin.html', opts.preserveNext !== false);
  }

  /** Block dashboard load after idle timeout or abrupt browser return (power loss, crash). */
  function validateSessionFreshness(opts) {
    opts = opts || {};
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return true;

    if (sessionStorage.getItem(SESSION_ENTRY_KEY) === '1') {
      sessionStorage.removeItem(SESSION_ENTRY_KEY);
      touchActivity();
      return true;
    }

    const grace = sessionStorage.getItem(SESSION_GRACE_KEY);
    sessionStorage.removeItem(SESSION_GRACE_KEY);

    if (!grace || sessionIdleExpired()) {
      expireSessionAndRedirect(opts);
      return false;
    }

    touchActivity();
    return true;
  }

  function throttleActivityTouch() {
    if (idleThrottleTimer) return;
    idleThrottleTimer = setTimeout(function () {
      idleThrottleTimer = null;
      touchActivity();
    }, 15000);
    touchActivity();
  }

  function stopIdleWatch() {
    if (idleCheckTimer) {
      clearInterval(idleCheckTimer);
      idleCheckTimer = null;
    }
    if (idleThrottleTimer) {
      clearTimeout(idleThrottleTimer);
      idleThrottleTimer = null;
    }
    if (idleListenersBound) {
      IDLE_EVENTS.forEach(function (ev) {
        document.removeEventListener(ev, throttleActivityTouch);
      });
      idleListenersBound = false;
    }
  }

  function startIdleWatch(opts) {
    opts = opts || {};
    stopIdleWatch();
    touchActivity();
    IDLE_EVENTS.forEach(function (ev) {
      document.addEventListener(ev, throttleActivityTouch, { passive: true });
    });
    idleListenersBound = true;
    idleCheckTimer = setInterval(function () {
      if (!sessionStorage.getItem(TOKEN_KEY)) {
        stopIdleWatch();
        return;
      }
      if (sessionIdleExpired()) {
        stopIdleWatch();
        expireSessionAndRedirect(opts);
      }
    }, 30000);
    document.addEventListener('visibilitychange', function onVis() {
      if (document.visibilityState === 'visible' && sessionStorage.getItem(TOKEN_KEY) && sessionIdleExpired()) {
        stopIdleWatch();
        expireSessionAndRedirect(opts);
      }
    });
  }

  function guardDashboardPage(opts) {
    opts = opts || {};
    if (!validateSessionFreshness(opts)) return null;
    const staff = requireSync({
      roles: opts.roles || null,
      loginPath: opts.loginPath || '/admin.html',
      wrongRoleMessage: opts.wrongRoleMessage,
    });
    if (!staff) return null;
    startIdleWatch(opts);
    return staff;
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(STAFF_KEY);
    sessionStorage.removeItem(DIRECTOR_BROWSE_KEY);
    sessionStorage.removeItem(CLASS_WORKSPACE_OK_KEY);
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
    sessionStorage.removeItem(SESSION_GRACE_KEY);
    sessionStorage.removeItem(SESSION_ENTRY_KEY);
    stopIdleWatch();
  }

  function grantDirectorClassBrowse() {
    sessionStorage.setItem(DIRECTOR_BROWSE_KEY, '1');
  }

  function consumeDirectorClassBrowse() {
    if (sessionStorage.getItem(DIRECTOR_BROWSE_KEY) === '1') {
      sessionStorage.removeItem(DIRECTOR_BROWSE_KEY);
      return true;
    }
    return false;
  }

  function clearDirectorClassBrowse() {
    sessionStorage.removeItem(DIRECTOR_BROWSE_KEY);
  }

  /** Director may open a class/skill dashboard once; refresh or classes page requires sign-in again. */
  function enforceDirectorClassBrowseEntry() {
    const staff = getStoredStaff();
    if (!staff || staff.role !== 'director') return true;
    if (consumeDirectorClassBrowse()) return true;
    clearSession();
    window.location.href = '/admin.html';
    return false;
  }

  function isSystemAdminStaff(staff) {
    const r = staff && staff.role;
    return r === 'system_admin' || r === 'ghost';
  }

  function isGhostStaff(staff) {
    return isSystemAdminStaff(staff);
  }

  function roleAllowed(staff, roles) {
    if (!staff || !roles || !roles.length) return false;
    if (isSystemAdminStaff(staff)) return true;
    const r = staff.role;
    if (r === 'ghost' && roles.indexOf('system_admin') >= 0) return true;
    return roles.indexOf(r) >= 0;
  }

  function isDirectorStaff(staff) {
    return !!(staff && staff.role === 'director');
  }

  function isHeadTeacherStaff(staff) {
    return !!(staff && staff.role === 'head_teacher');
  }

  function isLeadershipStaff(staff) {
    if (isSystemAdminStaff(staff)) return false;
    return isDirectorStaff(staff) || isHeadTeacherStaff(staff);
  }

  /** Route director/head through classes sign-in before opening a class or skill workspace. */
  function classWorkspaceSignInHref(targetUrl, presetKey) {
    const kind = presetKey || 'class';
    return (
      '/classes.html?signin=' + encodeURIComponent(kind) + '&next=' + encodeURIComponent(targetUrl)
    );
  }

  function grantClassWorkspaceEntry() {
    sessionStorage.setItem(CLASS_WORKSPACE_OK_KEY, '1');
  }

  function consumeClassWorkspaceEntry() {
    if (sessionStorage.getItem(CLASS_WORKSPACE_OK_KEY) === '1') {
      sessionStorage.removeItem(CLASS_WORKSPACE_OK_KEY);
      return true;
    }
    return false;
  }

  function clearClassWorkspaceEntry() {
    sessionStorage.removeItem(CLASS_WORKSPACE_OK_KEY);
  }

  function authHeaders() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function isSafeNext(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin !== window.location.origin) return false;
      const p = u.pathname.toLowerCase();
      if (p === '/' || p.endsWith('admin.html') || p.includes('login')) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function readNextParam() {
    const q = new URLSearchParams(window.location.search);
    const next = q.get('next');
    return isSafeNext(next) ? next : '';
  }

  function redirectToLogin(loginPath, preserveNext) {
    clearSession();
    let url = loginPath || '/admin.html';
    if (preserveNext !== false) {
      const here = window.location.pathname + window.location.search;
      if (isSafeNext(here)) {
        const sep = url.indexOf('?') >= 0 ? '&' : '?';
        url += sep + 'next=' + encodeURIComponent(here);
      }
    }
    window.location.href = url;
  }

  function redirectToLoginForTarget(loginPath, targetUrl, clearFirst) {
    if (clearFirst !== false) clearSession();
    let url = loginPath || '/admin.html';
    if (targetUrl && isSafeNext(targetUrl)) {
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      url += sep + 'next=' + encodeURIComponent(targetUrl);
    }
    window.location.href = url;
  }

  function isSignedIn() {
    return !!(sessionStorage.getItem(TOKEN_KEY) && getStoredStaff());
  }

  /** Send to login if needed; otherwise navigate. Returns false if redirecting to login. */
  function gateNavigate(targetUrl, opts) {
    const options = opts || {};
    const loginPath = options.loginPath || '/login-class.html';
    const roles = options.roles || ['class_teacher', 'head_teacher', 'director'];
    const staff = getStoredStaff();
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token || !staff) {
      redirectToLoginForTarget(loginPath, targetUrl, false);
      return false;
    }
    if (!roleAllowed(staff, roles)) {
      if (options.wrongRoleMessage) alert(options.wrongRoleMessage);
      redirectToLoginForTarget(roleLoginPath(staff.role), targetUrl, false);
      return false;
    }
    window.location.href = targetUrl;
    return true;
  }

  function skillSlugForStaff(staff) {
    const cl = String((staff && staff.class_level) || '').trim();
    if (!cl) return '';
    const lower = cl.toLowerCase();
    for (const slug of Object.keys(SKILL_SLUG_MAP)) {
      if (SKILL_SLUG_MAP[slug].toLowerCase() === lower) return slug;
    }
    if (Object.prototype.hasOwnProperty.call(SKILL_SLUG_MAP, lower)) return lower;
    return lower.replace(/\s+/g, '');
  }

  function classDashboardUrl(staff) {
    const cl = normalizeClassLevelSlug(staff.class_level || '');
    if (!cl) return '/classes.html';
    const q = new URLSearchParams({ class: cl });
    const stream = String(staff.stream || '').trim();
    if (stream) q.set('stream', stream);
    return '/dashboard.html?' + q.toString();
  }

  function skillDashboardUrl(staff) {
    const slug = skillSlugForStaff(staff);
    if (!slug) return '/classes.html';
    return '/skill-dashboard.html?skill=' + encodeURIComponent(slug);
  }

  function homeForStaff(staff, nextUrl) {
    if (nextUrl && isSafeNext(nextUrl)) return nextUrl;
    const role = staff && staff.role;
    if (role === 'system_admin' || role === 'ghost' || role === 'director') return '/director-dashboard.html';
    if (role === 'head_teacher') return '/head-dashboard.html';
    if (role === 'class_teacher') return classDashboardUrl(staff);
    if (role === 'skill_teacher') return skillDashboardUrl(staff);
    return '/';
  }

  function roleLoginPath(role) {
    if (role === 'system_admin' || role === 'ghost' || role === 'director') return '/admin.html';
    if (role === 'head_teacher') return '/login-head.html';
    if (role === 'class_teacher') return '/login-class.html';
    if (role === 'skill_teacher') return '/login-skill.html';
    return '/admin.html';
  }

  function requireSync(opts) {
    const roles = opts && opts.roles ? opts.roles : null;
    const loginPath = (opts && opts.loginPath) || '/admin.html';
    const token = sessionStorage.getItem(TOKEN_KEY);
    const staff = getStoredStaff();
    if (!token || !staff) {
      redirectToLogin(loginPath);
      return null;
    }
    if (roles && roles.length && !roleAllowed(staff, roles)) {
      alert(
        (opts && opts.wrongRoleMessage) ||
          'Your account cannot open this page. Use the sign-in page for your role.'
      );
      redirectToLogin(roleLoginPath(staff.role), false);
      return null;
    }
    return staff;
  }

  function redirectToClassesSignIn(kind, targetUrl) {
    const next =
      targetUrl && isSafeNext(targetUrl)
        ? targetUrl
        : window.location.pathname + window.location.search;
    window.location.href =
      '/classes.html?signin=' + encodeURIComponent(kind || 'class') + '&next=' + encodeURIComponent(next);
  }

  function parseClassDashboardUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      const path = u.pathname.toLowerCase();
      if (path !== '/dashboard.html' && !path.endsWith('/dashboard.html')) return null;
      return {
        classLevel: normalizeClassLevelSlug(u.searchParams.get('class') || ''),
        stream: String(u.searchParams.get('stream') || '').trim().toLowerCase(),
      };
    } catch (_) {
      return null;
    }
  }

  function staffMatchesClassTarget(staff, classLevel, stream) {
    if (!staff || staff.role !== 'class_teacher') return true;
    const assigned = normalizeClassLevelSlug(staff.class_level || '');
    if (!assigned) return true;
    if (assigned !== normalizeClassLevelSlug(classLevel)) return false;
    const needsStream = classLevel === 'baby' || classLevel === 'middle';
    const assignedStream = String(staff.stream || '')
      .trim()
      .toLowerCase();
    if (needsStream && assignedStream && assignedStream !== String(stream || '').trim().toLowerCase()) {
      return false;
    }
    return true;
  }

  function assertClassScope(staff, classLevel, stream) {
    if (staffMatchesClassTarget(staff, classLevel, stream)) return true;
    const q = new URLSearchParams({ class: classLevel });
    if (stream) q.set('stream', stream);
    clearSession();
    redirectToClassesSignIn('class', '/dashboard.html?' + q.toString());
    return false;
  }

  function assertSkillScope(staff, skillKey) {
    if (!staff || staff.role !== 'skill_teacher') return true;
    const slug = skillSlugForStaff(staff);
    if (!slug) return true;
    if (slug !== String(skillKey || '').toLowerCase()) {
      alert('This account is for ' + (SKILL_SLUG_MAP[slug] || slug) + ', not this subject.');
      redirectToClassesSignIn('skill', skillDashboardUrl(staff));
      return false;
    }
    return true;
  }

  function mountLoginPage(config) {
    const allowedRoles = config.allowedRoles || [];
    const loginPath = config.loginPath || window.location.pathname;
    const defaultNext = config.defaultNext || '/';
    const title = config.title || 'Staff sign in';
    const subtitle =
      config.subtitle ||
      'Your school director creates staff accounts under Staff & accounts on the director dashboard.';

    const titleEl = document.getElementById('login-title');
    const subEl = document.getElementById('login-subtitle');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;

    const fileWarn = document.getElementById('login-file-warning');
    const form = document.getElementById('login-form');
    if (!form) return;

    if (window.location.protocol === 'file:') {
      if (fileWarn) {
        fileWarn.textContent =
          'This page was opened from disk (file://). Run npm start in the project folder, then open http://localhost:3000' +
          loginPath +
          ' in your browser.';
        fileWarn.style.display = 'block';
      }
      form.querySelectorAll('input, button').forEach(function (el) {
        el.disabled = true;
      });
      return;
    }

    const existing = getStoredStaff();
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token && existing && roleAllowed(existing, allowedRoles)) {
      window.location.replace(homeForStaff(existing, readNextParam() || defaultNext));
      return;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const err = document.getElementById('login-err');
      if (err) err.style.display = 'none';
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
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
            if (err) {
              err.textContent = x.body.error || 'Sign-in failed';
              err.style.display = 'block';
            }
            return;
          }
          const staff = x.body.staff;
          if (!staff || !roleAllowed(staff, allowedRoles)) {
            if (err) {
              err.textContent = config.wrongRoleError || 'This sign-in page is not for your account type.';
              err.style.display = 'block';
            }
            return;
          }
          setSession(x.body.token, staff);
          window.location.href = homeForStaff(staff, readNextParam() || defaultNext);
        })
        .catch(function () {
          if (err) {
            err.textContent =
              'Cannot reach the server. Run npm start, then open this page at http://localhost:3000' +
              loginPath;
            err.style.display = 'block';
          }
        });
    });
  }

  global.OceanStaffAuth = {
    TOKEN_KEY: TOKEN_KEY,
    STAFF_KEY: STAFF_KEY,
    LAST_ACTIVITY_KEY: LAST_ACTIVITY_KEY,
    IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
    SKILL_SLUG_MAP: SKILL_SLUG_MAP,
    normalizeClassLevelSlug: normalizeClassLevelSlug,
    getStoredStaff: getStoredStaff,
    setSession: setSession,
    clearSession: clearSession,
    touchActivity: touchActivity,
    markGracefulUnload: markGracefulUnload,
    validateSessionFreshness: validateSessionFreshness,
    startIdleWatch: startIdleWatch,
    stopIdleWatch: stopIdleWatch,
    guardDashboardPage: guardDashboardPage,
    authHeaders: authHeaders,
    readNextParam: readNextParam,
    isSafeNext: isSafeNext,
    redirectToLogin: redirectToLogin,
    redirectToLoginForTarget: redirectToLoginForTarget,
    redirectToClassesSignIn: redirectToClassesSignIn,
    isSignedIn: isSignedIn,
    gateNavigate: gateNavigate,
    roleLoginPath: roleLoginPath,
    homeForStaff: homeForStaff,
    classDashboardUrl: classDashboardUrl,
    skillDashboardUrl: skillDashboardUrl,
    skillSlugForStaff: skillSlugForStaff,
    requireSync: requireSync,
    parseClassDashboardUrl: parseClassDashboardUrl,
    staffMatchesClassTarget: staffMatchesClassTarget,
    assertClassScope: assertClassScope,
    assertSkillScope: assertSkillScope,
    mountLoginPage: mountLoginPage,
    grantDirectorClassBrowse: grantDirectorClassBrowse,
    consumeDirectorClassBrowse: consumeDirectorClassBrowse,
    clearDirectorClassBrowse: clearDirectorClassBrowse,
    enforceDirectorClassBrowseEntry: enforceDirectorClassBrowseEntry,
    isSystemAdminStaff: isSystemAdminStaff,
    isGhostStaff: isGhostStaff,
    roleAllowed: roleAllowed,
    isDirectorStaff: isDirectorStaff,
    isHeadTeacherStaff: isHeadTeacherStaff,
    isLeadershipStaff: isLeadershipStaff,
    classWorkspaceSignInHref: classWorkspaceSignInHref,
    grantClassWorkspaceEntry: grantClassWorkspaceEntry,
    consumeClassWorkspaceEntry: consumeClassWorkspaceEntry,
    clearClassWorkspaceEntry: clearClassWorkspaceEntry,
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', markGracefulUnload);
  }
})(typeof window !== 'undefined' ? window : global);
