/**
 * Mobile teacher dashboard shell (class dashboard + leadership dashboards).
 */
(function () {
  const MQ = window.matchMedia('(max-width: 900px)');
  const isLeadership = document.body.classList.contains('app-director') || document.body.classList.contains('app-head');
  const isClassDash = !isLeadership && document.querySelector('.dash-shell') && document.getElementById('dash-title');

  if (!isClassDash && !isLeadership) return;

  function enableMobile() {
    document.body.classList.add('app-teacher-mobile');
    if (isLeadership) document.body.classList.add('app-leadership-mobile');
    buildShellIfNeeded();
    syncHeader();
    syncHomeStats();
    if (isClassDash) renderRecentLearners();
    setMode('home');
    setTimeout(function () {
      syncHomeStats();
      if (isClassDash) renderRecentLearners();
    }, 1200);
  }

  function disableMobile() {
    document.body.classList.remove('app-teacher-mobile', 'app-leadership-mobile', 'tm-mode-home', 'tm-mode-workspace');
    const sheet = document.getElementById('tm-more-sheet');
    if (sheet) sheet.hidden = true;
  }

  function onMq() {
    if (MQ.matches) enableMobile();
    else disableMobile();
  }

  function dashCtx() {
    return window.__oceanDashboard || null;
  }

  function classTitle() {
    const ctx = dashCtx();
    if (ctx) return (ctx.displayTitle || 'Class') + (ctx.streamPart || '');
    const t = document.getElementById('dash-title');
    return t ? t.textContent.trim() : 'Dashboard';
  }

  function schoolLine() {
    return 'THE OCEAN OF KNOWLEDGE SCHOOL';
  }

  function buildShellIfNeeded() {
    if (document.getElementById('tm-shell')) return;

    const shell = document.createElement('div');
    shell.id = 'tm-shell';
    shell.className = 'tm-shell';
    shell.innerHTML =
      '<header class="tm-header" role="banner">' +
      '<button type="button" class="tm-header-back" id="tm-back" aria-label="Back">←</button>' +
      '<div class="tm-header-brand">' +
      '<img class="tm-header-logo" src="/images/ocean-school-logo.png" alt="" width="36" height="36" />' +
      '<div class="tm-header-text">' +
      '<div class="tm-header-title" id="tm-header-title">' +
      escapeHtml(schoolLine()) +
      '</div>' +
      '<div class="tm-header-sub" id="tm-header-sub">Teacher</div>' +
      '</div></div>' +
      '<div class="tm-header-actions">' +
      '<button type="button" class="tm-icon-btn" id="tm-notify" aria-label="Notifications">🔔<span class="tm-badge" id="tm-notify-badge" hidden>0</span></button>' +
      '</div></header>' +
      '<div id="tm-section-nav" class="tm-section-nav" hidden aria-label="Sections"></div>' +
      '<main class="tm-main">' +
      '<div id="tm-view-home" class="tm-view tm-view-home active">' +
      '<section class="tm-hero" aria-label="Welcome">' +
      '<p class="tm-hero-kicker" id="tm-hero-kicker">WELCOME, TEACHER</p>' +
      '<h1 class="tm-hero-title" id="tm-hero-title">Class</h1>' +
      '<p class="tm-hero-sub" id="tm-hero-sub">Great to have you here.</p>' +
      '</section>' +
      '<div class="tm-stats" id="tm-stats" aria-label="Overview"></div>' +
      '<h2 class="tm-section-title">Quick actions</h2>' +
      '<div class="tm-quick-grid" id="tm-quick-grid" style="padding: 0 0.75rem 1rem"></div>' +
      '<div class="tm-section-title-row" style="padding: 0 0.75rem"><h2 class="tm-section-title" style="padding:0;margin:0">Recent learners</h2>' +
      '<button type="button" class="tm-link" id="tm-view-all-learners">View all</button></div>' +
      '<div class="tm-learner-list" id="tm-recent-learners" style="padding: 0 0.75rem"></div>' +
      '<button type="button" class="tm-link-block" id="tm-view-all-learners-2">View all learners</button>' +
      '</div>' +
      '<div id="tm-view-workspace" class="tm-view tm-view-workspace"></div>' +
      '</main>' +
      '<nav class="tm-bottom-nav" aria-label="Main navigation" id="tm-bottom-nav"></nav>';

    document.body.insertBefore(shell, document.body.firstChild);

    document.getElementById('tm-back').addEventListener('click', function () {
      if (document.body.classList.contains('tm-mode-workspace')) setMode('home');
      else window.location.href = isLeadership ? '/index.html' : '/classes.html';
    });

    const notifyBtn = document.getElementById('tm-notify');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', function () {
        const desktop = document.getElementById('dash-notify-btn') || document.getElementById('dir-notify-btn');
        if (desktop) desktop.click();
      });
    }

    buildBottomNav();
    buildSectionNav();
    buildQuickActions();
    buildStatsPlaceholders();

    document.getElementById('tm-view-all-learners').addEventListener('click', function () {
      goTab('students');
    });
    document.getElementById('tm-view-all-learners-2').addEventListener('click', function () {
      goTab('students');
    });

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'tm-fab';
    fab.id = 'tm-fab-add';
    fab.setAttribute('aria-label', 'Add new learner');
    fab.textContent = '+';
    fab.hidden = isLeadership;
    fab.addEventListener('click', function () {
      goTab('register');
    });
    document.body.appendChild(fab);
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function buildStatsPlaceholders() {
    const wrap = document.getElementById('tm-stats');
    if (!wrap || wrap.children.length) return;
    if (isLeadership) {
      wrap.innerHTML =
        '<div class="tm-stat-card stat-blue"><div class="tm-stat-icon">👥</div><div class="tm-stat-value" id="tm-stat-1">—</div><div class="tm-stat-label">Learners</div></div>' +
        '<div class="tm-stat-card stat-green"><div class="tm-stat-icon">🧑‍🏫</div><div class="tm-stat-value" id="tm-stat-2">—</div><div class="tm-stat-label">Staff</div></div>' +
        '<div class="tm-stat-card stat-purple"><div class="tm-stat-icon">📚</div><div class="tm-stat-value" id="tm-stat-3">—</div><div class="tm-stat-label">Classes</div></div>';
      return;
    }
    wrap.innerHTML =
      '<div class="tm-stat-card stat-blue"><div class="tm-stat-icon">👥</div><div class="tm-stat-value" id="tm-stat-students">—</div><div class="tm-stat-label">Students</div></div>' +
      '<div class="tm-stat-card stat-green"><div class="tm-stat-icon">📄</div><div class="tm-stat-value" id="tm-stat-docs">—</div><div class="tm-stat-label">Notes &amp; schemes</div></div>' +
      '<div class="tm-stat-card stat-purple"><div class="tm-stat-icon">📖</div><div class="tm-stat-value" id="tm-stat-subjects">—</div><div class="tm-stat-label">Subjects</div></div>';
  }

  function buildQuickActions() {
    const grid = document.getElementById('tm-quick-grid');
    if (!grid || grid.dataset.built) return;
    grid.dataset.built = '1';
    const items = document.body.classList.contains('app-head')
      ? [
          { tab: 'overview', label: 'Overview', cls: 'qa-blue', icon: '🏫' },
          { tab: 'head-comments', label: 'Head comments', cls: 'qa-green', icon: '💬' },
          { tab: 'comment-review', label: 'Comment review', cls: 'qa-purple', icon: '📋' },
          { tab: 'messages', label: 'Messages', cls: 'qa-blue', icon: '✉' },
          { tab: 'staff', label: 'Staff & accounts', cls: 'qa-red', icon: '🧑‍🏫' },
          { tab: 'settings', label: 'Settings', cls: 'qa-gray', icon: '⚙' },
        ]
      : isLeadership
      ? [
          { tab: 'overview', label: 'School overview', cls: 'qa-blue', icon: '🏫' },
          { tab: 'messages', label: 'Staff messages', cls: 'qa-green', icon: '💬' },
          { tab: 'learners', label: 'Learners & classes', cls: 'qa-purple', icon: '👥' },
          { tab: 'reports', label: 'Reports & export', cls: 'qa-orange', icon: '📊' },
          { tab: 'staff', label: 'Staff & accounts', cls: 'qa-red', icon: '🧑‍🏫' },
          { tab: 'settings', label: 'Settings', cls: 'qa-gray', icon: '⚙' },
        ]
      : [
          { tab: 'register', label: 'Register learner', cls: 'qa-blue', icon: '➕' },
          { tab: 'notes', label: 'Notes & Schemes', cls: 'qa-green', icon: '📄' },
          { tab: 'subjects', label: 'Subjects', cls: 'qa-purple', icon: '📖' },
          { tab: 'weekly', label: 'Weekly progress', cls: 'qa-orange', icon: '📈' },
          { tab: 'comments', label: 'Comments', cls: 'qa-purple', icon: '💬' },
          { tab: 'messages', label: 'Staff messages', cls: 'qa-blue', icon: '✉' },
          { tab: 'reports', label: 'Reports', cls: 'qa-red', icon: '📋' },
          { tab: 'settings', label: 'Settings', cls: 'qa-gray', icon: '⚙' },
        ];
    items.forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-quick-btn ' + it.cls;
      b.innerHTML = '<span class="tm-qicon">' + it.icon + '</span><span>' + escapeHtml(it.label) + '</span>';
      b.addEventListener('click', function () {
        goTab(it.tab);
      });
      grid.appendChild(b);
    });
  }

  function buildSectionNav() {
    if (isLeadership) return;
    const nav = document.getElementById('tm-section-nav');
    if (!nav || nav.dataset.built) return;
    nav.dataset.built = '1';
    const commentsTab = document.querySelector('.tab[data-tab="comments"]');
    const commentsLabel = commentsTab ? commentsTab.textContent.trim() : 'Comments';
    const tabs = [
      { tab: 'register', label: 'Register', icon: '➕' },
      { tab: 'notes', label: 'Notes', icon: '📄' },
      { tab: 'students', label: 'Roster', icon: '👥' },
      { tab: 'subjects', label: 'Subjects', icon: '📖' },
      { tab: 'weekly', label: 'Weekly', icon: '📈' },
      { tab: 'comments', label: commentsLabel, icon: '💬' },
      { tab: 'reports', label: 'Reports', icon: '📋' },
      { tab: 'export', label: 'Export', icon: '⬇' },
      { tab: 'settings', label: 'Settings', icon: '⚙' },
    ];
    tabs.forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-section-chip';
      b.dataset.tmSection = it.tab;
      b.innerHTML = '<span aria-hidden="true">' + it.icon + '</span> ' + escapeHtml(it.label);
      b.addEventListener('click', function () {
        goTab(it.tab);
      });
      nav.appendChild(b);
    });
  }

  function highlightSectionNav(tab) {
    const nav = document.getElementById('tm-section-nav');
    if (!nav) return;
    nav.querySelectorAll('.tm-section-chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.tmSection === tab);
    });
  }

  function buildBottomNav() {
    const nav = document.getElementById('tm-bottom-nav');
    if (!nav || nav.dataset.built) return;
    nav.dataset.built = '1';
    const items = isLeadership
      ? [
          { id: 'home', label: 'Home', icon: '🏠' },
          { id: 'messages', label: 'Messages', icon: '💬' },
          { id: 'more', label: 'More', icon: '⋯', more: true },
        ]
      : [
          { id: 'home', label: 'Home', icon: '🏠' },
          { id: 'register', label: 'Register', icon: '➕' },
          { id: 'notes', label: 'Notes', icon: '📄' },
          { id: 'reports', label: 'Reports', icon: '📋' },
          { id: 'more', label: 'More', icon: '⋯', more: true },
        ];
    items.forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-nav-item' + (it.more ? ' tm-nav-more' : '');
      b.dataset.tmNav = it.id;
      b.innerHTML = '<span aria-hidden="true">' + it.icon + '</span><span>' + escapeHtml(it.label) + '</span>';
      b.addEventListener('click', function () {
        if (it.more) openMoreSheet();
        else if (it.id === 'home') setMode('home');
        else goTab(it.id);
      });
      nav.appendChild(b);
    });
  }

  function openMoreSheet() {
    let sheet = document.getElementById('tm-more-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'tm-more-sheet';
      sheet.className = 'tm-more-sheet';
      sheet.hidden = true;
      sheet.innerHTML = '<div class="tm-more-sheet-panel" role="menu" id="tm-more-panel"></div>';
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) sheet.hidden = true;
      });
      document.body.appendChild(sheet);
    }
    const panel = document.getElementById('tm-more-panel');
    panel.innerHTML = '';
    const moreTabs = document.body.classList.contains('app-head')
      ? [
          { tab: 'overview', label: 'Overview' },
          { tab: 'head-comments', label: 'Head comments' },
          { tab: 'comment-review', label: 'Comment review' },
          { tab: 'messages', label: 'Messages' },
          { tab: 'staff', label: 'Staff & accounts' },
          { tab: 'settings', label: 'Settings' },
        ]
      : isLeadership
      ? [
          { tab: 'overview', label: 'School overview' },
          { tab: 'learners', label: 'Learners & classes' },
          { tab: 'staff', label: 'Staff & accounts' },
          { tab: 'classes', label: 'Class dashboards' },
          { tab: 'reports', label: 'Reports & export' },
          { tab: 'head', label: 'Head & comments' },
          { tab: 'skills', label: 'Skills' },
          { tab: 'notes', label: 'Notes & tools' },
          { tab: 'settings', label: 'Settings' },
        ]
      : [
          { tab: 'students', label: 'Roster (all students)' },
          { tab: 'subjects', label: 'Subjects' },
          { tab: 'weekly', label: 'Weekly progress' },
          { tab: 'comments', label: 'Comments & marks' },
          { tab: 'messages', label: 'Staff messages' },
          { tab: 'export', label: 'Comment export' },
          { tab: 'settings', label: 'Settings' },
        ];
    moreTabs.forEach(function (it) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tm-more-item';
      btn.textContent = it.label;
      btn.addEventListener('click', function () {
        sheet.hidden = true;
        goTab(it.tab);
      });
      panel.appendChild(btn);
    });
    sheet.hidden = false;
  }

  function setMode(mode) {
    const home = document.getElementById('tm-view-home');
    const workspace = document.getElementById('tm-view-workspace');
    document.body.classList.toggle('tm-mode-home', mode === 'home');
    document.body.classList.toggle('tm-mode-workspace', mode === 'workspace');
    if (mode === 'home') syncHomeStats();
    if (home) home.classList.toggle('active', mode === 'home');
    if (workspace) workspace.classList.toggle('active', mode === 'workspace');
    document.querySelectorAll('.tm-nav-item').forEach(function (n) {
      const id = n.dataset.tmNav;
      n.classList.toggle('active', mode === 'home' ? id === 'home' : false);
    });
    const fab = document.getElementById('tm-fab-add');
    if (fab) fab.style.display = mode === 'home' && isClassDash ? '' : 'none';
    const secNav = document.getElementById('tm-section-nav');
    if (secNav) secNav.hidden = mode !== 'workspace' || isLeadership;
  }

  function goTab(tab) {
    setMode('workspace');
    document.querySelectorAll('.tm-nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.tmNav === tab);
    });
    if (window.__oceanHead && typeof window.__oceanHead.switchToTab === 'function') {
      window.__oceanHead.switchToTab(tab);
      updateWorkspaceSub(tab);
      if (tab === 'messages') enhanceMessagesMobile();
      return;
    }
    if (window.__oceanDirector && typeof window.__oceanDirector.switchToTab === 'function') {
      window.__oceanDirector.switchToTab(tab);
      updateWorkspaceSub(tab);
      if (tab === 'messages') enhanceMessagesMobile();
      return;
    }
    const ctx = dashCtx();
    if (ctx && typeof ctx.switchToTab === 'function') {
      ctx.switchToTab(tab);
      updateWorkspaceSub(tab);
      if (tab === 'comments') enhanceCommentsMobile();
      if (tab === 'messages') enhanceMessagesMobile();
      return;
    }
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    const panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
    if (tab === 'comments' && window.__oceanCommentsInit) window.__oceanCommentsInit();
    if (tab === 'reports' && window.__oceanReportsInit) window.__oceanReportsInit();
    if (tab === 'messages' && window.__oceanLeaderMessagesInit) window.__oceanLeaderMessagesInit();
    if (tab === 'settings' && window.OceanSettings) {
      window.OceanSettings.syncProfileBar();
      window.OceanSettings.applyTipsVisibility();
    }
    updateWorkspaceSub(tab);
    if (tab === 'comments') enhanceCommentsMobile();
    if (tab === 'messages') enhanceMessagesMobile();
  }

  function updateWorkspaceSub(tab) {
    highlightSectionNav(tab);
    const sub = document.getElementById('tm-header-sub');
    if (!sub) return;
    const labels = {
      register: 'Register learner',
      notes: 'Notes & schemes',
      students: 'Roster',
      subjects: 'Subjects',
      weekly: 'Weekly progress',
      comments: 'Comments',
      messages: 'Staff messages',
      reports: 'Reports',
      export: 'Export',
      settings: 'Settings',
      overview: 'School overview',
      learners: 'Learners & classes',
      staff: 'Staff & accounts',
      classes: 'Class dashboards',
      head: 'Head & comments',
      'head-comments': 'Head comments',
      'comment-review': 'Comment review',
      skills: 'Skills',
      notes: 'Notes & tools',
    };
    sub.textContent = labels[tab] || 'Teacher Dashboard';
  }

  function syncHeader() {
    const sub = document.getElementById('tm-header-sub');
    const heroTitle = document.getElementById('tm-hero-title');
    const heroKicker = document.getElementById('tm-hero-kicker');
    const heroSub = document.getElementById('tm-hero-sub');
    const wTitle = document.getElementById('dash-welcome-title');
    const wSub = document.getElementById('dash-welcome-sub');
    const title = classTitle();
    if (heroTitle) heroTitle.textContent = title;
    if (sub && !document.body.classList.contains('tm-mode-workspace')) {
      sub.textContent = document.body.classList.contains('app-head')
        ? 'Head teacher'
        : isLeadership
        ? 'Director'
        : 'Teacher';
    }
    if (heroKicker && wTitle) heroKicker.textContent = wTitle.textContent || 'WELCOME';
    if (heroSub && wSub) heroSub.textContent = wSub.textContent || '';
    const profileName = document.getElementById('profile-bar-name');
    if (heroKicker && profileName && !wTitle) {
      const who = (profileName.textContent || 'Teacher').toUpperCase();
      heroKicker.textContent = 'WELCOME, ' + who;
    }
  }

  function syncHomeStats() {
    if (isClassDash) {
      const s = document.getElementById('stat-students');
      const d = document.getElementById('stat-docs');
      const sub = document.getElementById('stat-subjects');
      const ts = document.getElementById('tm-stat-students');
      const td = document.getElementById('tm-stat-docs');
      const tsub = document.getElementById('tm-stat-subjects');
      if (ts && s) ts.textContent = s.textContent;
      if (td && d) td.textContent = d.textContent;
      if (tsub && sub) tsub.textContent = sub.textContent;
      return;
    }
    if (document.body.classList.contains('app-director')) {
      const pairs = [
        ['dir-stat-learners', 'tm-stat-1'],
        ['dir-stat-teachers', 'tm-stat-2'],
        ['dir-stat-classes', 'tm-stat-3'],
      ];
      pairs.forEach(function (pair) {
        const src = document.getElementById(pair[0]);
        const dst = document.getElementById(pair[1]);
        if (src && dst) dst.textContent = src.textContent;
      });
      return;
    }
    const pairs = [
      ['stat-head-learners', 'tm-stat-1'],
      ['stat-head-groups', 'tm-stat-2'],
      ['stat-head-comments-done', 'tm-stat-3'],
    ];
    pairs.forEach(function (pair) {
      const src = document.getElementById(pair[0]);
      const dst = document.getElementById(pair[1]);
      if (src && dst) dst.textContent = src.textContent;
    });
  }

  function renderRecentLearners() {
    const list = document.getElementById('tm-recent-learners');
    if (!list) return;
    const rows = window.__oceanDashboardLearners || [];
    const recent = rows.slice(0, 3);
    if (!recent.length) {
      list.innerHTML = '<p style="padding:0.5rem 0.75rem;color:var(--tm-muted);font-size:0.85rem">No learners registered yet.</p>';
      return;
    }
    list.innerHTML = '';
    recent.forEach(function (r) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tm-learner-row';
      const img = r.passport_path
        ? '<img class="tm-learner-avatar" src="' + escapeHtml(r.passport_path) + '" alt="" />'
        : '<span class="tm-learner-avatar" style="display:inline-block"></span>';
      const added = r.created_at
        ? 'Added ' +
          new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      btn.innerHTML =
        img +
        '<div class="tm-learner-meta"><div class="tm-learner-name">' +
        escapeHtml(r.full_name) +
        '</div><div class="tm-learner-sub">Reg. ' +
        escapeHtml(r.reg_no || '—') +
        '</div><div class="tm-learner-sub">' +
        escapeHtml(added) +
        '</div></div><span class="tm-learner-chevron" aria-hidden="true">›</span>';
      btn.addEventListener('click', function () {
        goTab('comments');
      });
      list.appendChild(btn);
    });
  }

  function enhanceCommentsMobile() {
    const panel = document.getElementById('panel-comments');
    if (!panel) return;
    panel.classList.add('panel-comments-mobile');
    const pl = document.getElementById('cc-period-label');
    if (pl && !pl.classList.contains('tm-period-banner')) {
      pl.classList.add('tm-period-banner');
    }
    syncMobileSubjectHeading();
  }

  function syncMobileSubjectHeading() {
    const h = document.getElementById('cc-subject-heading');
    const sel = document.getElementById('cc-subject');
    if (!h || !sel) return;
    const sub = sel.value || 'Subject';
    const ctx = dashCtx();
    const marks =
      ctx && ctx.isPrimary && window.__oceanCommentsIsMarksSubject && window.__oceanCommentsIsMarksSubject();
    h.textContent = marks ? 'Marks — ' + sub : "Subject teacher's comment — " + sub;
  }

  function enhanceMessagesMobile() {
    const panel = document.getElementById('panel-messages');
    if (!panel) return;
    panel.classList.add('panel-messages-mobile');
    const h3 = panel.querySelector('h3');
    if (h3) h3.textContent = 'Private messages';
    const intro = panel.querySelector(':scope > p');
    if (intro) intro.style.display = 'none';
  }

  window.__oceanTeacherMobile = {
    goTab: goTab,
    setMode: setMode,
    syncHomeStats: syncHomeStats,
    renderRecentLearners: renderRecentLearners,
    syncMobileSubjectHeading: syncMobileSubjectHeading,
  };

  if (typeof MQ.addEventListener === 'function') {
    MQ.addEventListener('change', onMq);
  } else if (typeof MQ.addListener === 'function') {
    MQ.addListener(onMq);
  }

  document.addEventListener('DOMContentLoaded', function () {
    onMq();
    window.addEventListener('ocean-profile-updated', syncHeader);
    window.addEventListener('ocean-learners-updated', renderRecentLearners);
    const subj = document.getElementById('cc-subject');
    if (subj) {
      subj.addEventListener('change', syncMobileSubjectHeading);
    }
  });

  if (document.readyState !== 'loading') onMq();
})();
