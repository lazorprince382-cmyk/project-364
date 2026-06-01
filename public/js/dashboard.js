(function () {
  const TOKEN_KEY = 'ocean_staff_token';
  const STAFF_KEY = 'ocean_staff_profile';
  const auth = window.OceanStaffAuth;
  const params = new URLSearchParams(window.location.search);
  const rawClassLevel = params.get('class');
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
  const classLevel = normalizeClassLevelSlug(rawClassLevel);
  const stream = params.get('stream') || '';

  const titles = {
    daycare: 'Day Care',
    baby: 'Baby Class',
    middle: 'Middle Class',
    top: 'Top Class',
    primary1: 'Primary One',
    primary2: 'Primary Two',
  };
  const defaultStreamLabels = {
    waves: 'Waves',
    pearls: 'Pearls',
    dolphins: 'Dolphins',
    whales: 'Whales',
  };
  const streamLabels = Object.assign({}, defaultStreamLabels, readCustomStreamLabels());

  function isPrimaryLike(cl) {
    return String(cl || '').toLowerCase().indexOf('primary') === 0;
  }

  if (!classLevel || (!titles[classLevel] && !isPrimaryLike(classLevel))) {
    window.location.href = '/classes.html';
    return;
  }

  const needsStream = classLevel === 'baby' || classLevel === 'middle';
  if (needsStream && !stream) {
    window.location.href = '/classes.html';
    return;
  }

  if (auth) {
    if (
      !auth.validateSessionFreshness({
        loginViaClasses: true,
        classesKind: 'class',
        loginPath: '/login-class.html',
      })
    ) {
      return;
    }
    const staff = auth.getStoredStaff();
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token || !staff) {
      const next = window.location.pathname + window.location.search;
      window.location.href =
        '/classes.html?signin=class&next=' + encodeURIComponent(next);
      return;
    }
    if (['class_teacher', 'head_teacher', 'director', 'ghost'].indexOf(staff.role) < 0) {
      window.location.href =
        '/classes.html?signin=class&next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    if (!auth.assertClassScope(staff, classLevel, stream)) return;
    if ((staff.role === 'director' || staff.role === 'head_teacher') && staff.role !== 'ghost') {
      if (!auth.consumeClassWorkspaceEntry()) {
        const next = window.location.pathname + window.location.search;
        window.location.href = auth.classWorkspaceSignInHref(next, 'class');
        return;
      }
      document.querySelectorAll('[data-tab="messages"]').forEach(function (el) {
        el.style.display = 'none';
      });
      const msgPanel = document.getElementById('panel-messages');
      if (msgPanel) msgPanel.remove();
    }
    auth.startIdleWatch({
      loginViaClasses: true,
      classesKind: 'class',
      loginPath: '/login-class.html',
    });
    if (window.OceanSettings && typeof window.OceanSettings.refreshStaffProfileFromServer === 'function') {
      window.OceanSettings.refreshStaffProfileFromServer().then(function () {
        if (window.OceanSettings.syncProfileBar) window.OceanSettings.syncProfileBar();
        if (window.OceanWelcomeBanner) {
          window.OceanWelcomeBanner.refreshName();
          window.OceanWelcomeBanner.updateContext(displayTitle + streamPart);
        }
      });
    }
  }

  const isPrimary = isPrimaryLike(classLevel);

  function syncCommentsTabLabel() {
    const label = isPrimary ? 'Marks/Comments' : 'Comments';
    document.querySelectorAll('.tab[data-tab="comments"]').forEach(function (tab) {
      tab.textContent = label;
    });
  }

  syncCommentsTabLabel();

  function readCustomStreamLabels() {
    try {
      const raw = localStorage.getItem('ocean_stream_labels') || '{}';
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (_) {
      return {};
    }
  }

  const displayTitle = titles[classLevel] || classLevel.replace(/^primary/i, 'Primary ');
  let streamPart = stream ? ' · ' + (streamLabels[stream] || stream) : '';
  document.getElementById('dash-title').textContent = displayTitle + streamPart;
  document.getElementById('dash-sub').textContent =
    'Register learners, upload term schemes and work, and manage the class list.';

  document.getElementById('field-class').value = classLevel;
  document.getElementById('field-stream').value = stream;
  document.getElementById('class_display').value = displayTitle + (stream ? ' — ' + (streamLabels[stream] || stream) : '');
  const topbarEl = document.getElementById('dash-topbar-class');
  if (topbarEl) topbarEl.textContent = displayTitle + streamPart;
  const learnersTitleEl = document.getElementById('learners-table-title');
  if (learnersTitleEl) learnersTitleEl.textContent = displayTitle + streamPart;

  function applyStreamLabelsUpdate() {
    const nextMap = Object.assign({}, defaultStreamLabels, readCustomStreamLabels());
    Object.keys(streamLabels).forEach(function (k) {
      delete streamLabels[k];
    });
    Object.keys(nextMap).forEach(function (k) {
      streamLabels[k] = nextMap[k];
    });
    streamPart = stream ? ' · ' + (streamLabels[stream] || stream) : '';
    const dashTitleEl = document.getElementById('dash-title');
    if (dashTitleEl) dashTitleEl.textContent = displayTitle + streamPart;
    document.getElementById('class_display').value =
      displayTitle + (stream ? ' — ' + (streamLabels[stream] || stream) : '');
    if (topbarEl) topbarEl.textContent = displayTitle + streamPart;
    if (learnersTitleEl) learnersTitleEl.textContent = displayTitle + streamPart;
    if (window.OceanWelcomeBanner) {
      window.OceanWelcomeBanner.updateContext(displayTitle + streamPart);
    }
    if (window.__oceanDashboard) {
      window.__oceanDashboard.streamPart = streamPart;
      window.__oceanDashboard.streamLabels = streamLabels;
    }
  }

  window.addEventListener('ocean-stream-labels-updated', applyStreamLabelsUpdate);

  if (window.OceanWelcomeBanner) {
    window.OceanWelcomeBanner.updateContext(displayTitle + streamPart);
  }

  window.addEventListener('ocean-profile-updated', function () {
    if (window.OceanWelcomeBanner) {
      window.OceanWelcomeBanner.refreshName();
      window.OceanWelcomeBanner.updateContext(displayTitle + streamPart);
    }
    if (window.OceanSettings) window.OceanSettings.syncProfileBar();
  });

  const subjects =
    (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS[classLevel]) ||
    (isPrimary ? (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS.primary2) || [] : []);
  const skillOnlySubjects = window.OCEAN_SKILL_SUBJECTS || [];
  const noteSubject = document.getElementById('note-subject');
  subjects.forEach(function (s) {
    if (skillOnlySubjects.indexOf(s) !== -1) return;
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    noteSubject.appendChild(o);
  });

  const subjectsGrid = document.getElementById('subjects-grid');
  subjects.forEach(function (s) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'subject-pill';
    d.setAttribute('aria-label', 'Open ' + s);
    d.textContent = s;
    d.addEventListener('click', function () {
      const u = new URL('/subject.html', window.location.origin);
      u.searchParams.set('class', classLevel);
      if (stream) u.searchParams.set('stream', stream);
      u.searchParams.set('subject', s);
      window.location.href = u.toString();
    });
    subjectsGrid.appendChild(d);
  });

  function flash(msg, ok) {
    const el = document.getElementById('flash');
    el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + msg + '</div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 5000);
  }

  function apiStudentsUrl() {
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    return u.toString();
  }

  function apiDocsUrl() {
    const u = new URL('/api/documents', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    const ft = document.getElementById('filter-term').value;
    if (ft) u.searchParams.set('term', ft);
    return u.toString();
  }

  async function loadStudents() {
    const res = await fetch(apiStudentsUrl());
    if (!res.ok) throw new Error('Could not load students');
    return res.json();
  }

  const LEARNERS_PAGE_SIZE = 10;
  let learnersPage = 1;
  let learnersFilter = '';
  let learnersRows = [];

  const ICON_VIEW =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EDIT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DEL =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  function formatStudentDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return '—';
    }
  }

  function filterLearnerRows(rows) {
    const q = learnersFilter.trim().toLowerCase();
    if (!q) return rows.slice();
    return rows.filter(function (r) {
      return (
        String(r.full_name || '')
          .toLowerCase()
          .indexOf(q) !== -1 || String(r.reg_no || '').toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function renderPagerInto(pagerEl, totalItems, page, pageSize) {
    if (!pagerEl) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    learnersPage = page;
    const start = (learnersPage - 1) * pageSize;
    const parts = [];
    parts.push(
      '<span style="margin-right:0.5rem;color:var(--muted)">' +
        (totalItems ? start + 1 + '–' + Math.min(start + pageSize, totalItems) + ' of ' + totalItems : '0') +
        '</span>'
    );
    parts.push(
      '<button type="button" data-goto="prev"' +
        (learnersPage <= 1 ? ' disabled' : '') +
        '>Prev</button>'
    );
    parts.push(
      '<span style="padding:0 0.35rem;color:var(--muted);font-size:0.82rem">Page ' +
        learnersPage +
        ' / ' +
        totalPages +
        '</span>'
    );
    parts.push(
      '<button type="button" data-goto="next"' +
        (learnersPage >= totalPages ? ' disabled' : '') +
        '>Next</button>'
    );
    pagerEl.innerHTML = parts.join('');
  }

  function rowActionsHtml(id) {
    return (
      '<button type="button" class="dash-icon-btn btn-view" data-id="' +
      id +
      '" title="View" aria-label="View">' +
      ICON_VIEW +
      '</button><button type="button" class="dash-icon-btn btn-edit" data-id="' +
      id +
      '" title="Edit" aria-label="Edit">' +
      ICON_EDIT +
      '</button><button type="button" class="dash-icon-btn danger btn-del" data-id="' +
      id +
      '" title="Delete" aria-label="Delete">' +
      ICON_DEL +
      '</button>'
    );
  }

  function bindLearnerRowButtons(tbody) {
    if (!tbody) return;
    tbody.querySelectorAll('.btn-view').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openView(Number(btn.getAttribute('data-id')));
      });
    });
    tbody.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEdit(Number(btn.getAttribute('data-id')));
      });
    });
    tbody.querySelectorAll('.btn-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        delStudent(Number(btn.getAttribute('data-id')));
      });
    });
  }

  function renderStudentTables() {
    const tbodyReg = document.getElementById('students-body');
    const tbodyAll = document.getElementById('students-body-all');
    const pagerReg = document.getElementById('learners-pager');
    const pagerAll = document.getElementById('learners-pager-all');
    const filtered = filterLearnerRows(learnersRows);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / LEARNERS_PAGE_SIZE));
    if (learnersPage > totalPages) learnersPage = totalPages;
    if (learnersPage < 1) learnersPage = 1;
    const start = (learnersPage - 1) * LEARNERS_PAGE_SIZE;
    const slice = filtered.slice(start, start + LEARNERS_PAGE_SIZE);

    function fillTbody(tbody, includeClass) {
      if (!tbody) return;
      tbody.innerHTML = '';
      const colSpan = includeClass ? 7 : 6;
      if (!learnersRows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td colspan="' + colSpan + '">No learners yet — register on the left.</td>';
        tbody.appendChild(tr);
        return;
      }
      if (!slice.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="' + colSpan + '">No matches for this search.</td>';
        tbody.appendChild(tr);
        return;
      }
      slice.forEach(function (r, i) {
        const idx = start + i + 1;
        const tr = document.createElement('tr');
        const img = r.passport_path
          ? '<img class="thumb" src="' + String(r.passport_path).replace(/"/g, '') + '" alt="" />'
          : '<span class="badge">—</span>';
        const classStr = displayTitle + (r.stream ? ' · ' + (streamLabels[r.stream] || r.stream) : '');
        const dateStr = formatStudentDate(r.created_at);
        let html =
          '<td>' +
          idx +
          '</td><td>' +
          escapeHtml(r.full_name) +
          '</td><td>' +
          escapeHtml(r.reg_no) +
          '</td><td>' +
          img +
          '</td>';
        if (includeClass) html += '<td>' + escapeHtml(classStr) + '</td>';
        html += '<td>' + escapeHtml(dateStr) + '</td><td>' + rowActionsHtml(r.id) + '</td>';
        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
      bindLearnerRowButtons(tbody);
    }

    fillTbody(tbodyReg, false);
    fillTbody(tbodyAll, true);
    renderPagerInto(pagerReg, total, learnersPage, LEARNERS_PAGE_SIZE);
    renderPagerInto(pagerAll, total, learnersPage, LEARNERS_PAGE_SIZE);
  }

  async function refreshStudentsTable() {
    const tbodyReg = document.getElementById('students-body');
    try {
      learnersRows = await loadStudents();
      studentsCache = learnersRows.slice();
      learnersPage = 1;
      renderStudentTables();
    } catch (e) {
      learnersRows = [];
      const errRow =
        '<tr><td colspan="6">Database unavailable. Set DATABASE_URL and run npm run db:init</td></tr>';
      const errRowAll =
        '<tr><td colspan="7">Database unavailable. Set DATABASE_URL and run npm run db:init</td></tr>';
      if (tbodyReg) tbodyReg.innerHTML = errRow;
      const tbodyAllErr = document.getElementById('students-body-all');
      if (tbodyAllErr) tbodyAllErr.innerHTML = errRowAll;
    }
    refreshDashboardStats();
    window.__oceanDashboardLearners = learnersRows.slice();
    window.dispatchEvent(new CustomEvent('ocean-learners-updated'));
  }

  const activityKey = 'ocean_dash_activity_' + classLevel + '_' + (stream || '_');
  function pushActivity(message) {
    let list = [];
    try {
      list = JSON.parse(sessionStorage.getItem(activityKey) || '[]');
    } catch (_) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    list.unshift({ t: Date.now(), m: message });
    list = list.slice(0, 25);
    sessionStorage.setItem(activityKey, JSON.stringify(list));
    renderActivity();
  }

  function renderActivity() {
    const ul = document.getElementById('dash-activity-list');
    if (!ul) return;
    let list = [];
    try {
      list = JSON.parse(sessionStorage.getItem(activityKey) || '[]');
    } catch (_) {
      list = [];
    }
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li style="border:none;color:var(--muted)">Activity from this browser session appears here.</li>';
      return;
    }
    list.forEach(function (item) {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.dateTime = new Date(item.t).toISOString();
      time.textContent = new Date(item.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const span = document.createElement('span');
      span.textContent = item.m;
      li.appendChild(time);
      li.appendChild(span);
      ul.appendChild(li);
    });
  }

  const notifKey = 'ocean_dash_notify_' + classLevel + '_' + (stream || '_');
  function loadNotifs() {
    try {
      return JSON.parse(sessionStorage.getItem(notifKey) || '[]');
    } catch (_) {
      return [];
    }
  }
  function saveNotifs(arr) {
    sessionStorage.setItem(notifKey, JSON.stringify(arr.slice(0, 30)));
    updateNotifUi();
  }
  function addNotification(text) {
    const arr = loadNotifs();
    arr.unshift({ id: String(Date.now()), text: text, t: Date.now(), read: false });
    saveNotifs(arr);
  }
  function updateNotifUi() {
    const arr = loadNotifs();
    const unread = arr.filter(function (n) {
      return !n.read;
    }).length;
    const badge = document.getElementById('dash-notify-badge');
    const dd = document.getElementById('dash-notify-dropdown');
    if (badge) {
      badge.hidden = unread === 0;
      badge.textContent = unread > 9 ? '9+' : String(unread);
    }
    if (!dd) return;
    if (!arr.length) {
      dd.innerHTML = '<div class="dash-dropdown-empty">No notifications yet.</div>';
      return;
    }
    let html = '';
    arr.slice(0, 12).forEach(function (n) {
      html +=
        '<div class="dash-dropdown-item' +
        (n.read ? '' : ' dash-notif-unread') +
        '">' +
        escapeHtml(n.text) +
        '<time>' +
        new Date(n.t).toLocaleString() +
        '</time></div>';
    });
    html +=
      '<div class="dash-dropdown-actions"><button type="button" class="btn" id="dash-notify-clear" style="width:100%">Mark all read</button></div>';
    dd.innerHTML = html;
    const clr = document.getElementById('dash-notify-clear');
    if (clr)
      clr.addEventListener('click', function () {
        const next = loadNotifs().map(function (n) {
          return Object.assign({}, n, { read: true });
        });
        saveNotifs(next);
      });
  }

  async function refreshDashboardStats() {
    const elS = document.getElementById('stat-students');
    const elD = document.getElementById('stat-docs');
    const elSub = document.getElementById('stat-subjects');
    if (elS) elS.textContent = String(learnersRows.length);
    const teachSubjects = subjects.filter(function (s) {
      return skillOnlySubjects.indexOf(s) === -1;
    });
    if (elSub) elSub.textContent = String(teachSubjects.length);
    try {
      const u = new URL('/api/documents', window.location.origin);
      u.searchParams.set('classLevel', classLevel);
      if (stream) u.searchParams.set('stream', stream);
      const res = await fetch(u);
      const docs = res.ok ? await res.json() : [];
      if (elD) elD.textContent = String(Array.isArray(docs) ? docs.filter(function (d) { return d.doc_type !== 'note'; }).length : 0);
    } catch (_) {
      if (elD) elD.textContent = '—';
    }
  }

  function weeklyBandsUrl(subject, term, week, studentId) {
    const u = new URL('/api/weekly-bands', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    u.searchParams.set('subject', subject);
    u.searchParams.set('term', String(term));
    if (week != null) u.searchParams.set('week', String(week));
    if (studentId != null) u.searchParams.set('student_id', String(studentId));
    return u.toString();
  }

  const WEEKLY_TREND_COLORS = [
    'rgba(20,184,166,0.85)',
    'rgba(59,130,246,0.85)',
    'rgba(234,179,8,0.85)',
    'rgba(249,115,22,0.85)',
    'rgba(239,68,68,0.85)',
  ];

  const LEGACY_RATING_OPTIONS = [
    { value: 'strong', label: 'Strong' },
    { value: 'average', label: 'Average' },
    { value: 'weak', label: 'Weak' },
  ];

  function getEffectiveRatingOptions(rawOptions) {
    const custom = parseRatingOptionsText(Array.isArray(rawOptions) ? rawOptions.join('\n') : rawOptions);
    if (custom.length >= 2) {
      return {
        custom: true,
        options: custom.map(function (label) {
          return { value: label, label: label };
        }),
      };
    }
    return { custom: false, options: LEGACY_RATING_OPTIONS.slice() };
  }

  function parseRatingOptionsText(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean)
      .slice(0, 8);
  }

  function suggestRatingOptionsFromGoal(goalText) {
    if (window.OceanWeeklyGoalRatings && window.OceanWeeklyGoalRatings.suggestRatingOptionsFromGoal) {
      return window.OceanWeeklyGoalRatings.suggestRatingOptionsFromGoal(goalText);
    }
    return [];
  }

  function weeklyGoalUrl(subject, term, week) {
    const u = new URL('/api/class-weekly-goal', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    u.searchParams.set('subject', subject);
    u.searchParams.set('term', String(term));
    u.searchParams.set('week', String(week));
    return u.toString();
  }

  function weeklyGoalsUrl(subject, term) {
    const u = new URL('/api/class-weekly-goals', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    u.searchParams.set('subject', subject);
    u.searchParams.set('term', String(term));
    return u.toString();
  }

  function termGoalUrl(subject, term) {
    const u = new URL('/api/class-term-goal', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    u.searchParams.set('subject', subject);
    u.searchParams.set('term', String(term));
    return u.toString();
  }

  function ratingColorForLabel(label, optionsByWeek, weekNo) {
    if (!label || label === 'unset') return 'rgba(100,116,139,0.35)';
    if (label === 'strong') return 'rgba(20,184,166,0.85)';
    if (label === 'average') return 'rgba(234,179,8,0.85)';
    if (label === 'weak') return 'rgba(239,68,68,0.85)';
    const opts = (optionsByWeek && optionsByWeek[weekNo]) || [];
    const idx = opts.indexOf(label);
    if (idx >= 0) return WEEKLY_TREND_COLORS[Math.min(idx, WEEKLY_TREND_COLORS.length - 1)];
    return 'rgba(148,163,184,0.55)';
  }

  function trendBarsHtml(byWeek, optionsByWeek) {
    const cells = [];
    for (let w = 1; w <= 11; w++) {
      const b = byWeek[w] || 'unset';
      const title = b === 'unset' ? 'Not rated' : b;
      cells.push(
        '<span title="Week ' +
          w +
          ': ' +
          escapeHtml(title) +
          '" style="display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid rgba(148,163,184,0.25);margin-right:3px;background:' +
          ratingColorForLabel(b, optionsByWeek, w) +
          ';"></span>'
      );
    }
    return cells.join('');
  }

  let wkGoalsContextKey = '';

  function weeklyGoalsApiError(res, fallback) {
    if (res && res.status === 404) {
      return 'Goals save is not available yet. Restart or update the server, then try again.';
    }
    return fallback;
  }

  async function loadWeeklyGoalsEditor(subject, term, week, opts) {
    opts = opts || {};
    const contextKey = [subject, term, week].join('|');
    const contextChanged = wkGoalsContextKey !== contextKey;
    wkGoalsContextKey = contextKey;

    const weekLabel = document.getElementById('wk-week-label');
    const termGoalEl = document.getElementById('wk-term-goal');
    const termGoalMeta = document.getElementById('wk-term-goal-meta');
    const weeklyGoalEl = document.getElementById('wk-weekly-goal');
    const ratingOptionsEl = document.getElementById('wk-rating-options');
    const weeklyGoalMeta = document.getElementById('wk-weekly-goal-meta');
    if (weekLabel) weekLabel.textContent = String(week);

    if (termGoalEl && (contextChanged || opts.reloadTermGoal)) {
      try {
        const res = await fetch(termGoalUrl(subject, term));
        const raw = await res.text();
        let data = {};
        try {
          data = JSON.parse(raw);
        } catch (_) {}
        if (res.ok) {
          termGoalEl.value = String(data.goal_text || '');
          if (termGoalMeta) {
            termGoalMeta.textContent = data.updated_at
              ? 'Saved ' + new Date(data.updated_at).toLocaleString()
              : 'Not saved yet';
          }
        } else if (termGoalMeta) {
          termGoalMeta.textContent = weeklyGoalsApiError(res, data.error || 'Could not load term goal.');
        }
      } catch (_) {
        if (termGoalMeta) termGoalMeta.textContent = 'Could not load term goal.';
      }
    }

    if (weeklyGoalEl && ratingOptionsEl && contextChanged) {
      try {
        const res = await fetch(weeklyGoalUrl(subject, term, week));
        const raw = await res.text();
        let data = {};
        try {
          data = JSON.parse(raw);
        } catch (_) {}
        if (res.ok) {
          weeklyGoalEl.value = String(data.goal_text || '');
          const optsList = Array.isArray(data.rating_options) ? data.rating_options : [];
          ratingOptionsEl.value = optsList.join('\n');
          if (weeklyGoalMeta) {
            weeklyGoalMeta.textContent = data.updated_at
              ? 'Saved ' + new Date(data.updated_at).toLocaleString()
              : 'Not saved yet';
          }
        } else if (weeklyGoalMeta) {
          weeklyGoalMeta.textContent = weeklyGoalsApiError(res, data.error || 'Could not load week goal.');
        }
      } catch (_) {
        if (weeklyGoalMeta) weeklyGoalMeta.textContent = 'Could not load week goal.';
      }
    }
  }

  function resolveWeeklyRatingOptions(textareaOptions, savedWeekOptions) {
    const typed = parseRatingOptionsText(textareaOptions);
    if (typed.length >= 2) return typed;
    const saved = Array.isArray(savedWeekOptions) ? savedWeekOptions.filter(Boolean) : [];
    if (saved.length >= 2) return saved;
    return typed;
  }

  async function renderWeeklyLearnerTable(subject, term, week) {
    const bodyEl = document.getElementById('wk-body');
    if (!bodyEl) return;
    if (!learnersRows.length) {
      bodyEl.innerHTML = '<tr><td colspan="4">No learners in this class yet.</td></tr>';
      return;
    }

    const weekRes = await fetch(weeklyBandsUrl(subject, term, week));
    const allRes = await fetch(weeklyBandsUrl(subject, term));
    const goalsRes = await fetch(weeklyGoalsUrl(subject, term));
    const weekRows = weekRes.ok ? await weekRes.json().catch(function () { return []; }) : [];
    const allRows = allRes.ok ? await allRes.json().catch(function () { return []; }) : [];
    const goalsRows = goalsRes.ok ? await goalsRes.json().catch(function () { return []; }) : [];
    const ratingOptionsEl = document.getElementById('wk-rating-options');
    const savedWeekGoal = (Array.isArray(goalsRows) ? goalsRows : []).find(function (g) {
      return Number(g.week_no) === week;
    });
    const currentOptions = resolveWeeklyRatingOptions(
      ratingOptionsEl ? ratingOptionsEl.value : '',
      savedWeekGoal && savedWeekGoal.rating_options
    );
    const optionsByWeek = {};
    (Array.isArray(goalsRows) ? goalsRows : []).forEach(function (g) {
      optionsByWeek[Number(g.week_no)] = Array.isArray(g.rating_options) ? g.rating_options : [];
    });
    if (currentOptions.length >= 2) optionsByWeek[week] = currentOptions;

    const weekMap = new Map((Array.isArray(weekRows) ? weekRows : []).map(function (r) { return [String(r.student_id), r]; }));
    const byStudentWeeks = {};
    (Array.isArray(allRows) ? allRows : []).forEach(function (r) {
      const key = String(r.student_id);
      if (!byStudentWeeks[key]) byStudentWeeks[key] = {};
      byStudentWeeks[key][Number(r.week_no)] = r.band;
    });

    bodyEl.innerHTML = '';
    const ratingPack = getEffectiveRatingOptions(currentOptions);
    const ratingHint = document.getElementById('wk-rating-hint');
    if (ratingHint) {
      ratingHint.textContent = ratingPack.custom
        ? 'Using your rating words for Week ' + week + '.'
        : 'Add at least two rating words above (or save a week goal) to replace Strong / Average / Weak.';
    }

    learnersRows.forEach(function (s) {
      const key = String(s.id);
      const current = weekMap.get(key);
      const currentBand = current ? String(current.band || '') : '';
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = s.full_name;
      const tdReg = document.createElement('td');
      tdReg.textContent = s.reg_no || '—';
      const tdRate = document.createElement('td');
      const sel = document.createElement('select');
      sel.setAttribute('data-sid', String(s.id));
      const unsetOpt = document.createElement('option');
      unsetOpt.value = 'unset';
      unsetOpt.textContent = 'Not rated';
      if (!currentBand) unsetOpt.selected = true;
      sel.appendChild(unsetOpt);
      ratingPack.options.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (currentBand === opt.value) o.selected = true;
        sel.appendChild(o);
      });
      tdRate.appendChild(sel);
      const tdTrend = document.createElement('td');
      tdTrend.innerHTML = trendBarsHtml(byStudentWeeks[key] || {}, optionsByWeek);
      tr.appendChild(tdName);
      tr.appendChild(tdReg);
      tr.appendChild(tdRate);
      tr.appendChild(tdTrend);
      bodyEl.appendChild(tr);
    });

    bodyEl.querySelectorAll('select[data-sid]').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        const payload = {
          student_id: Number(sel.getAttribute('data-sid')),
          subject: subject,
          term: term,
          week_no: week,
          band: sel.value,
        };
        const res = await fetch('/api/weekly-bands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(function () { return {}; });
          flash(j.error || 'Could not save weekly rating.', false);
          return;
        }
        flash('Weekly rating saved.', true);
        renderClassWeeklyInProgressCard();
        renderWeeklyLearnerTable(subject, term, week);
        window.dispatchEvent(
          new CustomEvent('ocean-weekly-bands-updated', {
            detail: { student_id: payload.student_id, subject: payload.subject, term: payload.term },
          })
        );
      });
    });
  }

  async function loadWeeklyPanel() {
    const subEl = document.getElementById('wk-subject');
    const termEl = document.getElementById('wk-term');
    const weekEl = document.getElementById('wk-week');
    const bodyEl = document.getElementById('wk-body');
    if (!subEl || !termEl || !weekEl || !bodyEl) return;
    if (!subEl.options.length) {
      subjects.forEach(function (s) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        subEl.appendChild(o);
      });
    }
    if (!weekEl.options.length) {
      for (let w = 1; w <= 11; w++) {
        const o = document.createElement('option');
        o.value = String(w);
        o.textContent = 'Week ' + w;
        weekEl.appendChild(o);
      }
    }
    if (!learnersRows.length) {
      try {
        learnersRows = await loadStudents();
      } catch (_) {
        learnersRows = [];
      }
    }
    const subject = subEl.value || subjects[0] || '';
    const term = Number(termEl.value || 1);
    const week = Number(weekEl.value || 1);
    await loadWeeklyGoalsEditor(subject, term, week);

    if (!learnersRows.length) {
      bodyEl.innerHTML = '<tr><td colspan="4">No learners in this class yet.</td></tr>';
      return;
    }

    await renderWeeklyLearnerTable(subject, term, week);

    syncWeeklyProgressFilters(subject, week);
    await renderWeeklyProgressCharts(subject, term, week);
  }

  function syncWeeklyProgressFilters(subject, week) {
    const sidebarSub = document.getElementById('class-progress-subject');
    const sidebarWeek = document.getElementById('class-progress-week');
    if (sidebarSub && subject) sidebarSub.value = subject;
    if (sidebarWeek && week) sidebarWeek.value = String(week);
  }

  async function paintWeeklyProgressChart(pieId, legendId, metaId, subject, term, week) {
    const pieEl = document.getElementById(pieId);
    const legendEl = document.getElementById(legendId);
    const metaEl = metaId ? document.getElementById(metaId) : null;
    if (!pieEl || !legendEl) return;
    if (metaEl) metaEl.textContent = subject ? subject + ' · Week ' + week + ' · Term ' + term : 'Select subject';
    if (!learnersRows.length || !subject) {
      pieEl.style.background = 'rgba(100, 116, 139, 0.35)';
      legendEl.innerHTML = '';
      return;
    }
    const total = learnersRows.length;
    const res = await fetch(weeklyBandsUrl(subject, term, week));
    const goalRes = await fetch(weeklyGoalUrl(subject, term, week));
    const rows = res.ok ? await res.json().catch(function () { return []; }) : [];
    const goalData = goalRes.ok ? await goalRes.json().catch(function () { return {}; }) : {};
    const ratingPack = getEffectiveRatingOptions(goalData.rating_options || []);
    const counts = {};
    ratingPack.options.forEach(function (opt) {
      counts[opt.value] = 0;
    });
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      const b = String(r.band || '').trim();
      if (!b) return;
      if (Object.prototype.hasOwnProperty.call(counts, b)) counts[b] += 1;
    });
    const ratedCount = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return String(r.band || '').trim();
    }).length;
    const notRated = Math.max(0, total - ratedCount);

    if (ratingPack.custom) {
      const palette = WEEKLY_TREND_COLORS;
      let offset = 0;
      const parts = [];
      ratingPack.options.forEach(function (opt, i) {
        const deg = total ? ((counts[opt.value] || 0) / total) * 360 : 0;
        const start = offset;
        offset += deg;
        parts.push(palette[Math.min(i, palette.length - 1)] + ' ' + start + 'deg ' + offset + 'deg');
      });
      parts.push('rgba(100, 116, 139, 0.5) ' + offset + 'deg 360deg');
      pieEl.style.background = 'conic-gradient(' + parts.join(',') + ')';
      legendEl.innerHTML =
        ratingPack.options
          .map(function (opt, i) {
            const color = palette[Math.min(i, palette.length - 1)];
            const label = opt.label.length > 28 ? opt.label.slice(0, 26) + '…' : opt.label;
            return (
              '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:' +
              color +
              '"></span>' +
              escapeHtml(label) +
              '</span><strong>' +
              (counts[opt.value] || 0) +
              '</strong></div>'
            );
          })
          .join('') +
        '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:rgba(100,116,139,0.5)"></span>Not rated</span><strong>' +
        notRated +
        '</strong></div>';
      return;
    }

    const c = {
      strong: counts.strong || 0,
      average: counts.average || 0,
      weak: counts.weak || 0,
    };
    const strongDeg = total ? (c.strong / total) * 360 : 0;
    const averageDeg = total ? (c.average / total) * 360 : 0;
    const weakDeg = total ? (c.weak / total) * 360 : 0;
    const d1 = strongDeg;
    const d2 = d1 + averageDeg;
    const d3 = d2 + weakDeg;
    pieEl.style.background =
      'conic-gradient(' +
      'rgba(20, 184, 166, 0.88) 0deg ' +
      d1 +
      'deg,' +
      'rgba(234, 179, 8, 0.88) ' +
      d1 +
      'deg ' +
      d2 +
      'deg,' +
      'rgba(239, 68, 68, 0.88) ' +
      d2 +
      'deg ' +
      d3 +
      'deg,' +
      'rgba(100, 116, 139, 0.5) ' +
      d3 +
      'deg 360deg)';
    legendEl.innerHTML =
      '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:rgba(20,184,166,0.88)"></span>Strong</span><strong>' +
      c.strong +
      '</strong></div>' +
      '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:rgba(234,179,8,0.88)"></span>Average</span><strong>' +
      c.average +
      '</strong></div>' +
      '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:rgba(239,68,68,0.88)"></span>Weak</span><strong>' +
      c.weak +
      '</strong></div>' +
      '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:rgba(100,116,139,0.5)"></span>Not rated</span><strong>' +
      notRated +
      '</strong></div>';
  }

  async function renderWeeklyProgressCharts(subject, term, week) {
    await paintWeeklyProgressChart('wk-progress-pie', 'wk-progress-legend', 'wk-progress-meta', subject, term, week);
    await paintWeeklyProgressChart(
      'class-progress-pie',
      'class-progress-legend',
      'class-progress-meta',
      subject,
      term,
      week
    );
  }

  async function renderClassWeeklyInProgressCard() {
    const subEl = document.getElementById('class-progress-subject');
    const weekEl = document.getElementById('class-progress-week');
    const wkSubEl = document.getElementById('wk-subject');
    const wkWeekEl = document.getElementById('wk-week');
    const wkTermEl = document.getElementById('wk-term');
    if (subEl && !subEl.options.length) {
      subjects.forEach(function (s) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        subEl.appendChild(o);
      });
    }
    if (weekEl && !weekEl.options.length) {
      for (let w = 1; w <= 11; w++) {
        const o = document.createElement('option');
        o.value = String(w);
        o.textContent = 'Week ' + w;
        weekEl.appendChild(o);
      }
    }
    const subject = (wkSubEl && wkSubEl.value) || (subEl && subEl.value) || subjects[0] || '';
    const week = Number((wkWeekEl && wkWeekEl.value) || (weekEl && weekEl.value) || 1);
    const term = Number((wkTermEl && wkTermEl.value) || 1);
    await renderWeeklyProgressCharts(subject, term, week);
  }

  function switchToTab(name) {
    if (window.__oceanLeaderMessagesPause) window.__oceanLeaderMessagesPause();
    if (window.__oceanCommentsPause) window.__oceanCommentsPause();
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.add('active');
    const classProgressWidget = document.getElementById('class-progress-widget');
    if (classProgressWidget) classProgressWidget.style.display = ['register', 'students', 'weekly'].indexOf(name) !== -1 ? '' : 'none';
    if (name === 'students') refreshStudentsTable();
    if (name === 'notes') {
      loadDocuments();
      loadClassWorkspaceNotes();
    }
    if (name === 'weekly') {
      loadWeeklyPanel();
      renderClassWeeklyInProgressCard();
    }
    if (name === 'comments' && window.__oceanCommentsInit) {
      window.__oceanCommentsInit();
      if (window.__oceanCommentsStartPolling) window.__oceanCommentsStartPolling();
    }
    if (name === 'reports' && window.__oceanReportsInit) window.__oceanReportsInit();
    if (name === 'export' && window.__oceanExportInit) window.__oceanExportInit();
    if (name === 'settings' && window.OceanSettings) {
      window.OceanSettings.syncProfileBar();
      window.OceanSettings.applyTipsVisibility();
    }
    if (name === 'messages' && window.__oceanLeaderMessagesInit) window.__oceanLeaderMessagesInit();
  }

  function openView(id) {
    const r = learnersRows.find(function (x) {
      return x.id === id;
    });
    if (!r) return;
    const modal = document.getElementById('view-modal');
    const ph = document.getElementById('view-photo');
    const nm = document.getElementById('view-name');
    const meta = document.getElementById('view-meta');
    const added = document.getElementById('view-added');
    if (nm) nm.textContent = r.full_name;
    if (meta)
      meta.textContent =
        'Reg. ' +
        r.reg_no +
        ' · ' +
        displayTitle +
        (r.stream ? ' · ' + (streamLabels[r.stream] || r.stream) : '');
    if (added) added.textContent = 'Added ' + formatStudentDate(r.created_at);
    if (ph) {
      if (r.passport_path) {
        ph.src = r.passport_path;
        ph.style.display = 'block';
        ph.alt = r.full_name;
      } else {
        ph.removeAttribute('src');
        ph.style.display = 'none';
        ph.alt = '';
      }
    }
    if (modal) modal.classList.add('open');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /** Strip extension and path; turn underscores into spaces for a readable full name. */
  function nameFromImageFileName(fileName) {
    if (!fileName) return '';
    const base = String(fileName).replace(/^.*[\\/]/, '');
    const i = base.lastIndexOf('.');
    const noExt = (i === -1 ? base : base.slice(0, i)).trim();
    return noExt.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  let studentsCache = [];

  async function openEdit(id) {
    if (!studentsCache.length) studentsCache = await loadStudents();
    const r = studentsCache.find(function (x) {
      return x.id === id;
    });
    if (!r) return;
    document.getElementById('edit-id').value = String(r.id);
    document.getElementById('edit_full_name').value = r.full_name;
    document.getElementById('edit_reg_no').value = r.reg_no;
    document.getElementById('edit_passport').value = '';
    document.getElementById('edit-modal').classList.add('open');
  }

  document.getElementById('edit-cancel').addEventListener('click', function () {
    document.getElementById('edit-modal').classList.remove('open');
  });

  document.getElementById('form-edit').addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const fd = new FormData();
    fd.append('full_name', document.getElementById('edit_full_name').value);
    fd.append('reg_no', document.getElementById('edit_reg_no').value);
    const p = document.getElementById('edit_passport').files[0];
    if (p) fd.append('passport', p);
    try {
      const res = await fetch('/api/students/' + id, { method: 'PATCH', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      document.getElementById('edit-modal').classList.remove('open');
      flash('Learner updated.', true);
      pushActivity('Updated learner: ' + (data.full_name || ''));
      addNotification('Learner profile updated.');
      studentsCache = [];
      refreshStudentsTable();
    } catch (err) {
      flash(err.message || 'Update failed', false);
    }
  });

  async function delStudent(id) {
    if (!confirm('Delete this learner?')) return;
    try {
      const res = await fetch('/api/students/' + id, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      flash('Learner removed.', true);
      pushActivity('Removed a learner from this class.');
      addNotification('Learner removed from class.');
      studentsCache = [];
      refreshStudentsTable();
      loadDocuments();
    } catch (err) {
      flash(err.message || 'Error', false);
    }
  }

  document.getElementById('passport').addEventListener('change', function () {
    const f = this.files && this.files[0];
    if (!f) return;
    const derived = nameFromImageFileName(f.name);
    if (derived) document.getElementById('full_name').value = derived;
  });

  document.getElementById('form-register').addEventListener('submit', async function (e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await fetch('/api/students', { method: 'POST', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      flash('Learner registered.', true);
      pushActivity('Registered ' + (data.full_name || 'new learner') + '.');
      addNotification('New learner added to ' + displayTitle + '.');
      e.target.reset();
      document.getElementById('field-class').value = classLevel;
      document.getElementById('field-stream').value = stream;
      document.getElementById('class_display').value =
        displayTitle + (stream ? ' — ' + (streamLabels[stream] || stream) : '');
      studentsCache = [];
      refreshStudentsTable();
    } catch (err) {
      flash(err.message || 'Could not save', false);
    }
  });

  function appendDocListItem(list, d, opts) {
    opts = opts || {};
    const li = document.createElement('li');
    const left = document.createElement('span');
    const scopeBadge =
      opts.showScopeBadge && d.document_scope === 'all_classes'
        ? '<span class="badge" title="From Skills dashboard">School-wide</span> '
        : '';
    const classBadge =
      opts.showClassTag && d.class_level
        ? '<span class="badge">' + escapeHtml(opts.classTag || d.class_level) + '</span> '
        : '';
    const typeLabel =
      d.doc_type === 'note' ? 'Typed note' : d.doc_type === 'scheme' ? 'Scheme' : d.doc_type === 'work' ? 'Work' : d.doc_type;
    left.innerHTML =
      scopeBadge +
      classBadge +
      '<span class="badge">Term ' +
      d.term +
      '</span> ' +
      escapeHtml(d.subject || '—') +
      (opts.showType ? ' · ' + escapeHtml(typeLabel) : '') +
      ' · ' +
      escapeHtml(d.title || 'Untitled');
    const link = document.createElement('a');
    link.href = d.file_path;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn';
    del.textContent = 'Remove';
    del.addEventListener('click', async function () {
      if (!confirm('Remove this document record?')) return;
      await fetch('/api/documents/' + d.id, { method: 'DELETE' });
      loadDocuments();
    });
    li.appendChild(left);
    const actions = document.createElement('span');
    actions.style.display = 'flex';
    actions.style.gap = '0.5rem';
    actions.appendChild(link);
    actions.appendChild(del);
    li.appendChild(actions);
    list.appendChild(li);
  }

  function renderDocList(listEl, rows, emptyMsg, opts) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.innerHTML = '<li style="color: var(--muted)">' + emptyMsg + '</li>';
      return;
    }
    rows.forEach(function (d) {
      appendDocListItem(listEl, d, opts);
    });
  }

  async function loadDocuments() {
    const list = document.getElementById('doc-list');
    const typedList = document.getElementById('typed-notes-list');
    if (list) list.innerHTML = '';
    if (typedList) typedList.innerHTML = '';
    let rows;
    try {
      const res = await fetch(apiDocsUrl());
      if (!res.ok) throw new Error();
      rows = await res.json();
    } catch {
      if (list) list.innerHTML = '<li>Could not load documents.</li>';
      if (typedList) typedList.innerHTML = '<li>Could not load typed notes.</li>';
      refreshDashboardStats();
      return;
    }
    const classFilter = document.getElementById('filter-term');
    const typedFilter = document.getElementById('typed-notes-filter');
    const ft = classFilter ? classFilter.value : '';
    const typedFt = typedFilter ? typedFilter.value : '';

    let classDocs = rows.filter(function (d) {
      return d.doc_type !== 'note';
    });
    let typedNotes = rows.filter(function (d) {
      return d.doc_type === 'note';
    });
    if (ft) {
      classDocs = classDocs.filter(function (d) {
        return String(d.term) === String(ft);
      });
    }
    if (typedFt) {
      typedNotes = typedNotes.filter(function (d) {
        return String(d.term) === String(typedFt);
      });
    }

    renderDocList(list, classDocs, 'No schemes or work yet for this filter.', {
      showScopeBadge: true,
      showType: true,
    });
    renderDocList(typedList, typedNotes, 'No typed notes saved yet.', {
      showScopeBadge: true,
      showType: false,
    });
    refreshDashboardStats();
  }

  function bindNotesToolbar(toolbarId, editorId) {
    const tb = document.getElementById(toolbarId);
    const ed = document.getElementById(editorId);
    if (!tb || !ed || tb.dataset.bound === '1') return;
    tb.dataset.bound = '1';
    tb.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      const cmd = btn.getAttribute('data-cmd');
      ed.focus();
      try {
        document.execCommand(cmd, false, null);
      } catch (_) {}
    });
  }

  function noteEditorHasContent(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return Boolean(String(tmp.textContent || '').trim());
  }

  async function loadClassWorkspaceNotes() {
    const ed = document.getElementById('class-notes-editor');
    const status = document.getElementById('class-notes-status');
    if (!ed) return;
    ed.innerHTML = '<p></p>';
    if (status) status.textContent = 'Notes ready.';
  }

  async function saveClassWorkspaceNotes() {
    const ed = document.getElementById('class-notes-editor');
    const status = document.getElementById('class-notes-status');
    if (!ed) return;
    const html = ed.innerHTML || '';
    if (!noteEditorHasContent(html)) {
      flash('Type something before saving.', false);
      return;
    }
    const title = window.prompt('Enter a title or file name for this note:');
    if (title === null) return;
    const noteTitle = String(title).trim();
    if (!noteTitle) {
      flash('A title is required to save the note.', false);
      return;
    }
    if (status) status.textContent = 'Saving...';
    try {
      const res = await fetch('/api/documents/typed-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_level: classLevel,
          stream: stream || '',
          term: document.getElementById('note-term').value,
          subject: document.getElementById('note-subject').value,
          title: noteTitle,
          html: html,
        }),
      });
      const raw = await res.text();
      let j = {};
      try {
        j = JSON.parse(raw);
      } catch (_) {}
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Notes save is not available yet. Restart or update the server, then try again.');
        }
        throw new Error(j.error || 'Could not save note');
      }
      ed.innerHTML = '<p></p>';
      if (status) status.textContent = 'Notes ready.';
      flash('Note saved as "' + noteTitle + '".', true);
      pushActivity('Saved typed note: ' + noteTitle + '.');
      addNotification('Typed note saved: ' + noteTitle + '.');
      loadDocuments();
    } catch (err) {
      if (status) status.textContent = err.message || 'Could not save note.';
      flash(err.message || 'Could not save note.', false);
    }
  }

  document.getElementById('btn-scheme').addEventListener('click', async function () {
    const file = document.getElementById('scheme-file').files[0];
    if (!file) {
      flash('Choose a file first.', false);
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('class_level', classLevel);
    if (stream) fd.append('stream', stream);
    fd.append('term', document.getElementById('note-term').value);
    fd.append('subject', document.getElementById('note-subject').value);
    fd.append('title', document.getElementById('scheme-title').value || file.name);
    try {
      const res = await fetch('/api/documents/scheme', { method: 'POST', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      flash('Scheme uploaded.', true);
      pushActivity('Uploaded a scheme document.');
      addNotification('Scheme uploaded for this class.');
      document.getElementById('scheme-file').value = '';
      loadDocuments();
    } catch (err) {
      flash(err.message || 'Upload failed', false);
    }
  });

  document.getElementById('btn-work-photo').addEventListener('click', async function () {
    const file = document.getElementById('work-photo').files[0];
    if (!file) {
      flash('Choose a photo (JPEG or PNG).', false);
      return;
    }
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('class_level', classLevel);
    if (stream) fd.append('stream', stream);
    fd.append('term', document.getElementById('note-term').value);
    fd.append('subject', document.getElementById('note-subject').value);
    fd.append('title', document.getElementById('scheme-title').value || 'Work from photo');
    try {
      const res = await fetch('/api/documents/work-from-photo', { method: 'POST', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      flash('PDF created from photo.', true);
      pushActivity('Created PDF from a work photo.');
      addNotification('Work PDF added to documents.');
      document.getElementById('work-photo').value = '';
      loadDocuments();
    } catch (err) {
      flash(err.message || 'Could not create PDF', false);
    }
  });

  document.getElementById('filter-term').addEventListener('change', loadDocuments);
  const typedNotesFilter = document.getElementById('typed-notes-filter');
  if (typedNotesFilter) typedNotesFilter.addEventListener('change', loadDocuments);
  bindNotesToolbar('class-notes-toolbar', 'class-notes-editor');
  const classNotesSaveBtn = document.getElementById('class-notes-save');
  if (classNotesSaveBtn) classNotesSaveBtn.addEventListener('click', saveClassWorkspaceNotes);

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      const name = tab.getAttribute('data-tab');
      if (name) switchToTab(name);
    });
  });

  const mainInner = document.querySelector('.dash-main-inner');
  if (mainInner) {
    mainInner.addEventListener('click', function (e) {
      const pbtn = e.target.closest('.js-learners-pager [data-goto]');
      if (!pbtn || pbtn.disabled) return;
      const total = filterLearnerRows(learnersRows).length;
      const totalPages = Math.max(1, Math.ceil(total / LEARNERS_PAGE_SIZE));
      if (pbtn.getAttribute('data-goto') === 'prev') learnersPage = Math.max(1, learnersPage - 1);
      else learnersPage = Math.min(totalPages, learnersPage + 1);
      renderStudentTables();
    });
  }

  ;['learners-search', 'learners-search-all'].forEach(function (sid) {
    const el = document.getElementById(sid);
    if (!el) return;
    el.addEventListener('input', function () {
      learnersFilter = el.value;
      learnersPage = 1;
      const otherId = sid === 'learners-search' ? 'learners-search-all' : 'learners-search';
      const other = document.getElementById(otherId);
      if (other && other !== el) other.value = el.value;
      renderStudentTables();
    });
  });

  const notifyBtn = document.getElementById('dash-notify-btn');
  const notifyDd = document.getElementById('dash-notify-dropdown');
  if (notifyBtn && notifyDd) {
    notifyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = notifyDd.hidden;
      notifyDd.hidden = !open;
      notifyBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) updateNotifUi();
    });
    document.addEventListener('click', function () {
      notifyDd.hidden = true;
      notifyBtn.setAttribute('aria-expanded', 'false');
    });
    notifyDd.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }

  const signoutBtn = document.getElementById('dash-btn-signout');
  if (signoutBtn) {
    signoutBtn.addEventListener('click', function () {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(STAFF_KEY);
      } catch (_) {}
      window.location.href = '/classes.html?leave=1';
    });
  }

  const viewModal = document.getElementById('view-modal');
  const viewClose = document.getElementById('view-modal-close');
  if (viewClose && viewModal) {
    viewClose.addEventListener('click', function () {
      viewModal.classList.remove('open');
    });
    viewModal.addEventListener('click', function (e) {
      if (e.target === viewModal) viewModal.classList.remove('open');
    });
  }

  function qa(id, tab) {
    const b = document.getElementById(id);
    if (b)
      b.addEventListener('click', function () {
        switchToTab(tab);
      });
  }
  qa('qa-notes', 'notes');
  qa('qa-messages', 'messages');
  qa('qa-reports', 'reports');
  qa('qa-export', 'export');
  qa('qa-subjects', 'subjects');
  qa('qa-weekly', 'weekly');
  qa('qa-settings', 'settings');

  ['wk-subject', 'wk-term', 'wk-week'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      loadWeeklyPanel();
      renderClassWeeklyInProgressCard();
    });
  });

  const wkTermGoalSave = document.getElementById('wk-term-goal-save');
  if (wkTermGoalSave) {
    wkTermGoalSave.addEventListener('click', async function () {
      const subEl = document.getElementById('wk-subject');
      const termEl = document.getElementById('wk-term');
      const goalEl = document.getElementById('wk-term-goal');
      const metaEl = document.getElementById('wk-term-goal-meta');
      const subject = subEl ? subEl.value : '';
      const term = Number(termEl ? termEl.value : 1);
      if (!subject) return;
      if (metaEl) metaEl.textContent = 'Saving…';
      try {
        const res = await fetch('/api/class-term-goal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classLevel: classLevel,
            stream: stream || '',
            subject: subject,
            term: term,
            goal_text: goalEl ? goalEl.value : '',
          }),
        });
        const raw = await res.text();
        let data = {};
        try {
          data = JSON.parse(raw);
        } catch (_) {}
        if (!res.ok) {
          throw new Error(weeklyGoalsApiError(res, data.error || 'Could not save term goal'));
        }
        if (metaEl) metaEl.textContent = 'Saved ' + new Date(data.updated_at || Date.now()).toLocaleString();
        flash('Term goal saved.', true);
      } catch (err) {
        if (metaEl) metaEl.textContent = err.message || 'Could not save term goal.';
        flash(err.message || 'Could not save term goal.', false);
      }
    });
  }

  const wkSuggestRatings = document.getElementById('wk-suggest-ratings');
  if (wkSuggestRatings) {
    wkSuggestRatings.addEventListener('click', function () {
      const weeklyGoalEl = document.getElementById('wk-weekly-goal');
      const ratingOptionsEl = document.getElementById('wk-rating-options');
      const suggestions = suggestRatingOptionsFromGoal(weeklyGoalEl ? weeklyGoalEl.value : '');
      if (!suggestions.length) {
        flash('Type a weekly goal first.', false);
        return;
      }
      if (ratingOptionsEl) ratingOptionsEl.value = suggestions.join('\n');
      const subEl = document.getElementById('wk-subject');
      const termEl = document.getElementById('wk-term');
      const weekEl = document.getElementById('wk-week');
      renderWeeklyLearnerTable(
        subEl ? subEl.value : '',
        Number(termEl ? termEl.value : 1),
        Number(weekEl ? weekEl.value : 1)
      );
    });
  }

  const wkRatingOptionsEl = document.getElementById('wk-rating-options');
  if (wkRatingOptionsEl) {
    let wkRatingRefreshTimer = null;
    wkRatingOptionsEl.addEventListener('input', function () {
      if (wkRatingRefreshTimer) clearTimeout(wkRatingRefreshTimer);
      wkRatingRefreshTimer = setTimeout(function () {
        const subEl = document.getElementById('wk-subject');
        const termEl = document.getElementById('wk-term');
        const weekEl = document.getElementById('wk-week');
        renderWeeklyLearnerTable(
          subEl ? subEl.value : '',
          Number(termEl ? termEl.value : 1),
          Number(weekEl ? weekEl.value : 1)
        );
      }, 250);
    });
  }

  const wkWeeklyGoalSave = document.getElementById('wk-weekly-goal-save');
  if (wkWeeklyGoalSave) {
    wkWeeklyGoalSave.addEventListener('click', async function () {
      const subEl = document.getElementById('wk-subject');
      const termEl = document.getElementById('wk-term');
      const weekEl = document.getElementById('wk-week');
      const weeklyGoalEl = document.getElementById('wk-weekly-goal');
      const ratingOptionsEl = document.getElementById('wk-rating-options');
      const metaEl = document.getElementById('wk-weekly-goal-meta');
      const subject = subEl ? subEl.value : '';
      const term = Number(termEl ? termEl.value : 1);
      const week = Number(weekEl ? weekEl.value : 1);
      const ratingOptions = parseRatingOptionsText(ratingOptionsEl ? ratingOptionsEl.value : '');
      if (!subject) return;
      if (ratingOptions.length && ratingOptions.length < 2) {
        flash('Add at least two rating words (one per line).', false);
        return;
      }
      if (metaEl) metaEl.textContent = 'Saving…';
      try {
        const res = await fetch('/api/class-weekly-goal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classLevel: classLevel,
            stream: stream || '',
            subject: subject,
            term: term,
            week: week,
            goal_text: weeklyGoalEl ? weeklyGoalEl.value : '',
            rating_options: ratingOptions,
          }),
        });
        const raw = await res.text();
        let data = {};
        try {
          data = JSON.parse(raw);
        } catch (_) {}
        if (!res.ok) {
          throw new Error(weeklyGoalsApiError(res, data.error || 'Could not save week goal'));
        }
        if (metaEl) metaEl.textContent = 'Saved ' + new Date(data.updated_at || Date.now()).toLocaleString();
        flash('Week goal saved.', true);
        wkGoalsContextKey = '';
        loadWeeklyPanel();
        renderClassWeeklyInProgressCard();
      } catch (err) {
        if (metaEl) metaEl.textContent = err.message || 'Could not save week goal.';
        flash(err.message || 'Could not save week goal.', false);
      }
    });
  }
  window.addEventListener('ocean-comments-context', function (ev) {
    const d = (ev && ev.detail) || {};
    const subEl = document.getElementById('class-progress-subject');
    if (subEl && d.subject) subEl.value = d.subject;
    renderClassWeeklyInProgressCard();
  });
  ['class-progress-subject', 'class-progress-week', 'wk-term'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      renderClassWeeklyInProgressCard();
    });
  });

  updateNotifUi();

  refreshStudentsTable().then(function () {
    loadWeeklyPanel();
    renderClassWeeklyInProgressCard();
  });
  loadDocuments();
  loadClassWorkspaceNotes();

  const staffForDm = auth && auth.getStoredStaff ? auth.getStoredStaff() : null;
  if (!staffForDm || (staffForDm.role !== 'director' && staffForDm.role !== 'head_teacher')) {
    setTimeout(function () {
      if (window.__oceanLeaderMessagesStartUnreadWatch) {
        window.__oceanLeaderMessagesStartUnreadWatch();
      }
    }, 1200);
  }

  window.__oceanDashboard = {
    classLevel: classLevel,
    stream: stream,
    displayTitle: displayTitle,
    streamPart: streamPart,
    streamLabels: streamLabels,
    titles: titles,
    isPrimary: isPrimary,
    subjects: subjects,
    skillOnlySubjects: skillOnlySubjects,
    flash: flash,
    switchToTab: switchToTab,
    refreshDashboardStats: refreshDashboardStats,
    addNotification: addNotification,
  };
})();

