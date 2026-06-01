(function () {
  const TOKEN_KEY = 'ocean_staff_token';
  const STAFF_KEY = 'ocean_staff_profile';

  const levelLabels = {
    daycare: 'Day Care',
    baby: 'Baby Class',
    middle: 'Middle Class',
    top: 'Top Class',
    primary1: 'Primary One',
    primary2: 'Primary Two',
  };

  const TAB_META = {
    overview: {
      crumb: 'School overview',
      title: 'School overview',
      sub: 'Whole-school learners, teaching staff, subject completion, and class groups — same term and period as class mark sheets.',
    },
    learners: {
      crumb: 'Learners & classes',
      title: 'Learners & classes',
      sub: 'Counts by class group and quick entry to the same class workspace teachers use.',
    },
    staff: {
      crumb: 'Staff & accounts',
      title: 'Staff & accounts',
      sub: 'Create and manage staff sign-ins for head, class, and skill dashboards.',
    },
    classes: {
      crumb: 'Class dashboards',
      title: 'Class dashboards',
      sub: 'Open any class for register, notes, roster, subjects, comments, and export (directors cannot open staff private messages).',
    },
    reports: {
      crumb: 'Reports & export',
      title: 'Reports & export',
      sub: 'Download subject completion for the term and period set on Overview.',
    },
    notes: {
      crumb: 'Notes & tools',
      title: 'Notes & tools',
      sub: 'Private director notes (on Overview) and class-level schemes from each class workspace.',
    },
    head: {
      crumb: 'Head & comments',
      title: 'Head teacher workspace',
      sub: 'School-level comment review and head tools — same as the head dashboard.',
    },
    skills: {
      crumb: 'Skills',
      title: 'Skills & vocational',
      sub: 'Skills uploads and progress — same entry points as from Classes.',
    },
    messages: {
      crumb: 'Messages',
      title: 'Private messages',
      sub: 'Direct chats with individual staff — only you and the person you choose can read each thread.',
    },
    settings: {
      crumb: 'Settings',
      title: 'Settings',
      sub: 'This device’s display name, photo, and theme. Primary grading bands are edited inside any class workspace → Settings.',
    },
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function selectedFilterYear() {
    const ySel = $('#filter-year');
    const yCustom = $('#filter-year-custom');
    if (!ySel) return new Date().getFullYear();
    if (ySel.value === '__custom__') {
      const y = Number(yCustom && yCustom.value ? yCustom.value : '');
      return Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    }
    const yy = Number(ySel.value);
    return Number.isFinite(yy) ? yy : new Date().getFullYear();
  }

  function buildYearFilterOptions(defaultYear) {
    const ySel = $('#filter-year');
    const yCustom = $('#filter-year-custom');
    if (!ySel) return;
    const now = new Date().getFullYear();
    ySel.innerHTML = '';
    for (let y = now - 2; y <= now + 2; y += 1) {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      if (y === Number(defaultYear)) o.selected = true;
      ySel.appendChild(o);
    }
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom year...';
    ySel.appendChild(customOpt);
    if (![now - 2, now - 1, now, now + 1, now + 2].includes(Number(defaultYear))) {
      ySel.value = '__custom__';
      if (yCustom) {
        yCustom.style.display = '';
        yCustom.value = String(defaultYear || '');
      }
    } else if (yCustom) {
      yCustom.style.display = 'none';
      yCustom.value = '';
    }
    ySel.addEventListener('change', function () {
      const isCustom = ySel.value === '__custom__';
      if (yCustom) {
        yCustom.style.display = isCustom ? '' : 'none';
        if (!isCustom) yCustom.value = '';
      }
    });
  }

  function authHeaders() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function directorLogout() {
    if (window.OceanStaffAuth) {
      if (window.OceanStaffAuth.stopIdleWatch) window.OceanStaffAuth.stopIdleWatch();
      window.OceanStaffAuth.redirectToLogin('/admin.html', false);
      return;
    }
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(STAFF_KEY);
    window.location.href = '/admin.html';
  }

  function bindDirectorLogoutButtons() {
    ['dir-btn-signout', 'dir-btn-signout-top'].forEach(function (id) {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.logoutBound) return;
      btn.dataset.logoutBound = '1';
      btn.addEventListener('click', directorLogout);
    });
  }

  function isGhostAdmin() {
    try {
      const raw = sessionStorage.getItem(STAFF_KEY);
      if (!raw) return false;
      return JSON.parse(raw).role === 'ghost';
    } catch (_) {
      return false;
    }
  }

  async function refreshGhostStaffLockUi() {
    const bar = $('#dir-ghost-staff-lock-bar');
    if (!bar) return;
    if (!isGhostAdmin()) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const lockBtn = $('#dir-ghost-lock-all');
    const unlockBtn = $('#dir-ghost-unlock-all');
    const statusEl = $('#dir-ghost-lock-status');
    const hintEl = $('#dir-ghost-lock-hint');
    try {
      const res = await fetch('/api/ghost/staff-lock', { headers: { ...authHeaders() } });
      const data = res.ok ? await res.json() : null;
      const locked = !!(data && data.locked);
      bar.classList.toggle('is-locked', locked);
      if (lockBtn) lockBtn.hidden = locked;
      if (unlockBtn) unlockBtn.hidden = !locked;
      if (hintEl) {
        hintEl.textContent = locked
          ? 'Staff sign-ins are locked. Teachers and directors cannot sign in until you allow sign-ins again.'
          : 'Lock every dashboard account at once. Only the system admin (ghost) can still sign in until you unlock.';
      }
      if (statusEl) {
        statusEl.textContent =
          data && data.updatedAt
            ? (locked ? 'Locked' : 'Unlocked') + ' · ' + new Date(data.updatedAt).toLocaleString()
            : locked
            ? 'All staff sign-ins are currently locked.'
            : 'Staff sign-ins are allowed.';
      }
    } catch (_) {
      if (statusEl) statusEl.textContent = 'Could not load lock status.';
    }
  }

  async function setGhostStaffLock(locked) {
    const msg = locked
      ? 'Lock all staff sign-ins?\n\nNo one except the system admin will be able to sign in until you unlock. People already signed in will be blocked on their next action.'
      : 'Allow staff sign-ins again?\n\nAccounts that were individually disabled will stay disabled.';
    if (!confirm(msg)) return;
    const res = await fetch('/api/ghost/staff-lock', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ locked: locked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Could not update staff sign-in lock.');
      return;
    }
    await refreshGhostStaffLockUi();
  }

  function humanClassLevel(cl) {
    return levelLabels[cl] || cl;
  }

  let overviewChart = null;

  function renderDistributionChart(dist) {
    const canvas = document.getElementById('dir-chart-distribution');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = dist.map((r) => {
      const base = humanClassLevel(r.class_level);
      return r.stream ? base + ' · ' + r.stream : base;
    });
    const data = dist.map((r) => r.count);
    const colors = [
      '#2563eb',
      '#ef4444',
      '#10b981',
      '#f59e0b',
      '#8b5cf6',
      '#ec4899',
      '#22d3ee',
      '#84cc16',
    ];
    if (overviewChart) overviewChart.destroy();
    overviewChart = new Chart(canvas, {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: labels.map((_, i) => colors[i % colors.length]),
            borderWidth: 2,
            borderColor: '#0f172a',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#cbd5e1', font: { size: 11 } },
          },
        },
      },
    });
  }

  function setBar(id, pct, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.width = Math.min(100, Math.max(0, pct)) + '%';
    el.style.background = color;
  }

  function renderOverview(data) {
    $('#dir-stat-learners').textContent = data.totals.learners;
    $('#dir-stat-teachers').textContent = data.totals.teachers;
    $('#dir-stat-classes').textContent = data.totals.classes;
    $('#dir-stat-skills').textContent = data.totals.skillSubjectsWithProgress;

    const snap = data.reportingSnapshot || {};
    setBar('dir-bar-comments', snap.percentLearnersWithComment || 0, '#3b82f6');
    setBar('dir-bar-marks', snap.percentLearnersWithMark || 0, '#22c55e');
    const combined = Math.round(
      ((snap.percentLearnersWithComment || 0) + (snap.percentLearnersWithMark || 0)) / 2
    );
    const lowerCov = Math.min(snap.percentLearnersWithComment || 0, snap.percentLearnersWithMark || 0);
    setBar('dir-bar-combined', combined, '#f97316');
    setBar('dir-bar-neither', lowerCov, '#ef4444');

    $('#dir-lbl-comments-pct').textContent = (snap.percentLearnersWithComment || 0) + '%';
    $('#dir-lbl-marks-pct').textContent = (snap.percentLearnersWithMark || 0) + '%';
    $('#dir-lbl-combined-pct').textContent = combined + '%';

    renderDistributionChart(data.learnerDistribution || []);

    const schoolBody = $('#dir-table-school-subjects');
    schoolBody.innerHTML = '';
    (data.subjectProgressSchool || []).forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(row.subject) +
        '</td><td>' +
        row.entered +
        '</td><td>' +
        row.total +
        '</td><td>' +
        row.percent +
        '%</td>';
      schoolBody.appendChild(tr);
    });

    const classContainer = $('#dir-class-subject-blocks');
    classContainer.innerHTML = '';
    (data.subjectProgressByClass || []).forEach((grp) => {
      const details = document.createElement('details');
      details.className = 'dir-class-block';
      details.open = false;
      const summary = document.createElement('summary');
      summary.textContent = humanClassLevel(grp.class_level) + (grp.stream ? ' · ' + grp.stream : '');
      details.appendChild(summary);
      const table = document.createElement('table');
      table.className = 'data';
      table.innerHTML =
        '<thead><tr><th>Subject</th><th>Entered</th><th>Class size</th><th>%</th></tr></thead><tbody></tbody>';
      const tb = table.querySelector('tbody');
      grp.subjects.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' +
          escapeHtml(row.subject) +
          '</td><td>' +
          row.entered +
          '</td><td>' +
          row.total +
          '</td><td>' +
          row.percent +
          '%</td>';
        tb.appendChild(tr);
      });
      details.appendChild(table);
      classContainer.appendChild(details);
    });

    renderWorkflowHealth(data);
    renderStaffCoverage();
  }

  async function renderWorkflowHealth(data) {
    const body = $('#dir-workflow-tbody');
    const alerts = $('#dir-health-alerts');
    if (!body || !alerts) return;
    const groups = (data.learnerDistribution || []).map((r) => ({
      class_level: r.class_level,
      stream: r.stream || '',
      label: humanClassLevel(r.class_level) + (r.stream ? ' · ' + r.stream : ''),
    }));
    if (!groups.length) {
      body.innerHTML = '<tr><td colspan="4">No class groups yet.</td></tr>';
      alerts.innerHTML = '<li><div>Register learners to start workflow checks.</div></li>';
      return;
    }
    const term = Number(data.term || $('#filter-term').value || 1);
    const period = String(data.period || $('#filter-period').value || 'mid');
    const checks = await Promise.all(
      groups.map(async (g) => {
        try {
          const [wfRes, valRes] = await Promise.all([
            fetch(
              '/api/report-workflow?classLevel=' +
                encodeURIComponent(g.class_level) +
                '&stream=' +
                encodeURIComponent(g.stream) +
                '&term=' +
                encodeURIComponent(term) +
                '&period=' +
                encodeURIComponent(period)
            ),
            fetch(
              '/api/report-validate?classLevel=' +
                encodeURIComponent(g.class_level) +
                '&stream=' +
                encodeURIComponent(g.stream) +
                '&term=' +
                encodeURIComponent(term) +
                '&period=' +
                encodeURIComponent(period)
            ),
          ]);
          const wf = wfRes.ok ? await wfRes.json().catch(() => ({})) : {};
          const val = valRes.ok ? await valRes.json().catch(() => ({})) : {};
          const total = Number(val.totalLearners || 0);
          const complete = Number(val.completeLearners || 0);
          const pct = total ? Math.round((100 * complete) / total) : 0;
          return {
            class_level: g.class_level,
            stream: g.stream,
            label: g.label,
            approvalState: wf.approvalState || 'draft',
            locked: !!wf.locked,
            completeText: complete + '/' + total + ' (' + pct + '%)',
            completionPct: pct,
          };
        } catch (_) {
          return {
            class_level: g.class_level,
            stream: g.stream,
            label: g.label,
            approvalState: 'unknown',
            locked: false,
            completeText: '—',
            completionPct: 0,
          };
        }
      })
    );

    body.innerHTML = '';
    const map = {};
    checks.forEach((c) => {
      const k = String(c.class_level || '') + '|' + String(c.stream || '');
      map[k] = c;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(c.label) +
        '</td><td>' +
        escapeHtml(c.completeText) +
        '</td><td><select class="dir-wf-approval" data-k="' +
        escapeHtml(k) +
        '">' +
        '<option value="draft"' +
        (c.approvalState === 'draft' ? ' selected' : '') +
        '>draft</option>' +
        '<option value="submitted"' +
        (c.approvalState === 'submitted' ? ' selected' : '') +
        '>submitted</option>' +
        '<option value="approved"' +
        (c.approvalState === 'approved' ? ' selected' : '') +
        '>approved</option>' +
        '</select></td><td><button type="button" class="btn dir-wf-lock" data-k="' +
        escapeHtml(k) +
        '" style="font-size:0.78rem;padding:0.28rem 0.5rem">' +
        (c.locked ? 'Unlock' : 'Lock') +
        '</button>' +
        '</td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('.dir-wf-approval').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const c = map[String(sel.getAttribute('data-k') || '')];
        if (!c) return;
        const ok = await updateWorkflowFromDirector(c, { approvalState: sel.value });
        if (ok) loadOverview();
      });
    });
    body.querySelectorAll('.dir-wf-lock').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const c = map[String(btn.getAttribute('data-k') || '')];
        if (!c) return;
        const ok = await updateWorkflowFromDirector(c, { locked: !c.locked });
        if (ok) loadOverview();
      });
    });

    const flagged = checks
      .filter((c) => c.completionPct < 80 || c.approvalState === 'draft' || !c.locked)
      .sort((a, b) => a.completionPct - b.completionPct)
      .slice(0, 6);
    alerts.innerHTML = '';
    if (!flagged.length) {
      alerts.innerHTML = '<li><div>All class groups look healthy for this term and period.</div></li>';
      return;
    }
    flagged.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML =
        '<div class="dir-event-date">Alert</div><div><strong>' +
        escapeHtml(f.label) +
        '</strong> · ' +
        escapeHtml(f.completeText) +
        ' · ' +
        escapeHtml(f.approvalState) +
        (f.locked ? '' : ' · not locked') +
        '</div>';
      alerts.appendChild(li);
    });
  }

  async function updateWorkflowFromDirector(group, patch) {
    const term = $('#filter-term').value;
    const period = $('#filter-period').value;
    const payload = Object.assign(
      {
        classLevel: group.class_level,
        stream: group.stream || '',
        term: Number(term),
        period: period,
      },
      patch || {}
    );
    const res = await fetch('/api/director/report-workflow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Could not update workflow state');
      return false;
    }
    return true;
  }

  async function renderStaffCoverage() {
    const box = $('#dir-staff-coverage');
    if (!box) return;
    try {
      const res = await fetch('/api/director/staff', { headers: { ...authHeaders() } });
      if (!res.ok) {
        box.innerHTML = '<p class="dir-muted">Staff snapshot unavailable.</p>';
        return;
      }
      const rows = await res.json();
      const counts = { director: 0, head_teacher: 0, class_teacher: 0, skill_teacher: 0, inactive: 0 };
      rows.forEach((r) => {
        if (!r.active) counts.inactive += 1;
        if (counts[r.role] != null) counts[r.role] += r.active ? 1 : 0;
      });
      const maxCount = Math.max(1, counts.director, counts.head_teacher, counts.class_teacher, counts.skill_teacher, counts.inactive);
      function w(n) {
        return Math.round((100 * n) / maxCount);
      }
      box.innerHTML =
        '<div class="dir-progress-row"><label><span>Directors</span><span>' + counts.director + '</span></label><div class="dir-progress-bar"><span style="width:' + w(counts.director) + '%;background:#a78bfa"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Head teachers</span><span>' + counts.head_teacher + '</span></label><div class="dir-progress-bar"><span style="width:' + w(counts.head_teacher) + '%;background:#38bdf8"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Class teachers</span><span>' + counts.class_teacher + '</span></label><div class="dir-progress-bar"><span style="width:' + w(counts.class_teacher) + '%;background:#22c55e"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Skill teachers</span><span>' + counts.skill_teacher + '</span></label><div class="dir-progress-bar"><span style="width:' + w(counts.skill_teacher) + '%;background:#f59e0b"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Inactive accounts</span><span>' + counts.inactive + '</span></label><div class="dir-progress-bar"><span style="width:' + w(counts.inactive) + '%;background:#ef4444"></span></div></div>';
    } catch (_) {
      box.innerHTML = '<p class="dir-muted">Staff snapshot unavailable.</p>';
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function loadOverview() {
    const term = $('#filter-term').value;
    const period = $('#filter-period').value;
    const year = selectedFilterYear();
    const res = await fetch(
      '/api/director/overview?term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(period) + '&year=' + encodeURIComponent(year),
      { headers: { ...authHeaders() } }
    );
    if (res.status === 401 || res.status === 403) {
      alert(res.status === 403 ? 'This dashboard is for directors only.' : 'Session expired.');
      directorLogout();
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Could not load overview');
      return;
    }
    const data = await res.json();
    renderOverview(data);
  }

  async function loadSchoolReportingContext() {
    try {
      const res = await fetch('/api/reporting-context');
      if (!res.ok) return null;
      return res.json().catch(() => null);
    } catch (_) {
      return null;
    }
  }

  async function saveSchoolReportingContext() {
    const term = Number($('#filter-term').value || 1);
    const period = String($('#filter-period').value || 'mid');
    const year = selectedFilterYear();
    const res = await fetch('/api/director/reporting-context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ term: term, period: period, year: year }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Could not save school reporting context');
      return false;
    }
    return true;
  }

  function classDashboardHref(classLevel, stream) {
    const q = new URLSearchParams({ class: classLevel });
    const s = (stream || '').trim();
    if (s) q.set('stream', s.toLowerCase());
    return '/dashboard.html?' + q.toString();
  }

  function classSignInHref(classLevel, stream) {
    const target = classDashboardHref(classLevel, stream);
    const auth = window.OceanStaffAuth;
    if (auth && auth.classWorkspaceSignInHref) {
      return auth.classWorkspaceSignInHref(target, 'class');
    }
    return '/classes.html?signin=class&next=' + encodeURIComponent(target);
  }

  let learnersRows = [];
  let directorReportGroups = [];
  let directorReportLearners = [];
  let classCatalogRows = [];

  async function loadClassCatalog() {
    const res = await fetch('/api/class-catalog');
    if (!res.ok) return [];
    classCatalogRows = await res.json().catch(() => []);
    return classCatalogRows;
  }

  function renderClassCatalogList() {
    const body = $('#cc-class-list');
    if (!body) return;
    body.innerHTML = '';
    (classCatalogRows || []).forEach(function (row) {
      const tr = document.createElement('tr');
      const subjects = Array.isArray(row.subjects) ? row.subjects.join(', ') : '—';
      const typeLabel = row.isCustom ? 'Custom' : 'Built-in';
      const deleteCell = row.isCustom
        ? '<button type="button" class="btn danger cc-del-class" data-id="' +
          escapeHtml(row.id) +
          '">Delete</button>'
        : '<span class="dir-muted">—</span>';
      tr.innerHTML =
        '<td>' +
        escapeHtml(row.title || row.id) +
        '</td><td>' +
        escapeHtml(row.id) +
        '</td><td>' +
        escapeHtml(typeLabel) +
        '</td><td>' +
        escapeHtml(subjects) +
        '</td><td>' +
        deleteCell +
        '</td>';
      body.appendChild(tr);
    });
    body.querySelectorAll('.cc-del-class').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const classId = btn.getAttribute('data-id');
        if (!classId) return;
        const row = (classCatalogRows || []).find(function (x) {
          return String(x.id) === String(classId);
        });
        const label = row && row.title ? row.title : classId;
        if (!window.confirm('Delete class "' + label + '"? This only works when no learners remain in that class.')) {
          return;
        }
        const status = $('#cc-status');
        if (status) status.textContent = 'Deleting...';
        const res = await fetch('/api/class-catalog/' + encodeURIComponent(classId), {
          method: 'DELETE',
          headers: { ...authHeaders() },
        });
        const j = await res.json().catch(function () {
          return {};
        });
        if (!res.ok) {
          if (status) status.textContent = j.error || 'Could not delete class.';
          return;
        }
        if (status) status.textContent = 'Deleted ' + label + '.';
        await loadClassCatalog();
        renderClassCatalogList();
        fillClassOptions($('#mv-from-class'), false);
        fillClassOptions($('#mv-target-class'), false);
        fillStreamOptions($('#mv-from-stream'), $('#mv-from-class') ? $('#mv-from-class').value : '', true);
        fillStreamOptions($('#mv-target-stream'), $('#mv-target-class') ? $('#mv-target-class').value : '', true);
        await loadMovementLearners();
      });
    });
  }

  function fillClassOptions(selectEl, includeEmpty) {
    if (!selectEl) return;
    const rows = Array.isArray(classCatalogRows) ? classCatalogRows : [];
    selectEl.innerHTML = '';
    if (includeEmpty) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '(none)';
      selectEl.appendChild(empty);
    }
    rows.forEach((r) => {
      const o = document.createElement('option');
      o.value = String(r.id || '');
      o.textContent = r.title || r.id;
      selectEl.appendChild(o);
    });
  }

  function fillStreamOptions(selectEl, classId, includeEmpty) {
    if (!selectEl) return;
    const row = (classCatalogRows || []).find((x) => String(x.id) === String(classId));
    const streams = row && Array.isArray(row.streams) ? row.streams : [];
    selectEl.innerHTML = '';
    if (!streams.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '(none)';
      selectEl.appendChild(o);
      return;
    }
    if (includeEmpty) {
      const e = document.createElement('option');
      e.value = '';
      e.textContent = 'Select stream...';
      selectEl.appendChild(e);
    }
    streams.forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      selectEl.appendChild(o);
    });
  }

  async function loadMovementLearners() {
    const classEl = $('#mv-from-class');
    const streamEl = $('#mv-from-stream');
    const listEl = $('#mv-learners');
    if (!classEl || !streamEl || !listEl || !classEl.value) return;
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', classEl.value);
    if (streamEl.value) u.searchParams.set('stream', streamEl.value);
    const res = await fetch(u.toString());
    if (!res.ok) return;
    const rows = await res.json().catch(() => []);
    listEl.innerHTML = '';
    (rows || []).forEach((r) => {
      const o = document.createElement('option');
      o.value = String(r.id);
      o.textContent = (r.full_name || 'Learner') + (r.reg_no ? ' · ' + r.reg_no : '');
      listEl.appendChild(o);
    });
  }

  async function initLearnerMovementPanel() {
    await loadClassCatalog();
    const fromClass = $('#mv-from-class');
    const fromStream = $('#mv-from-stream');
    const targetClass = $('#mv-target-class');
    const targetStream = $('#mv-target-stream');
    const yearEl = $('#mv-effective-year');
    const applyBtn = $('#mv-apply');
    const statusEl = $('#mv-status');
    if (!fromClass || !fromStream || !targetClass || !targetStream || !applyBtn || !statusEl) return;
    if (yearEl && !yearEl.value) yearEl.value = String(new Date().getFullYear() + 1);
    fillClassOptions(fromClass, false);
    fillClassOptions(targetClass, false);
    fillStreamOptions(fromStream, fromClass.value, true);
    fillStreamOptions(targetStream, targetClass.value, true);
    fromClass.addEventListener('change', async function () {
      fillStreamOptions(fromStream, fromClass.value, true);
      await loadMovementLearners();
    });
    fromStream.addEventListener('change', () => loadMovementLearners());
    targetClass.addEventListener('change', function () {
      fillStreamOptions(targetStream, targetClass.value, true);
    });
    await loadMovementLearners();
    applyBtn.addEventListener('click', async function () {
      const ids = Array.from($('#mv-learners').selectedOptions || []).map((o) => Number(o.value));
      if (!ids.length) {
        statusEl.textContent = 'Select learner(s) first.';
        return;
      }
      statusEl.textContent = 'Applying...';
      const body = {
        studentIds: ids,
        action: $('#mv-action') ? $('#mv-action').value : 'transfer',
        targetClassLevel: targetClass.value,
        targetStream: targetStream.value,
        effectiveYear: Number(yearEl && yearEl.value ? yearEl.value : ''),
      };
      const res = await fetch('/api/learners/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = j.error || 'Could not move learners.';
        return;
      }
      statusEl.textContent = 'Moved ' + (j.moved || 0) + ' learner(s).';
      await loadMovementLearners();
      loadLearnersDistribution();
    });
  }

  async function initClassCreationPanel() {
    await loadClassCatalog();
    renderClassCatalogList();
    const btn = $('#cc-create');
    const out = $('#cc-status');
    if (!btn || !out) return;
    btn.addEventListener('click', async function () {
      const id = ($('#cc-id') && $('#cc-id').value ? $('#cc-id').value : '').trim();
      const title = ($('#cc-title') && $('#cc-title').value ? $('#cc-title').value : '').trim();
      const subjectsRaw = ($('#cc-subjects') && $('#cc-subjects').value ? $('#cc-subjects').value : '').trim();
      const subjects = subjectsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s, i, arr) => s && arr.indexOf(s) === i);
      out.textContent = 'Creating...';
      const res = await fetch('/api/class-catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, title, isPrimary: true, subjects }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        out.textContent = j.error || 'Could not create class.';
        return;
      }
      out.textContent = 'Created ' + (j.title || j.id) + '.';
      if ($('#cc-id')) $('#cc-id').value = '';
      if ($('#cc-title')) $('#cc-title').value = '';
      if ($('#cc-subjects')) $('#cc-subjects').value = '';
      await loadClassCatalog();
      renderClassCatalogList();
      fillClassOptions($('#mv-from-class'), false);
      fillClassOptions($('#mv-target-class'), false);
      fillStreamOptions($('#mv-from-stream'), $('#mv-from-class') ? $('#mv-from-class').value : '', true);
      fillStreamOptions($('#mv-target-stream'), $('#mv-target-class') ? $('#mv-target-class').value : '', true);
      await loadMovementLearners();
    });
  }

  async function loadLearnersDistribution() {
    const res = await fetch('/api/students/count-summary');
    if (!res.ok) return;
    learnersRows = await res.json();
    directorReportGroups = groupedClassRows(learnersRows);
    fillReportExplorerClassOptions();
    loadReportExplorerLearners();
    renderLearnersTable();
  }

  function groupedClassRows(rows) {
    const map = {};
    (rows || []).forEach((r) => {
      const k = String(r.class_level || '').trim() + '|' + String(r.stream || '').trim();
      if (!map[k]) map[k] = { class_level: r.class_level, stream: r.stream || '' };
    });
    return Object.values(map).sort((a, b) => {
      const la = humanClassLevel(a.class_level) + (a.stream ? ' ' + a.stream : '');
      const lb = humanClassLevel(b.class_level) + (b.stream ? ' ' + b.stream : '');
      return la.localeCompare(lb);
    });
  }

  function fillReportExplorerClassOptions() {
    const classSel = $('#dir-rp-class');
    const streamSel = $('#dir-rp-stream');
    if (!classSel || !streamSel) return;
    const classes = {};
    directorReportGroups.forEach((g) => {
      const cl = String(g.class_level || '').trim();
      if (!cl) return;
      if (!classes[cl]) classes[cl] = [];
      classes[cl].push(String(g.stream || ''));
    });
    classSel.innerHTML = '';
    Object.keys(classes).forEach((cl) => {
      const o = document.createElement('option');
      o.value = cl;
      o.textContent = humanClassLevel(cl);
      classSel.appendChild(o);
    });
    function refillStreams() {
      const cl = classSel.value;
      const streams = (classes[cl] || []).slice();
      streamSel.innerHTML = '';
      if (!streams.length) {
        streamSel.innerHTML = '<option value="">(none)</option>';
        return;
      }
      streams
        .sort()
        .forEach((s) => {
          const o = document.createElement('option');
          o.value = s;
          o.textContent = s || '(none)';
          streamSel.appendChild(o);
        });
    }
    classSel.addEventListener('change', function () {
      refillStreams();
      loadReportExplorerLearners();
    });
    streamSel.addEventListener('change', function () {
      loadReportExplorerLearners();
    });
    refillStreams();
  }

  async function loadReportExplorerLearners() {
    const classSel = $('#dir-rp-class');
    const streamSel = $('#dir-rp-stream');
    const learnerSel = $('#dir-rp-learner');
    if (!classSel || !streamSel || !learnerSel) return;
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', classSel.value);
    if (streamSel.value) u.searchParams.set('stream', streamSel.value);
    const res = await fetch(u.toString());
    if (!res.ok) return;
    const rows = await res.json();
    directorReportLearners = Array.isArray(rows) ? rows : [];
    learnerSel.innerHTML = '';
    directorReportLearners.forEach((r) => {
      const o = document.createElement('option');
      o.value = String(r.id);
      o.textContent = r.full_name + (r.reg_no ? ' · ' + r.reg_no : '');
      learnerSel.appendChild(o);
    });
  }

  function reportTermHeading(period, term, reportYear) {
    const termWord = { '1': 'ONE', '2': 'TWO', '3': 'THREE' }[String(term)] || String(term);
    const periodWord =
      period === 'begin' ? 'BEGINNING OF TERM' : period === 'mid' ? 'MID TERM' : 'END TERM';
    return periodWord + ' ' + termWord + ' ' + String(reportYear || new Date().getFullYear());
  }

  function parseAggDigit(agg) {
    const x = parseInt(String(agg == null ? '' : agg).trim(), 10);
    if (Number.isNaN(x) || x < 1 || x > 9) return null;
    return x;
  }

  function primaryAggregateFromMarkRowsLocal(rows, skillList) {
    const grades = [];
    (rows || []).forEach(function (r) {
      if (skillList.indexOf(r.subject) !== -1) return;
      const g = parseAggDigit(r.agg);
      if (g != null) grades.push(g);
    });
    if (!grades.length) return { sum: null, division: '' };
    const sum = grades.reduce(function (a, b) { return a + b; }, 0);
    const n = grades.length;
    const equiv = Math.round((sum / n) * 4);
    const e = Math.max(4, Math.min(36, equiv));
    let div = '';
    if (e >= 4 && e <= 12) div = 'I';
    else if (e >= 13 && e <= 23) div = 'II';
    else if (e >= 24 && e <= 29) div = 'III';
    else if (e >= 30 && e <= 34) div = 'IV';
    else div = 'U';
    return { sum: sum, division: div };
  }

  function buildDirectorReportHtml(student, classLevel, stream, term, period, byC, byM, ctBy, headBy, nextTermBegins) {
    const isPrimary = classLevel === 'primary1' || classLevel === 'primary2';
    const skillList = window.OCEAN_SKILL_SUBJECTS || [];
    const subjects = (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS[classLevel]) || [];
    const classLabel = humanClassLevel(classLevel) + (stream ? ' (' + stream + ')' : '');
    const termLabel = reportTermHeading(period, term, new Date().getFullYear());

    if (isPrimary) {
      const academicSubjects = subjects.filter(function (s) { return skillList.indexOf(s) === -1; });
      const skillSubjects = subjects.filter(function (s) { return skillList.indexOf(s) !== -1; });
      const academicRows = academicSubjects.map(function (sub) {
        const m = byM[student.id + '\t' + sub] || {};
        return { subject: sub, scored: m.marks_scored != null ? Number(m.marks_scored) : null, agg: m.agg || '', remark: m.remark || '', initials: m.initials || '' };
      });
      const totalScored = academicRows.reduce(function (sum, r) { return sum + (Number.isFinite(r.scored) ? r.scored : 0); }, 0);
      const aggregateInfo = primaryAggregateFromMarkRowsLocal(academicRows.map(function (r) { return { subject: r.subject, agg: r.agg }; }), skillList);
      const marksRowsHtml = academicRows.map(function (r) {
        return '<tr><td>' + escapeHtml(r.subject) + '</td><td class="num">100</td><td class="num">' + escapeHtml(Number.isFinite(r.scored) ? String(r.scored) : '') + '</td><td class="num">' + escapeHtml(r.agg || '') + '</td><td>' + escapeHtml(r.remark || '') + '</td><td class="num">' + escapeHtml(r.initials || '') + '</td></tr>';
      }).join('');
      const skillsRowsHtml = skillSubjects.map(function (sub) {
        return '<tr><td>' + escapeHtml(sub) + '</td><td>' + escapeHtml(byC[student.id + '\t' + sub] || '') + '</td></tr>';
      }).join('');
      return '<div class="primary-report-card"><img class="baby-edge baby-edge-top-left" src="/images/reports/baby/edge.png" alt="" /><img class="baby-edge baby-edge-bottom-right" src="/images/reports/baby/edge.png" alt="" /><div class="primary-report-head"><img class="baby-school-title-image" src="/images/reports/baby/school-name-mark.png" alt="School name" /><p class="baby-kicker">“Up with skills”</p><p class="baby-term">' + escapeHtml(termLabel) + '</p><p class="baby-term baby-term-report">REPORT</p><div class="baby-head-line"></div><img class="baby-student-photo" src="' + escapeHtml(student.passport_path || '/images/ocean-school-logo.png') + '" alt="" /><img class="baby-badge" src="/images/reports/baby/badge.png" alt="" /><div class="baby-meta"><p><strong>NAME:</strong> <span>' + escapeHtml((student.full_name || '').toUpperCase()) + '</span></p><p><strong>CLASS:</strong> <span>' + escapeHtml(classLabel.toUpperCase()) + '</span></p><p><strong>REG NO:</strong> <span>' + escapeHtml((student.reg_no || '').toUpperCase()) + '</span></p></div></div><table class="primary-marks-table"><thead><tr><th>Subject</th><th>F/M</th><th>Marks scored</th><th>Grade</th><th>Remark</th><th>Initials</th></tr></thead><tbody>' + marksRowsHtml + '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '—') + '</td><td></td></tr></tbody></table><div class="primary-grade-scale"><h5>GRADING SCALE</h5><table><tbody><tr><td>90 – 100</td><td>D1</td><td>60 – 69</td><td>C4</td><td>40 – 44</td><td>P8</td></tr><tr><td>80 – 89</td><td>D2</td><td>55 – 59</td><td>C5</td><td>45 – 49</td><td>P7</td></tr><tr><td>70 – 79</td><td>C3</td><td>50 – 54</td><td>C6</td><td>0 – 39</td><td>F9</td></tr></tbody></table></div><h5 class="primary-skill-title">Skills</h5><table class="primary-skill-table"><tbody>' + skillsRowsHtml + '</tbody></table><div class="primary-comments"><p><strong>Class teacher\'s comment:</strong> ' + escapeHtml(ctBy[student.id] || '') + '</p><div class="primary-sign-row"><span>Signature:</span><span class="sig-line"></span></div><p><strong>Head teacher\'s comment:</strong> ' + escapeHtml(headBy[student.id] || '') + '</p><div class="primary-sign-row"><span>Signature:</span><span class="sig-line"></span></div>' + (period === 'end' ? '<p class="baby-next-term">Next term begins: <span>' + escapeHtml(nextTermBegins || '—') + '</span></p>' : '') + '</div></div>';
    }

    const cardOrder = classLevel === 'middle'
      ? ['Language Development', 'Reading', 'Writing', 'Numeracy', 'General Knowledge', 'Computer', 'Music', 'Salon', 'Fashion and Design', 'Bakery']
      : classLevel === 'daycare'
      ? ['Listening and Speaking', 'Drawing and Shading', 'General Knowledge', 'Social Development', 'Rhythms and Songs', 'Health Habits']
      : classLevel === 'top'
      ? ['Language Development', 'Health Habits', 'Reading', 'Writing', 'Social Development', 'Numeracy', 'Fashion and Design', 'Bakery', 'Salon', 'Music', 'Computer']
      : ['Reading', 'Writing', 'Numeracy', 'General Knowledge', 'Computer', 'Music', 'Salon', 'Fashion and Design'];
    const subjectIcons = {
      'Language Development': '/images/reports/baby/language-development.png', Reading: '/images/reports/baby/reading.png', Writing: '/images/reports/baby/writing.png',
      Numeracy: '/images/reports/baby/numeracy.png', Computer: '/images/reports/baby/computer.png', Music: '/images/reports/baby/music.png', Salon: '/images/reports/baby/salon.png',
      'Fashion and Design': '/images/reports/baby/fashion-and-design.png', Bakery: '/images/reports/baby/bakery.png', 'Listening and Speaking': '/images/reports/daycare/listening-and-speaking.png',
      'Drawing and Shading': '/images/reports/daycare/drawing-and-shading.png', 'General Knowledge': '/images/reports/daycare/general-knowledge.png', 'Social Development': '/images/reports/daycare/social-development.png',
      'Rhythms and Songs': '/images/reports/daycare/rhythms-and-songs.png', 'Health Habits': '/images/reports/daycare/health-habits.png',
    };
    const cards = cardOrder.map(function (sub) {
      return '<article class="baby-subject-card"><img src="' + escapeHtml(subjectIcons[sub] || '') + '" alt="" /><h5>' + escapeHtml(sub) + '</h5><p>' + escapeHtml(byC[student.id + '\t' + sub] || '—') + '</p></article>';
    }).join('');
    return '<div class="baby-report-card' + (classLevel === 'middle' ? ' middle-report-card' : '') + (classLevel === 'daycare' ? ' daycare-report-card' : '') + (classLevel === 'top' ? ' top-report-card' : '') + '"><img class="baby-edge baby-edge-top-left" src="/images/reports/baby/edge.png" alt="" /><img class="baby-edge baby-edge-bottom-right" src="/images/reports/baby/edge.png" alt="" /><div class="baby-report-head"><img class="baby-school-title-image" src="/images/reports/baby/school-name-mark.png" alt="School name" /><p class="baby-kicker">“Up with skills”</p><p class="baby-term">' + escapeHtml(termLabel) + '</p><p class="baby-term baby-term-report">REPORT</p><div class="baby-head-line"></div><img class="baby-student-photo" src="' + escapeHtml(student.passport_path || '/images/ocean-school-logo.png') + '" alt="" /><img class="baby-badge" src="/images/reports/baby/badge.png" alt="" /><div class="baby-meta"><p><strong>NAME:</strong> <span>' + escapeHtml((student.full_name || '').toUpperCase()) + '</span></p><p><strong>CLASS:</strong> <span>' + escapeHtml(classLabel.toUpperCase()) + '</span></p><p><strong>REG NO:</strong> <span>' + escapeHtml((student.reg_no || '').toUpperCase()) + '</span></p></div></div><section class="baby-subjects-grid">' + cards + '</section><div class="baby-bottom-comments' + (period !== 'end' ? ' no-next-term' : '') + '"><p><strong>Class teacher\'s comment:</strong> ' + escapeHtml(ctBy[student.id] || '') + '</p><div class="baby-head-row"><p><strong>Head caregiver\'s comment:</strong> ' + escapeHtml(headBy[student.id] || '') + '</p><div class="baby-signatures-stack"><div class="baby-sign-row"><span>Signature:</span><span class="sig-line"></span></div><div class="baby-sign-row"><span>Signature:</span><span class="sig-line"></span></div></div></div>' + (period === 'end' ? '<p class="baby-next-term">Next term begins: <span>' + escapeHtml(nextTermBegins || '—') + '</span></p>' : '') + '</div></div>';
  }

  async function loadReportExplorerData() {
    const classSel = $('#dir-rp-class');
    const streamSel = $('#dir-rp-stream');
    const termSel = $('#dir-rp-term');
    const periodSel = $('#dir-rp-period');
    const learnerSel = $('#dir-rp-learner');
    const outVal = $('#dir-rp-validation');
    const outPrev = $('#dir-rp-preview');
    const status = $('#dir-rp-status');
    if (!classSel || !streamSel || !termSel || !periodSel || !learnerSel || !outVal || !outPrev || !status) return;
    const cl = classSel.value;
    const stream = streamSel.value;
    const term = termSel.value;
    const period = periodSel.value;
    const sid = learnerSel.value;
    status.textContent = 'Loading...';
    const qBase = 'classLevel=' + encodeURIComponent(cl) + '&stream=' + encodeURIComponent(stream) + '&term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(period);
    const [valRes, comRes, marksRes, headRes, ctRes] = await Promise.all([
      fetch('/api/report-validate?' + qBase),
      fetch('/api/comments?' + qBase),
      fetch('/api/marks?' + qBase),
      fetch('/api/head-comments?' + qBase),
      fetch('/api/class-teacher-comments?' + qBase),
    ]);
    if (!valRes.ok) {
      status.textContent = 'Could not load report data.';
      return;
    }
    const val = await valRes.json();
    const comments = comRes.ok ? await comRes.json().catch(() => []) : [];
    const marks = marksRes.ok ? await marksRes.json().catch(() => []) : [];
    const head = headRes.ok ? await headRes.json().catch(() => []) : [];
    const ct = ctRes.ok ? await ctRes.json().catch(() => []) : [];

    const learnerRow = (val.learners || []).find((x) => String(x.student_id) === String(sid));
    outVal.innerHTML =
      '<p class="dir-muted" style="margin-bottom:0.45rem">Complete learners: <strong>' +
      val.completeLearners +
      '/' +
      val.totalLearners +
      '</strong></p>' +
      '<p style="margin:0;font-size:0.86rem">' +
      (learnerRow
        ? learnerRow.complete
          ? '<span style="color:#22c55e">This learner is complete.</span>'
          : '<span style="color:#f59e0b">Missing: ' + escapeHtml(learnerRow.missing.join(', ')) + '</span>'
        : 'Select learner') +
      '</p>';

    const student = directorReportLearners.find((r) => String(r.id) === String(sid));
    const byC = {};
    const byM = {};
    const ctBy = {};
    const headBy = {};
    (comments || []).forEach((r) => {
      if (String(r.student_id) !== String(sid)) return;
      byC[r.student_id + '\t' + r.subject] = r.body || '';
    });
    (marks || []).forEach((r) => {
      if (String(r.student_id) !== String(sid)) return;
      byM[r.student_id + '\t' + r.subject] = r;
    });
    (ct || []).forEach((r) => {
      if (String(r.student_id) === String(sid)) ctBy[r.student_id] = r.body || '';
    });
    (head || []).forEach((r) => {
      if (String(r.student_id) === String(sid)) headBy[r.student_id] = r.body || '';
    });
    let nextTermBegins = '';
    try {
      const su = new URL('/api/report-settings', window.location.origin);
      su.searchParams.set('classLevel', cl);
      if (stream) su.searchParams.set('stream', stream);
      const sr = await fetch(su.toString());
      if (sr.ok) {
        const sj = await sr.json().catch(() => ({}));
        nextTermBegins = sj.nextTermBegins || '';
      }
    } catch (_) {}
    outPrev.innerHTML = student
      ? buildDirectorReportHtml(student, cl, stream, term, period, byC, byM, ctBy, headBy, nextTermBegins)
      : '<p class="dir-muted">Select learner.</p>';
    status.textContent = 'Loaded.';
  }

  function renderLearnersTable() {
    const tb = $('#dir-learners-tbody');
    if (!tb) return;
    const q = ($('#dir-learners-search') && $('#dir-learners-search').value.trim().toLowerCase()) || '';
    tb.innerHTML = '';
    let idx = 0;
    learnersRows.forEach((r) => {
      const label = humanClassLevel(r.class_level) + (r.stream ? ' · ' + r.stream : '');
      const hay = (r.class_level + ' ' + (r.stream || '') + ' ' + label).toLowerCase();
      if (q && !hay.includes(q)) return;
      idx += 1;
      const tr = document.createElement('tr');
      const href = classSignInHref(r.class_level, r.stream);
      tr.innerHTML =
        '<td>' +
        idx +
        '</td><td>' +
        escapeHtml(humanClassLevel(r.class_level)) +
        '</td><td>' +
        escapeHtml(r.stream || '—') +
        '</td><td>' +
        r.count +
        '</td><td><a class="btn btn-primary" style="font-size:0.82rem;padding:0.35rem 0.65rem;text-decoration:none" href="' +
        escapeHtml(href) +
        '">Open</a></td>';
      tb.appendChild(tr);
    });
  }

  async function loadStaffTable() {
    const res = await fetch('/api/director/staff', { headers: { ...authHeaders() } });
    if (!res.ok) {
      directorLogout();
      return;
    }
    const rows = await res.json();
    const tb = $('#dir-staff-tbody');
    tb.innerHTML = '';
    let myStaffId = null;
    try {
      const raw = sessionStorage.getItem(STAFF_KEY);
      if (raw) myStaffId = Number(JSON.parse(raw).id);
    } catch (_) {}
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const scope =
        r.role === 'class_teacher' && r.class_level
          ? humanClassLevel(r.class_level) + (r.stream ? ' · ' + r.stream : '')
          : '—';
      tr.innerHTML =
        '<td>' +
        escapeHtml(r.display_name) +
        '</td><td>' +
        escapeHtml(r.email) +
        '</td><td>' +
        escapeHtml(r.role) +
        '</td><td>' +
        escapeHtml(scope) +
        '</td><td>' +
        (r.active ? 'Active' : 'Disabled') +
        '</td><td></td>';
      const tdAct = tr.querySelector('td:last-child');
      tdAct.style.whiteSpace = 'nowrap';
      const actWrap = document.createElement('div');
      actWrap.className = 'dir-staff-actions';
      actWrap.style.display = 'flex';
      actWrap.style.flexWrap = 'wrap';
      actWrap.style.gap = '0.35rem';
      actWrap.style.justifyContent = 'flex-end';

      function staffDeleteBtn() {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn dir-staff-delete';
        del.style.fontSize = '0.82rem';
        del.style.padding = '0.35rem 0.55rem';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          if (
            !confirm(
              'Permanently delete “' +
                (r.display_name || r.email) +
                '”? This cannot be undone. Their private messages will be removed.'
            )
          ) {
            return;
          }
          const delRes = await fetch('/api/director/staff/' + r.id, {
            method: 'DELETE',
            headers: { ...authHeaders() },
          });
          if (!delRes.ok) {
            const j = await delRes.json().catch(() => ({}));
            alert(j.error || 'Could not delete account');
            return;
          }
          loadStaffTable();
        });
        return del;
      }

      if (myStaffId != null && Number(r.id) === myStaffId) {
        tdAct.textContent = '—';
      } else {
        if (r.active) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn';
          btn.style.fontSize = '0.82rem';
          btn.style.padding = '0.35rem 0.55rem';
          btn.textContent = 'Disable';
          btn.addEventListener('click', async () => {
            if (!confirm('Disable this account?')) return;
            const patch = await fetch('/api/director/staff/' + r.id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ active: false }),
            });
            if (!patch.ok) {
              const j = await patch.json().catch(() => ({}));
              alert(j.error || 'Failed');
              return;
            }
            loadStaffTable();
          });
          actWrap.appendChild(btn);
        }
        actWrap.appendChild(staffDeleteBtn());
        tdAct.appendChild(actWrap);
      }
      tb.appendChild(tr);
    });
  }

  async function loadNotes() {
    const res = await fetch('/api/director/notes', { headers: { ...authHeaders() } });
    if (!res.ok) return;
    const j = await res.json();
    const ta = $('#dir-private-notes');
    if (ta) ta.value = j.text || '';
  }

  async function saveNotes() {
    const ta = $('#dir-private-notes');
    const text = ta ? ta.value : '';
    const res = await fetch('/api/director/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Could not save notes');
      return;
    }
    alert('Notes saved.');
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

  async function loadNotesTabEditor() {
    const ed = $('#dir-notes-editor-tab');
    const status = $('#dir-notes-status-tab');
    if (!ed) return;
    if (status) status.textContent = 'Loading notes...';
    try {
      const u = new URL('/api/workspace-notes', window.location.origin);
      u.searchParams.set('scope', 'director');
      const res = await fetch(u.toString(), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not load notes');
      ed.innerHTML = String(j.html || '').trim() || '<p></p>';
      if (status) status.textContent = j.updatedAt ? 'Saved ' + new Date(j.updatedAt).toLocaleString() : 'Notes ready.';
    } catch (err) {
      if (status) status.textContent = err.message || 'Could not load notes.';
    }
  }

  async function saveNotesTabEditor() {
    const ed = $('#dir-notes-editor-tab');
    const status = $('#dir-notes-status-tab');
    if (!ed) return;
    if (status) status.textContent = 'Saving...';
    try {
      const res = await fetch('/api/workspace-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ scope: 'director', html: ed.innerHTML || '' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save notes');
      if (status) status.textContent = 'Saved ' + new Date(j.updatedAt || Date.now()).toLocaleString();
      alert('Notes saved.');
    } catch (err) {
      if (status) status.textContent = err.message || 'Could not save notes.';
      alert(err.message || 'Could not save notes');
    }
  }

  const statsRow = document.querySelector('.dir-dash-stats');

  function switchTab(tab) {
    const meta = TAB_META[tab] || TAB_META.overview;
    $('#dir-breadcrumb').textContent = meta.crumb;
    const tEl = $('#dash-title');
    const sEl = $('#dash-sub');
    if (tEl) tEl.textContent = meta.title;
    if (sEl) sEl.textContent = meta.sub;

    document.querySelectorAll('body.app-director .tab-panel.panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'panel-' + tab);
    });
    document.querySelectorAll('body.app-director .dash-nav-btn.tab').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('body.app-director .dash-tabs-wrap .tab').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });

    if (statsRow) statsRow.style.display = tab === 'overview' ? '' : 'none';

    if (tab === 'staff') {
      loadStaffTable();
      refreshGhostStaffLockUi();
    }
    if (tab === 'notes') loadNotesTabEditor();
    if (tab === 'overview') loadOverview();
    if (tab === 'learners') loadLearnersDistribution();
    if (tab === 'messages' && window.__oceanLeaderMessagesInit) {
      window.__oceanLeaderMessagesInit();
    } else if (window.__oceanLeaderMessagesPause) {
      window.__oceanLeaderMessagesPause();
    }
    if (tab === 'classes') {
      loadClassCatalog().then(function () {
        renderClassCatalogList();
      });
    }
    if (window.__oceanTeacherMobile && window.__oceanTeacherMobile.syncHomeStats) {
      window.__oceanTeacherMobile.syncHomeStats();
    }
  }

  window.__oceanDirector = {
    switchToTab: switchTab,
  };

  function initNav() {
    document.querySelectorAll('.dash-nav-btn[data-tab], .dash-tabs-wrap .tab[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (!tab) return;
        switchTab(tab);
      });
    });
  }

  bindDirectorLogoutButtons();

  $('#dir-filter-apply').addEventListener('click', async () => {
    const ok = await saveSchoolReportingContext();
    if (!ok) return;
    loadOverview();
  });

  $('#dir-notes-save').addEventListener('click', () => saveNotes());
  bindNotesToolbar('dir-notes-toolbar', 'dir-notes-editor-tab');
  const saveTabBtn = $('#dir-notes-save-tab');
  if (saveTabBtn) saveTabBtn.addEventListener('click', () => saveNotesTabEditor());

  const jumpNotes = $('#dir-jump-notes-overview');
  if (jumpNotes) {
    jumpNotes.addEventListener('click', () => {
      switchTab('overview');
      const w = $('#dir-notes-widget');
      if (w) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  const searchLearners = $('#dir-learners-search');
  if (searchLearners) {
    searchLearners.addEventListener('input', () => renderLearnersTable());
  }

  $('#dir-staff-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#sf-email').value.trim();
    const password = $('#sf-password').value;
    const display_name = $('#sf-name').value.trim();
    const role = $('#sf-role').value;
    const class_level = $('#sf-class-level').value.trim() || null;
    const stream = $('#sf-stream').value.trim();
    const body = { email, password, display_name, role, class_level, stream };
    const res = await fetch('/api/director/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error || 'Could not create account');
      return;
    }
    const staffForm = $('#dir-staff-form');
    if (staffForm) staffForm.reset();
    loadStaffTable();
    alert('Account created. Share the email and password with the staff member.');
  });

  $('#dir-export-csv').addEventListener('click', async () => {
    await loadOverview();
    const term = $('#filter-term').value;
    const period = $('#filter-period').value;
    const res = await fetch(
      '/api/director/overview?term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(period),
      { headers: { ...authHeaders() } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const lines = [['Scope', 'Subject', 'Entered', 'Total', 'Percent']];
    (data.subjectProgressSchool || []).forEach((r) => {
      lines.push(['School', r.subject, r.entered, r.total, r.percent]);
    });
    (data.subjectProgressByClass || []).forEach((grp) => {
      const scope = grp.label;
      grp.subjects.forEach((r) => {
        lines.push([scope, r.subject, r.entered, r.total, r.percent]);
      });
    });
    const csv = lines.map((row) => row.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'subject-progress-term' + term + '-' + period + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const rpLoadBtn = $('#dir-rp-load');
  if (rpLoadBtn) rpLoadBtn.addEventListener('click', () => loadReportExplorerData());
  ['dir-rp-term', 'dir-rp-period', 'dir-rp-learner'].forEach((id) => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      if ($('#panel-reports') && $('#panel-reports').classList.contains('active')) loadReportExplorerData();
    });
  });

  const token = sessionStorage.getItem(TOKEN_KEY);
  const profile = sessionStorage.getItem(STAFF_KEY);
  if (window.OceanStaffAuth) {
    if (
      !window.OceanStaffAuth.validateSessionFreshness({
        loginPath: '/admin.html',
        preserveNext: false,
      })
    ) {
      return;
    }
  }
  if (!token || !profile) {
    directorLogout();
    return;
  }
  let staff;
  try {
    staff = JSON.parse(profile);
  } catch (_) {
    directorLogout();
    return;
  }
  if (staff.role !== 'director' && staff.role !== 'ghost') {
    alert('This page is for directors only.');
    directorLogout();
    return;
  }
  if (window.OceanStaffAuth) {
    window.OceanStaffAuth.startIdleWatch({
      loginPath: '/admin.html',
      preserveNext: false,
    });
  }

  const barName = $('#profile-bar-name');
  if (barName) barName.textContent = staff.display_name || 'Director';
  if (window.OceanWelcomeBanner) window.OceanWelcomeBanner.refreshName('Director');
  const roleEl = $('#profile-bar-role');
  if (roleEl) roleEl.textContent = 'School director';

  if (window.OceanSettings && typeof window.OceanSettings.syncProfileBar === 'function') {
    window.OceanSettings.syncProfileBar();
    if (barName) barName.textContent = staff.display_name || 'Director';
  }

  initNav();
  const ghostLockBtn = $('#dir-ghost-lock-all');
  const ghostUnlockBtn = $('#dir-ghost-unlock-all');
  if (ghostLockBtn && !ghostLockBtn.dataset.bound) {
    ghostLockBtn.dataset.bound = '1';
    ghostLockBtn.addEventListener('click', function () {
      setGhostStaffLock(true);
    });
  }
  if (ghostUnlockBtn && !ghostUnlockBtn.dataset.bound) {
    ghostUnlockBtn.dataset.bound = '1';
    ghostUnlockBtn.addEventListener('click', function () {
      setGhostStaffLock(false);
    });
  }
  if (isGhostAdmin()) refreshGhostStaffLockUi();
  loadSchoolReportingContext().then((ctx) => {
    if (ctx) {
      if ($('#filter-term')) $('#filter-term').value = String(ctx.term || 1);
      if ($('#filter-period')) $('#filter-period').value = String(ctx.period || 'mid');
      buildYearFilterOptions(ctx.year || new Date().getFullYear());
    } else {
      buildYearFilterOptions(new Date().getFullYear());
    }
    switchTab('overview');
    loadLearnersDistribution();
    initLearnerMovementPanel();
    initClassCreationPanel();
    loadNotes();
  loadNotesTabEditor();
  });
})();
