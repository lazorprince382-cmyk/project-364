(function () {
  const TOKEN_KEY = 'ocean_staff_token';
  const titles = {
    daycare: 'Day Care',
    baby: 'Baby Class',
    middle: 'Middle Class',
    top: 'Top Class',
    primary1: 'Primary One',
    primary2: 'Primary Two',
  };
  const streamLabels = {
    waves: 'Waves',
    pearls: 'Pearls',
    dolphins: 'Dolphins',
    whales: 'Whales',
  };

  function labelClass(cl, st) {
    const t = titles[cl] || cl;
    if (st) return t + ' — ' + (streamLabels[st] || st);
    return t;
  }

  function buildClassRows() {
    const rows = [];
    if (!window.OCEAN_CLASSES) return rows;
    OCEAN_CLASSES.forEach(function (cfg) {
      if (cfg.id === 'skills') return;
      if (cfg.needsStream && cfg.streams) {
        cfg.streams.forEach(function (s) {
          rows.push({ classLevel: cfg.id, stream: s.id, label: labelClass(cfg.id, s.id) });
        });
      } else {
        rows.push({ classLevel: cfg.id, stream: '', label: labelClass(cfg.id, '') });
      }
    });
    return rows;
  }

  const CLASS_ROWS = buildClassRows();
  const REPORT_FONT_FAMILIES = {
    default: '',
    calibri: 'Calibri, "Segoe UI", Arial, sans-serif',
    georgia: 'Georgia, "Times New Roman", serif',
    verdana: 'Verdana, Geneva, sans-serif',
    trebuchet: '"Trebuchet MS", "Segoe UI", sans-serif',
    times: '"Times New Roman", Times, serif',
  };
  const notifKey = 'ocean_head_notify';
  let headReportsChart = null;
  let headReportGroups = [];
  let headReportLearners = [];
  let gradingBands = [];

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function normalizeBandsClient(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .map(function (b) {
        return {
          min: Number(b.min),
          max: Number(b.max),
          agg: String(b.agg || '').trim(),
          remark: String(b.remark || '').trim(),
        };
      })
      .filter(function (b) {
        return !Number.isNaN(b.min) && !Number.isNaN(b.max) && b.min <= b.max;
      });
  }

  function gradeFromPercentClient(percent, bands) {
    const n = Number(percent);
    if (Number.isNaN(n)) return { agg: '', remark: '' };
    for (let i = 0; i < bands.length; i += 1) {
      const b = bands[i];
      if (n >= b.min && n <= b.max) return { agg: b.agg, remark: b.remark };
    }
    return { agg: '', remark: '' };
  }

  async function loadGradingBands() {
    try {
      const res = await fetch('/api/settings/grading-scale');
      const data = res.ok ? await res.json().catch(function () { return {}; }) : {};
      gradingBands = normalizeBandsClient(data.bands || []);
    } catch (_) {
      gradingBands = [];
    }
  }

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
        saveNotifs(
          loadNotifs().map(function (n) {
            return Object.assign({}, n, { read: true });
          })
        );
      });
  }

  function dashboardHref(cl, stream) {
    const q = new URLSearchParams({ class: cl });
    if (stream) q.set('stream', stream);
    return '/dashboard.html?' + q.toString();
  }

  function classSignInHref(cl, stream) {
    const target = dashboardHref(cl, stream);
    const auth = window.OceanStaffAuth;
    if (auth && auth.classWorkspaceSignInHref) {
      return auth.classWorkspaceSignInHref(target, 'class');
    }
    return '/classes.html?signin=class&next=' + encodeURIComponent(target);
  }

  function authHeaders() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  let classCatalogRows = [];
  async function loadClassCatalog() {
    const res = await fetch('/api/class-catalog');
    if (!res.ok) return [];
    classCatalogRows = await res.json().catch(() => []);
    return classCatalogRows;
  }

  function renderHeadClassCatalogList() {
    const body = document.getElementById('hd-cc-class-list');
    if (!body) return;
    body.innerHTML = '';
    (classCatalogRows || []).forEach(function (row) {
      const tr = document.createElement('tr');
      const subjects = Array.isArray(row.subjects) ? row.subjects.join(', ') : '—';
      const typeLabel = row.isCustom ? 'Custom' : 'Built-in';
      const tdDel = document.createElement('td');
      if (row.isCustom) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn danger';
        btn.textContent = 'Delete';
        btn.setAttribute('data-id', row.id);
        btn.addEventListener('click', async function () {
          const classId = btn.getAttribute('data-id');
          const label = row.title || classId;
          if (!window.confirm('Delete class "' + label + '"? This only works when no learners remain in that class.')) {
            return;
          }
          const createStatus = document.getElementById('hd-cc-status');
          if (createStatus) createStatus.textContent = 'Deleting...';
          const res = await fetch('/api/class-catalog/' + encodeURIComponent(classId), {
            method: 'DELETE',
            headers: { ...authHeaders() },
          });
          const j = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) {
            if (createStatus) createStatus.textContent = j.error || 'Could not delete class.';
            return;
          }
          if (createStatus) createStatus.textContent = 'Deleted ' + label + '.';
          await loadClassCatalog();
          renderHeadClassCatalogList();
          const fromClassEl = document.getElementById('hd-mv-from-class');
          const targetClassEl = document.getElementById('hd-mv-target-class');
          const fromStreamEl = document.getElementById('hd-mv-from-stream');
          const targetStreamEl = document.getElementById('hd-mv-target-stream');
          if (fromClassEl) fillClassOptions(fromClassEl);
          if (targetClassEl) fillClassOptions(targetClassEl);
          if (fromStreamEl && fromClassEl) fillStreamOptions(fromStreamEl, fromClassEl.value, true);
          if (targetStreamEl && targetClassEl) fillStreamOptions(targetStreamEl, targetClassEl.value, true);
          await loadHeadMovementLearners();
          loadOverviewTable();
          refreshOverviewStats();
        });
        tdDel.appendChild(btn);
      } else {
        tdDel.textContent = '—';
      }
      tr.innerHTML =
        '<td>' +
        escapeHtml(row.title || row.id) +
        '</td><td>' +
        escapeHtml(row.id) +
        '</td><td>' +
        escapeHtml(typeLabel) +
        '</td><td>' +
        escapeHtml(subjects) +
        '</td>';
      tr.appendChild(tdDel);
      body.appendChild(tr);
    });
  }
  function fillClassOptions(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    (classCatalogRows || []).forEach(function (r) {
      const o = document.createElement('option');
      o.value = String(r.id || '');
      o.textContent = r.title || r.id;
      selectEl.appendChild(o);
    });
  }
  function fillStreamOptions(selectEl, classId, includeEmpty) {
    if (!selectEl) return;
    const row = (classCatalogRows || []).find(function (x) {
      return String(x.id) === String(classId);
    });
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
    streams.forEach(function (s) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      selectEl.appendChild(o);
    });
  }
  async function loadHeadMovementLearners() {
    const cl = document.getElementById('hd-mv-from-class');
    const st = document.getElementById('hd-mv-from-stream');
    const list = document.getElementById('hd-mv-learners');
    if (!cl || !st || !list || !cl.value) return;
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', cl.value);
    if (st.value) u.searchParams.set('stream', st.value);
    const res = await fetch(u.toString());
    if (!res.ok) return;
    const rows = await res.json().catch(function () {
      return [];
    });
    list.innerHTML = '';
    (rows || []).forEach(function (r) {
      const o = document.createElement('option');
      o.value = String(r.id);
      o.textContent = (r.full_name || 'Learner') + (r.reg_no ? ' · ' + r.reg_no : '');
      list.appendChild(o);
    });
  }
  async function initMovementAndClassTools() {
    await loadClassCatalog();
    renderHeadClassCatalogList();
    const fromClass = document.getElementById('hd-mv-from-class');
    const fromStream = document.getElementById('hd-mv-from-stream');
    const targetClass = document.getElementById('hd-mv-target-class');
    const targetStream = document.getElementById('hd-mv-target-stream');
    const year = document.getElementById('hd-mv-year');
    const applyBtn = document.getElementById('hd-mv-apply');
    const statusEl = document.getElementById('hd-mv-status');
    const createBtn = document.getElementById('hd-cc-create');
    const createStatus = document.getElementById('hd-cc-status');
    if (!fromClass || !fromStream || !targetClass || !targetStream || !applyBtn || !createBtn) return;
    if (year && !year.value) year.value = String(new Date().getFullYear() + 1);
    fillClassOptions(fromClass);
    fillClassOptions(targetClass);
    fillStreamOptions(fromStream, fromClass.value, true);
    fillStreamOptions(targetStream, targetClass.value, true);
    fromClass.addEventListener('change', function () {
      fillStreamOptions(fromStream, fromClass.value, true);
      loadHeadMovementLearners();
    });
    fromStream.addEventListener('change', loadHeadMovementLearners);
    targetClass.addEventListener('change', function () {
      fillStreamOptions(targetStream, targetClass.value, true);
    });
    await loadHeadMovementLearners();

    applyBtn.addEventListener('click', async function () {
      const ids = Array.from((document.getElementById('hd-mv-learners') || {}).selectedOptions || []).map(function (
        o
      ) {
        return Number(o.value);
      });
      if (!ids.length) {
        if (statusEl) statusEl.textContent = 'Select learner(s) first.';
        return;
      }
      if (statusEl) statusEl.textContent = 'Applying...';
      const res = await fetch('/api/learners/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          studentIds: ids,
          action: document.getElementById('hd-mv-action') ? document.getElementById('hd-mv-action').value : 'transfer',
          targetClassLevel: targetClass.value,
          targetStream: targetStream.value,
          effectiveYear: Number(year && year.value ? year.value : ''),
        }),
      });
      const j = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        if (statusEl) statusEl.textContent = j.error || 'Could not move learners.';
        return;
      }
      if (statusEl) statusEl.textContent = 'Moved ' + (j.moved || 0) + ' learner(s).';
      await loadHeadMovementLearners();
      loadOverviewTable();
      refreshOverviewStats();
    });

    createBtn.addEventListener('click', async function () {
      const id = (document.getElementById('hd-cc-id') || {}).value || '';
      const title = (document.getElementById('hd-cc-title') || {}).value || '';
      const subjectsRaw = (document.getElementById('hd-cc-subjects') || {}).value || '';
      const subjects = subjectsRaw
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(function (s, i, arr) {
          return s && arr.indexOf(s) === i;
        });
      if (createStatus) createStatus.textContent = 'Creating...';
      const res = await fetch('/api/class-catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: id.trim(), title: title.trim(), isPrimary: true, subjects: subjects }),
      });
      const j = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        if (createStatus) createStatus.textContent = j.error || 'Could not create class.';
        return;
      }
      if (createStatus) createStatus.textContent = 'Created ' + (j.title || j.id) + '.';
      if (document.getElementById('hd-cc-id')) document.getElementById('hd-cc-id').value = '';
      if (document.getElementById('hd-cc-title')) document.getElementById('hd-cc-title').value = '';
      if (document.getElementById('hd-cc-subjects')) document.getElementById('hd-cc-subjects').value = '';
      await loadClassCatalog();
      renderHeadClassCatalogList();
      fillClassOptions(fromClass);
      fillClassOptions(targetClass);
      fillStreamOptions(fromStream, fromClass.value, true);
      fillStreamOptions(targetStream, targetClass.value, true);
      await loadHeadMovementLearners();
      loadOverviewTable();
      refreshOverviewStats();
    });
  }

  async function refreshOverviewStats() {
    let rows = [];
    try {
      const res = await fetch('/api/students/count-summary');
      if (res.ok) rows = await res.json();
    } catch (_) {}
    let total = 0;
    rows.forEach(function (r) {
      total += Number(r.count) || 0;
    });
    const elL = document.getElementById('stat-head-learners');
    const elG = document.getElementById('stat-head-groups');
    if (elL) elL.textContent = String(total);
    if (elG) elG.textContent = String(CLASS_ROWS.length);
  }

  function selectedHeadReportYear() {
    const ySel = document.getElementById('hd-r-year');
    const yCustom = document.getElementById('hd-r-year-custom');
    if (!ySel) return new Date().getFullYear();
    if (ySel.value === '__custom__') {
      const y = Number(yCustom && yCustom.value ? yCustom.value : '');
      return Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
    }
    const yy = Number(ySel.value);
    return Number.isFinite(yy) ? yy : new Date().getFullYear();
  }

  function buildHeadYearOptions(defaultYear) {
    const ySel = document.getElementById('hd-r-year');
    const yCustom = document.getElementById('hd-r-year-custom');
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

  function setHeadReportBar(id, pct, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.width = Math.min(100, Math.max(0, Number(pct) || 0)) + '%';
    el.style.background = color;
  }

  function renderHeadDistributionChart(dist) {
    const canvas = document.getElementById('hd-chart-distribution');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = (dist || []).map(function (r) {
      return labelClass(r.class_level, r.stream || '');
    });
    const data = (dist || []).map(function (r) {
      return Number(r.count) || 0;
    });
    const colors = ['#2563eb', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#22d3ee', '#84cc16'];
    if (headReportsChart) headReportsChart.destroy();
    headReportsChart = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{ data: data, backgroundColor: labels.map(function (_x, i) { return colors[i % colors.length]; }), borderWidth: 2, borderColor: '#0f172a' }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { color: '#cbd5e1', font: { size: 11 } } },
        },
      },
    });
  }

  function renderHeadReports(data) {
    const snap = (data && data.reportingSnapshot) || {};
    const commentsPct = Number(snap.percentLearnersWithComment || 0);
    const marksPct = Number(snap.percentLearnersWithMark || 0);
    const combined = Math.round((commentsPct + marksPct) / 2);
    setHeadReportBar('hd-r-bar-comments', commentsPct, '#3b82f6');
    setHeadReportBar('hd-r-bar-marks', marksPct, '#22c55e');
    setHeadReportBar('hd-r-bar-combined', combined, '#f97316');
    const lc = document.getElementById('hd-r-lbl-comments');
    const lm = document.getElementById('hd-r-lbl-marks');
    const lsum = document.getElementById('hd-r-lbl-combined');
    if (lc) lc.textContent = commentsPct + '%';
    if (lm) lm.textContent = marksPct + '%';
    if (lsum) lsum.textContent = combined + '%';
    renderHeadDistributionChart((data && data.learnerDistribution) || []);

    const schoolBody = document.getElementById('hd-r-table-school-subjects');
    if (schoolBody) {
      schoolBody.innerHTML = '';
      ((data && data.subjectProgressSchool) || []).forEach(function (row) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(row.subject) + '</td><td>' + row.entered + '</td><td>' + row.total + '</td><td>' + row.percent + '%</td>';
        schoolBody.appendChild(tr);
      });
    }

    const classContainer = document.getElementById('hd-r-class-subject-blocks');
    if (classContainer) {
      classContainer.innerHTML = '';
      ((data && data.subjectProgressByClass) || []).forEach(function (grp) {
        const details = document.createElement('details');
        details.className = 'dir-class-block';
        const summary = document.createElement('summary');
        summary.textContent = labelClass(grp.class_level, grp.stream || '');
        details.appendChild(summary);
        const table = document.createElement('table');
        table.className = 'data';
        table.innerHTML =
          '<thead><tr><th>Subject</th><th>Entered</th><th>Class size</th><th>%</th></tr></thead><tbody></tbody>';
        const tb = table.querySelector('tbody');
        (grp.subjects || []).forEach(function (row) {
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
    }
    renderHeadWorkflowHealth(data);
    renderHeadStaffCoverage();
  }

  function groupedHeadClassRows(rows) {
    const map = {};
    (rows || []).forEach(function (r) {
      const k = String(r.class_level || '').trim() + '|' + String(r.stream || '').trim();
      if (!map[k]) map[k] = { class_level: r.class_level, stream: r.stream || '' };
    });
    return Object.values(map).sort(function (a, b) {
      const la = humanClassLevel(a.class_level) + (a.stream ? ' ' + a.stream : '');
      const lb = humanClassLevel(b.class_level) + (b.stream ? ' ' + b.stream : '');
      return la.localeCompare(lb);
    });
  }

  async function loadHeadReportExplorerGroups() {
    try {
      const res = await fetch('/api/students/count-summary', { headers: { ...authHeaders() } });
      if (res.ok) {
        const rows = await res.json().catch(function () { return []; });
        headReportGroups = groupedHeadClassRows(rows);
      }
    } catch (_) {}
    if (!headReportGroups.length) {
      headReportGroups = CLASS_ROWS.map(function (r) {
        return { class_level: r.classLevel, stream: r.stream || '' };
      });
    }
    fillHeadReportExplorerClassOptions();
    await loadHeadReportExplorerLearners();
  }

  function fillHeadReportExplorerClassOptions() {
    const classSel = document.getElementById('hd-rp-class');
    const streamSel = document.getElementById('hd-rp-stream');
    if (!classSel || !streamSel) return;
    const classes = {};
    headReportGroups.forEach(function (g) {
      const cl = String(g.class_level || '').trim();
      if (!cl) return;
      if (!classes[cl]) classes[cl] = [];
      classes[cl].push(String(g.stream || ''));
    });
    classSel.innerHTML = '';
    Object.keys(classes).forEach(function (cl) {
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
      streams.sort().forEach(function (s) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s || '(none)';
        streamSel.appendChild(o);
      });
    }
    classSel.addEventListener('change', function () {
      refillStreams();
      loadHeadReportExplorerLearners();
    });
    streamSel.addEventListener('change', function () {
      loadHeadReportExplorerLearners();
    });
    refillStreams();
  }

  async function loadHeadReportExplorerLearners() {
    const classSel = document.getElementById('hd-rp-class');
    const streamSel = document.getElementById('hd-rp-stream');
    const learnerSel = document.getElementById('hd-rp-learner');
    if (!classSel || !streamSel || !learnerSel) return;
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', classSel.value);
    if (streamSel.value) u.searchParams.set('stream', streamSel.value);
    const res = await fetch(u.toString());
    if (!res.ok) return;
    const rows = await res.json().catch(function () { return []; });
    headReportLearners = Array.isArray(rows) ? rows : [];
    learnerSel.innerHTML = '';
    headReportLearners.forEach(function (r) {
      const o = document.createElement('option');
      o.value = String(r.id);
      o.textContent = r.full_name + (r.reg_no ? ' · ' + r.reg_no : '');
      learnerSel.appendChild(o);
    });
  }

  function reportTermHeading(period, term, reportYear) {
    const termWord = { '1': 'ONE', '2': 'TWO', '3': 'THREE' }[String(term)] || String(term);
    const periodWord = period === 'begin' ? 'BEGINNING OF TERM' : period === 'mid' ? 'MID TERM' : 'END TERM';
    return periodWord + ' ' + termWord + ' ' + String(reportYear || new Date().getFullYear());
  }

  function parseAggDigit(agg) {
    const match = String(agg == null ? '' : agg).trim().match(/[1-9]/);
    const x = match ? Number(match[0]) : NaN;
    if (Number.isNaN(x) || x < 1 || x > 9) return null;
    return x;
  }

  const PRIMARY_AGGREGATE_SUBJECT_KEYS = ['mathematics', 'english', 'literacy1a', 'literacy1b'];

  function primarySubjectKey(subject) {
    return String(subject || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function primaryAggregateSubjectRank(subject) {
    return PRIMARY_AGGREGATE_SUBJECT_KEYS.indexOf(primarySubjectKey(subject));
  }

  function isPrimaryAggregateSubject(subject) {
    return primaryAggregateSubjectRank(subject) !== -1;
  }

  function orderedPrimaryAcademicSubjects(subjects, skillList) {
    return (subjects || [])
      .filter(function (s) { return skillList.indexOf(s) === -1; })
      .map(function (subject, index) {
        return { subject: subject, index: index, rank: primaryAggregateSubjectRank(subject) };
      })
      .sort(function (a, b) {
        const ar = a.rank === -1 ? 999 : a.rank;
        const br = b.rank === -1 ? 999 : b.rank;
        if (ar !== br) return ar - br;
        return a.index - b.index;
      })
      .map(function (item) { return item.subject; });
  }

  function primaryAggregateFromMarkRowsLocal(rows, skillList) {
    const grades = [];
    (rows || []).forEach(function (r) {
      if (!isPrimaryAggregateSubject(r.subject)) return;
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

  function primaryGradeScaleHtml() {
    const bands = normalizeBandsClient(gradingBands)
      .slice()
      .sort(function (a, b) { return b.max - a.max; });
    if (!bands.length) return '';
    const rows = [];
    for (let i = 0; i < bands.length; i += 3) {
      const cells = [];
      bands.slice(i, i + 3).forEach(function (band) {
        cells.push(
          '<td>' + escapeHtml(String(band.min) + ' - ' + String(band.max)) + '</td>' +
          '<td title="' + escapeHtml(band.remark || '') + '">' + escapeHtml(band.agg || '') + '</td>'
        );
      });
      while (cells.length < 3) cells.push('<td></td><td></td>');
      rows.push('<tr>' + cells.join('') + '</tr>');
    }
    return '<div class="primary-grade-scale"><h5>GRADING SCALE</h5><table><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function applyExplorerReportSettings(settings, root) {
    if (!settings || !root) return;
    const layout = settings.layout && typeof settings.layout === 'object' ? settings.layout : {};
    const cards = root.querySelectorAll('.baby-report-card, .primary-report-card');
    cards.forEach(function (card) {
      card.style.fontFamily = REPORT_FONT_FAMILIES[settings.fontFamily] || '';
      if (settings.fontScale != null) card.style.setProperty('--rp-font-scale', String(settings.fontScale));
      if (layout.badgeScale != null) card.style.setProperty('--rp-badge-scale', String(layout.badgeScale));
      if (layout.commentGapMm != null) card.style.setProperty('--rp-comment-gap-mm', String(layout.commentGapMm));
      if (layout.metaScale != null) card.style.setProperty('--rp-meta-scale', String(layout.metaScale));
      if (layout.metaOffsetIn != null) card.style.setProperty('--rp-meta-offset-in', String(layout.metaOffsetIn));
      if (layout.metaWidthIn != null) card.style.setProperty('--rp-meta-width-in', String(layout.metaWidthIn));
      if (layout.photoScale != null) card.style.setProperty('--rp-photo-scale', String(layout.photoScale));
      if (layout.photoOffsetXIn != null) card.style.setProperty('--rp-photo-offset-x-in', String(layout.photoOffsetXIn));
      if (layout.photoOffsetYIn != null) card.style.setProperty('--rp-photo-offset-y-in', String(layout.photoOffsetYIn));
      if (layout.titleScale != null) card.style.setProperty('--rp-title-scale', String(layout.titleScale));
      if (layout.headingScale != null) card.style.setProperty('--rp-heading-scale', String(layout.headingScale));
      if (layout.commentFontScale != null) card.style.setProperty('--rp-comment-scale', String(layout.commentFontScale));
      const bodyBlock = card.querySelector('.baby-subjects-grid, .primary-report-body');
      if (bodyBlock) {
        bodyBlock.style.transformOrigin = 'top left';
        bodyBlock.style.transform = 'translate(' + Number(layout.subjectGridOffsetX || 0) + 'px, ' + Number(layout.subjectGridOffsetY || 0) + 'px)';
      }
      const commentsBlock = card.querySelector('.baby-bottom-comments, .primary-comments, .report-comments');
      if (commentsBlock) {
        commentsBlock.style.transformOrigin = 'top left';
        commentsBlock.style.transform = 'translate(' + Number(layout.commentsOffsetX || 0) + 'px, ' + Number(layout.commentsOffsetY || 0) + 'px)';
      }
    });
  }

  function normalizeExplorerCommentSignatures(root) {
    if (!root) return;
    root.querySelectorAll('.baby-bottom-comments').forEach(function (block) {
      if (block.querySelector('.baby-comment-sign-row')) return;
      const classComment = Array.prototype.find.call(block.children, function (el) {
        return el.tagName === 'P' && !el.classList.contains('baby-next-term');
      });
      const oldHeadRow = block.querySelector(':scope > .baby-head-row');
      const headComment = oldHeadRow && oldHeadRow.querySelector(':scope > p');
      const signatures = oldHeadRow ? oldHeadRow.querySelectorAll('.baby-sign-row') : [];
      if (!classComment || !headComment || signatures.length < 2) return;
      const classEntry = document.createElement('div');
      classEntry.className = 'baby-comment-sign-row';
      block.insertBefore(classEntry, classComment);
      classEntry.appendChild(classComment);
      classEntry.appendChild(signatures[0]);
      const headEntry = document.createElement('div');
      headEntry.className = 'baby-comment-sign-row baby-head-row';
      block.insertBefore(headEntry, oldHeadRow);
      headEntry.appendChild(headComment);
      headEntry.appendChild(signatures[1]);
      oldHeadRow.remove();
    });
  }

  function buildPrimaryExplorerReportHtml(student, classLevel, stream, term, period, byC, byM, ctBy, headBy, nextTermBegins, comparisonByM) {
    const skillList = window.OCEAN_SKILL_SUBJECTS || [];
    const subjects = (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS[classLevel]) || [];
    const classLabel = humanClassLevel(classLevel) + (stream ? ' (' + stream + ')' : '');
    const termLabel = reportTermHeading(period, term, new Date().getFullYear());
    const academicSubjects = orderedPrimaryAcademicSubjects(subjects, skillList);
    const skillSubjects = subjects.filter(function (s) { return skillList.indexOf(s) !== -1; });
    const beginByM = comparisonByM && comparisonByM.__beginByM ? comparisonByM.__beginByM : null;
    const hasThreeTerm = false;
    const hasComparison = (period === 'mid' || period === 'end') && comparisonByM;
    const firstPeriodLabel = hasThreeTerm ? 'Beginning Of Term' : period === 'end' ? 'Mid Term' : 'Beginning Of Term';
    const secondPeriodLabel = hasThreeTerm ? 'Mid Term' : period === 'end' ? 'End Of Term' : 'Mid Term';
    const thirdPeriodLabel = 'End Of Term';
    function reportMarkRow(map, sub) {
      const m = (map && map[student.id + '\t' + sub]) || {};
      const scored = m.marks_scored != null ? Number(m.marks_scored) : null;
      const countsForAggregate = isPrimaryAggregateSubject(sub);
      const grade = Number.isFinite(scored) && gradingBands.length
        ? gradeFromPercentClient(scored, gradingBands)
        : { agg: m.agg || '', remark: m.remark || '' };
      return {
        subject: sub,
        scored: scored,
        agg: countsForAggregate ? grade.agg || '' : '',
        remark: grade.remark || m.remark || '',
        initials: m.initials || '',
        countsForAggregate: countsForAggregate,
      };
    }
    const academicRows = academicSubjects.map(function (sub) { return reportMarkRow(byM, sub); });
    const beginRows = hasThreeTerm
      ? academicSubjects.map(function (sub) { return reportMarkRow(beginByM, sub); })
      : [];
    const comparisonRows = hasComparison
      ? academicSubjects.map(function (sub) { return reportMarkRow(comparisonByM, sub); })
      : [];
    const aggregateRows = academicRows.filter(function (r) { return r.countsForAggregate; });
    const comparisonAggregateRows = comparisonRows.filter(function (r) { return r.countsForAggregate; });
    const beginAggregateRows = beginRows.filter(function (r) { return r.countsForAggregate; });
    const totalScored = aggregateRows.reduce(function (sum, r) { return sum + (Number.isFinite(r.scored) ? r.scored : 0); }, 0);
    const comparisonTotalScored = comparisonAggregateRows.reduce(function (sum, r) { return sum + (Number.isFinite(r.scored) ? r.scored : 0); }, 0);
    const beginTotalScored = beginAggregateRows.reduce(function (sum, r) { return sum + (Number.isFinite(r.scored) ? r.scored : 0); }, 0);
    const aggregateInfo = primaryAggregateFromMarkRowsLocal(aggregateRows.map(function (r) { return { subject: r.subject, agg: r.agg }; }), skillList);
    const comparisonAggregateInfo = primaryAggregateFromMarkRowsLocal(comparisonAggregateRows.map(function (r) { return { subject: r.subject, agg: r.agg }; }), skillList);
    const beginAggregateInfo = primaryAggregateFromMarkRowsLocal(beginAggregateRows.map(function (r) { return { subject: r.subject, agg: r.agg }; }), skillList);
    function periodCells(row) {
      return '<td class="num">100</td><td class="num">' + escapeHtml(Number.isFinite(row.scored) ? String(row.scored) : '') + '</td><td class="num">' + escapeHtml(row.agg || '') + '</td><td>' + escapeHtml(row.remark || '') + '</td>';
    }
    const marksRowsHtml = academicRows.map(function (r, rowIndex) {
      const begin = beginRows[rowIndex] || {};
      const first = comparisonRows[rowIndex] || {};
      return '<tr><td>' + escapeHtml(r.subject) + '</td>' +
        (hasThreeTerm ? periodCells(begin) : '') +
        (hasComparison ? periodCells(first) : '') +
        periodCells(r) +
        '<td class="num">' + escapeHtml(r.initials || '') + '</td></tr>';
    }).join('');
    beginRows.length = beginAggregateRows.length;
    comparisonRows.length = comparisonAggregateRows.length;
    academicRows.length = aggregateRows.length;
    const totalRow = hasThreeTerm
      ? '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(beginRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(beginTotalScored)) + '</td><td class="num">' + escapeHtml(beginAggregateInfo.sum != null ? String(beginAggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(beginAggregateInfo.division || '-') + '</td><td class="num">' + escapeHtml(String(comparisonRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(comparisonTotalScored)) + '</td><td class="num">' + escapeHtml(comparisonAggregateInfo.sum != null ? String(comparisonAggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(comparisonAggregateInfo.division || '-') + '</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '-') + '</td><td></td></tr>'
      : hasComparison
      ? '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(comparisonRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(comparisonTotalScored)) + '</td><td class="num">' + escapeHtml(comparisonAggregateInfo.sum != null ? String(comparisonAggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(comparisonAggregateInfo.division || '') + '</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '') + '</td><td></td></tr>'
      : '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '') + '</td><td></td></tr>';
    const skillsRowsHtml = skillSubjects.map(function (sub) {
      return '<tr><td>' + escapeHtml(sub) + '</td><td>' + escapeHtml(byC[student.id + '\t' + sub] || '') + '</td></tr>';
    }).join('');
    const comparisonColGroup = hasThreeTerm
      ? '<colgroup><col class="col-subject" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-initials" /></colgroup>'
      : '<colgroup><col class="col-subject" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-initials" /></colgroup>';
    const comparisonHead = hasThreeTerm
      ? '<thead><tr class="period-head"><th rowspan="2">Subject</th><th colspan="4">' + escapeHtml(firstPeriodLabel) + '</th><th colspan="4">' + escapeHtml(secondPeriodLabel) + '</th><th colspan="4">' + escapeHtml(thirdPeriodLabel) + '</th><th rowspan="2">Initials</th></tr><tr class="period-subhead"><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th></tr></thead>'
      : '<thead><tr class="period-head"><th rowspan="2">Subject</th><th colspan="4">' + escapeHtml(firstPeriodLabel) + '</th><th colspan="4">' + escapeHtml(secondPeriodLabel) + '</th><th rowspan="2">Initials</th></tr><tr class="period-subhead"><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th></tr></thead>';
    return '<div class="primary-report-card"><img class="baby-edge baby-edge-top-left" src="/images/reports/baby/edge.png" alt="" /><img class="baby-edge baby-edge-bottom-right" src="/images/reports/baby/edge.png" alt="" /><div class="primary-report-head"><img class="baby-school-title-image" src="/images/reports/baby/school-name-mark.png" alt="School name" /><p class="baby-kicker">&ldquo;Up with skills&rdquo;</p><p class="baby-term">' + escapeHtml(termLabel) + '</p><p class="baby-term baby-term-report">REPORT</p><div class="baby-head-line"></div><img class="baby-student-photo" src="' + escapeHtml(student.passport_path || '/images/ocean-school-logo.png') + '" alt="" /><img class="baby-badge" src="/images/reports/baby/badge.png" alt="" /><div class="baby-meta"><p><strong>NAME:</strong> <span>' + escapeHtml((student.full_name || '').toUpperCase()) + '</span></p><p><strong>CLASS:</strong> <span>' + escapeHtml(classLabel.toUpperCase()) + '</span></p><p><strong>REG NO:</strong> <span>' + escapeHtml((student.reg_no || '').toUpperCase()) + '</span></p></div></div><div class="primary-report-body"><table class="primary-marks-table' + (hasComparison ? ' primary-marks-table-comparison' : '') + (hasThreeTerm ? ' primary-marks-table-three-term' : '') + '">' + (hasComparison ? comparisonColGroup + comparisonHead : '<thead><tr><th>Subject</th><th>F/M</th><th>Marks scored</th><th>Grade</th><th>Remark</th><th>Initials</th></tr></thead>') + '<tbody>' + marksRowsHtml + totalRow + '</tbody></table>' + primaryGradeScaleHtml() + '<h5 class="primary-skill-title">Skills</h5><table class="primary-skill-table"><tbody>' + skillsRowsHtml + '</tbody></table></div><div class="primary-comments"><p><strong>Class teacher\'s comment:</strong> ' + escapeHtml(ctBy[student.id] || '') + '</p><div class="primary-sign-row"><span>Signature:</span><span class="sig-line"></span></div><p><strong>Head teacher\'s comment:</strong> ' + escapeHtml(headBy[student.id] || '') + '</p><div class="primary-sign-row"><span>Signature:</span><span class="sig-line"></span></div>' + (period === 'end' ? '<p class="baby-next-term">Next term begins: <span>' + escapeHtml(nextTermBegins || '') + '</span></p>' : '') + '</div></div>';
  }

  function buildHeadExplorerReportHtml(student, classLevel, stream, term, period, byC, byM, ctBy, headBy, nextTermBegins, comparisonByM) {
    const isPrimary = classLevel === 'primary1' || classLevel === 'primary2';
    const skillList = window.OCEAN_SKILL_SUBJECTS || [];
    const subjects = (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS[classLevel]) || [];
    const classLabel = humanClassLevel(classLevel) + (stream ? ' (' + stream + ')' : '');
    const termLabel = reportTermHeading(period, term, new Date().getFullYear());
    if (isPrimary) {
      return buildPrimaryExplorerReportHtml(student, classLevel, stream, term, period, byC, byM, ctBy, headBy, nextTermBegins, comparisonByM);
      const academicSubjects = orderedPrimaryAcademicSubjects(subjects, skillList);
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
      ? ['Listening and Speaking', 'Drawing and Shading', 'General Knowledge', 'Social Development', 'Rhymes and songs', 'Health Habits']
      : classLevel === 'top'
      ? ['Language Development', 'Health Habits', 'Reading', 'Writing', 'Social Development', 'Numeracy', 'Fashion and Design', 'Bakery', 'Salon', 'Music', 'Computer']
      : ['Reading', 'Writing', 'Numeracy', 'General Knowledge', 'Computer', 'Music', 'Salon', 'Fashion and Design'];
    const subjectIcons = {
      'Language Development': '/images/reports/baby/language-development.png', Reading: '/images/reports/baby/reading.png', Writing: '/images/reports/baby/writing.png',
      Numeracy: '/images/reports/baby/numeracy.png', Computer: '/images/reports/baby/computer.png', Music: '/images/reports/baby/music.png', Salon: '/images/reports/baby/salon.png',
      'Fashion and Design': '/images/reports/baby/fashion-and-design.png', Bakery: '/images/reports/baby/bakery.png', 'Listening and Speaking': '/images/reports/daycare/listening-and-speaking.png',
      'Drawing and Shading': '/images/reports/daycare/drawing-and-shading.png', 'General Knowledge': '/images/reports/daycare/general-knowledge.png', 'Social Development': '/images/reports/daycare/social-development.png',
      'Rhymes and songs': '/images/reports/daycare/rhymes-and-songs.png', 'Health Habits': '/images/reports/daycare/health-habits.png',
    };
    const cards = cardOrder.map(function (sub) {
      const body = byC[student.id + '\t' + sub] || (sub === 'Rhymes and songs' ? byC[student.id + '\t' + ('Rhyth' + 'ms and Songs')] : '') || '—';
      return '<article class="baby-subject-card"><img src="' + escapeHtml(subjectIcons[sub] || '') + '" alt="" /><h5>' + escapeHtml(sub) + '</h5><p>' + escapeHtml(body) + '</p></article>';
    }).join('');
    return '<div class="baby-report-card' + (classLevel === 'middle' ? ' middle-report-card' : '') + (classLevel === 'daycare' ? ' daycare-report-card' : '') + (classLevel === 'top' ? ' top-report-card' : '') + '"><img class="baby-edge baby-edge-top-left" src="/images/reports/baby/edge.png" alt="" /><img class="baby-edge baby-edge-bottom-right" src="/images/reports/baby/edge.png" alt="" /><div class="baby-report-head"><img class="baby-school-title-image" src="/images/reports/baby/school-name-mark.png" alt="School name" /><p class="baby-kicker">“Up with skills”</p><p class="baby-term">' + escapeHtml(termLabel) + '</p><p class="baby-term baby-term-report">REPORT</p><div class="baby-head-line"></div><img class="baby-student-photo" src="' + escapeHtml(student.passport_path || '/images/ocean-school-logo.png') + '" alt="" /><img class="baby-badge" src="/images/reports/baby/badge.png" alt="" /><div class="baby-meta"><p><strong>NAME:</strong> <span>' + escapeHtml((student.full_name || '').toUpperCase()) + '</span></p><p><strong>CLASS:</strong> <span>' + escapeHtml(classLabel.toUpperCase()) + '</span></p><p><strong>REG NO:</strong> <span>' + escapeHtml((student.reg_no || '').toUpperCase()) + '</span></p></div></div><section class="baby-subjects-grid">' + cards + '</section><div class="baby-bottom-comments' + (period !== 'end' ? ' no-next-term' : '') + '"><p><strong>Class teacher\'s comment:</strong> ' + escapeHtml(ctBy[student.id] || '') + '</p><div class="baby-head-row"><p><strong>Head caregiver\'s comment:</strong> ' + escapeHtml(headBy[student.id] || '') + '</p><div class="baby-signatures-stack"><div class="baby-sign-row"><span>Signature:</span><span class="sig-line"></span></div><div class="baby-sign-row"><span>Signature:</span><span class="sig-line"></span></div></div></div>' + (period === 'end' ? '<p class="baby-next-term">Next term begins: <span>' + escapeHtml(nextTermBegins || '—') + '</span></p>' : '') + '</div></div>';
  }

  async function loadHeadReportExplorerData() {
    const classSel = document.getElementById('hd-rp-class');
    const streamSel = document.getElementById('hd-rp-stream');
    const termSel = document.getElementById('hd-rp-term');
    const periodSel = document.getElementById('hd-rp-period');
    const learnerSel = document.getElementById('hd-rp-learner');
    const outVal = document.getElementById('hd-rp-validation');
    const outPrev = document.getElementById('hd-rp-preview');
    const status = document.getElementById('hd-rp-status');
    if (!classSel || !streamSel || !termSel || !periodSel || !learnerSel || !outVal || !outPrev || !status) return;
    const cl = classSel.value;
    const stream = streamSel.value;
    const term = termSel.value;
    const period = periodSel.value;
    const sid = learnerSel.value;
    status.textContent = 'Loading...';
    const comparisonPeriod = (cl === 'primary1' || cl === 'primary2') && period === 'mid'
      ? 'begin'
      : (cl === 'primary1' || cl === 'primary2') && period === 'end'
      ? 'mid'
      : '';
    const beginComparisonPeriod = (cl === 'primary1' || cl === 'primary2') && period === 'end' ? 'begin' : '';
    const qBase = 'classLevel=' + encodeURIComponent(cl) + '&stream=' + encodeURIComponent(stream) + '&term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(period);
    const qComparison = comparisonPeriod
      ? 'classLevel=' + encodeURIComponent(cl) + '&stream=' + encodeURIComponent(stream) + '&term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(comparisonPeriod)
      : '';
    const qBeginComparison = beginComparisonPeriod
      ? 'classLevel=' + encodeURIComponent(cl) + '&stream=' + encodeURIComponent(stream) + '&term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(beginComparisonPeriod)
      : '';
    if ((cl === 'primary1' || cl === 'primary2') && !gradingBands.length) await loadGradingBands();
    const [valRes, comRes, marksRes, headRes, ctRes, comparisonMarksRes, beginComparisonMarksRes] = await Promise.all([
      fetch('/api/report-validate?' + qBase),
      fetch('/api/comments?' + qBase),
      fetch('/api/marks?' + qBase),
      fetch('/api/head-comments?' + qBase),
      fetch('/api/class-teacher-comments?' + qBase),
      comparisonPeriod ? fetch('/api/marks?' + qComparison) : Promise.resolve(null),
      beginComparisonPeriod ? fetch('/api/marks?' + qBeginComparison) : Promise.resolve(null),
    ]);
    if (!valRes.ok) {
      status.textContent = 'Could not load report data.';
      return;
    }
    const val = await valRes.json().catch(function () { return {}; });
    const comments = comRes.ok ? await comRes.json().catch(function () { return []; }) : [];
    const marks = marksRes.ok ? await marksRes.json().catch(function () { return []; }) : [];
    const comparisonMarks = comparisonMarksRes && comparisonMarksRes.ok ? await comparisonMarksRes.json().catch(function () { return []; }) : [];
    const beginComparisonMarks = beginComparisonMarksRes && beginComparisonMarksRes.ok ? await beginComparisonMarksRes.json().catch(function () { return []; }) : [];
    const head = headRes.ok ? await headRes.json().catch(function () { return []; }) : [];
    const ct = ctRes.ok ? await ctRes.json().catch(function () { return []; }) : [];
    const learnerRow = (val.learners || []).find(function (x) { return String(x.student_id) === String(sid); });
    outVal.innerHTML =
      '<p class="dir-muted" style="margin-bottom:0.45rem">Complete learners: <strong>' + (val.completeLearners || 0) + '/' + (val.totalLearners || 0) + '</strong></p>' +
      '<p style="margin:0;font-size:0.86rem">' +
      (learnerRow ? (learnerRow.complete ? '<span style="color:#22c55e">This learner is complete.</span>' : '<span style="color:#f59e0b">Missing: ' + escapeHtml((learnerRow.missing || []).join(', ')) + '</span>') : 'Select learner') +
      '</p>';
    const student = headReportLearners.find(function (r) { return String(r.id) === String(sid); });
    const byC = {};
    const byM = {};
    const comparisonByM = {};
    const beginComparisonByM = {};
    const ctBy = {};
    const headBy = {};
    (comments || []).forEach(function (r) { if (String(r.student_id) === String(sid)) byC[r.student_id + '\t' + r.subject] = r.body || ''; });
    (marks || []).forEach(function (r) { if (String(r.student_id) === String(sid)) byM[r.student_id + '\t' + r.subject] = r; });
    (comparisonMarks || []).forEach(function (r) { if (String(r.student_id) === String(sid)) comparisonByM[r.student_id + '\t' + r.subject] = r; });
    (beginComparisonMarks || []).forEach(function (r) { if (String(r.student_id) === String(sid)) beginComparisonByM[r.student_id + '\t' + r.subject] = r; });
    if (beginComparisonPeriod) comparisonByM.__beginByM = beginComparisonByM;
    (ct || []).forEach(function (r) { if (String(r.student_id) === String(sid)) ctBy[r.student_id] = r.body || ''; });
    (head || []).forEach(function (r) { if (String(r.student_id) === String(sid)) headBy[r.student_id] = r.body || ''; });
    let nextTermBegins = '';
    let reportSettings = null;
    try {
      const su = new URL('/api/report-settings', window.location.origin);
      su.searchParams.set('classLevel', cl);
      if (stream) su.searchParams.set('stream', stream);
      if (sid) su.searchParams.set('studentId', sid);
      const sr = await fetch(su.toString());
      if (sr.ok) {
        const sj = await sr.json().catch(function () { return {}; });
        reportSettings = sj;
        nextTermBegins = sj.nextTermBegins || '';
      }
    } catch (_) {}
    outPrev.innerHTML = student
      ? buildHeadExplorerReportHtml(student, cl, stream, term, period, byC, byM, ctBy, headBy, nextTermBegins, comparisonPeriod ? comparisonByM : null)
      : '<p class="dir-muted">Select learner.</p>';
    applyExplorerReportSettings(reportSettings, outPrev);
    normalizeExplorerCommentSignatures(outPrev);
    status.textContent = 'Loaded.';
  }

  async function renderHeadWorkflowHealth(data) {
    const body = document.getElementById('hd-r-workflow-tbody');
    const alerts = document.getElementById('hd-r-health-alerts');
    if (!body || !alerts) return;
    const groups = (data && data.learnerDistribution ? data.learnerDistribution : []).map(function (r) {
      return {
        class_level: r.class_level,
        stream: r.stream || '',
        label: labelClass(r.class_level, r.stream || ''),
      };
    });
    if (!groups.length) {
      body.innerHTML = '<tr><td colspan="4">No class groups yet.</td></tr>';
      alerts.innerHTML = '<li><div>Register learners to start workflow checks.</div></li>';
      return;
    }
    const termEl = document.getElementById('hd-r-term');
    const periodEl = document.getElementById('hd-r-period');
    const term = Number((data && data.term) || (termEl && termEl.value) || 1);
    const period = String((data && data.period) || (periodEl && periodEl.value) || 'mid');

    const checks = await Promise.all(
      groups.map(async function (g) {
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
          const wf = wfRes.ok ? await wfRes.json().catch(function () { return {}; }) : {};
          const val = valRes.ok ? await valRes.json().catch(function () { return {}; }) : {};
          const total = Number(val.totalLearners || 0);
          const complete = Number(val.completeLearners || 0);
          const pct = total ? Math.round((100 * complete) / total) : 0;
          return {
            label: g.label,
            approvalState: wf.approvalState || 'draft',
            locked: !!wf.locked,
            completeText: complete + '/' + total + ' (' + pct + '%)',
            completionPct: pct,
          };
        } catch (_) {
          return {
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
    checks.forEach(function (c) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(c.label) +
        '</td><td>' +
        escapeHtml(c.completeText) +
        '</td><td>' +
        escapeHtml(c.approvalState) +
        '</td><td>' +
        (c.locked ? 'Yes' : 'No') +
        '</td>';
      body.appendChild(tr);
    });

    const flagged = checks
      .filter(function (c) {
        return c.completionPct < 80 || c.approvalState === 'draft' || !c.locked;
      })
      .sort(function (a, b) {
        return a.completionPct - b.completionPct;
      })
      .slice(0, 6);
    alerts.innerHTML = '';
    if (!flagged.length) {
      alerts.innerHTML = '<li><div>All class groups look healthy for this term and period.</div></li>';
      return;
    }
    flagged.forEach(function (f) {
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

  async function renderHeadStaffCoverage() {
    const box = document.getElementById('hd-r-staff-coverage');
    if (!box) return;
    try {
      const res = await fetch('/api/director/staff', { headers: { ...authHeaders() } });
      if (!res.ok) {
        box.innerHTML = '<p class="dir-muted">Staff snapshot unavailable.</p>';
        return;
      }
      const rows = await res.json();
      const counts = { director: 0, head_teacher: 0, class_teacher: 0, skill_teacher: 0, inactive: 0 };
      (rows || []).forEach(function (r) {
        if (!r.active) counts.inactive += 1;
        if (counts[r.role] != null) counts[r.role] += r.active ? 1 : 0;
      });
      const maxCount = Math.max(
        1,
        counts.director,
        counts.head_teacher,
        counts.class_teacher,
        counts.skill_teacher,
        counts.inactive
      );
      function w(n) {
        return Math.round((100 * n) / maxCount);
      }
      box.innerHTML =
        '<div class="dir-progress-row"><label><span>Directors</span><span>' +
        counts.director +
        '</span></label><div class="dir-progress-bar"><span style="width:' +
        w(counts.director) +
        '%;background:#a78bfa"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Head teachers</span><span>' +
        counts.head_teacher +
        '</span></label><div class="dir-progress-bar"><span style="width:' +
        w(counts.head_teacher) +
        '%;background:#38bdf8"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Class teachers</span><span>' +
        counts.class_teacher +
        '</span></label><div class="dir-progress-bar"><span style="width:' +
        w(counts.class_teacher) +
        '%;background:#22c55e"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Skill teachers</span><span>' +
        counts.skill_teacher +
        '</span></label><div class="dir-progress-bar"><span style="width:' +
        w(counts.skill_teacher) +
        '%;background:#f59e0b"></span></div></div>' +
        '<div class="dir-progress-row"><label><span>Inactive accounts</span><span>' +
        counts.inactive +
        '</span></label><div class="dir-progress-bar"><span style="width:' +
        w(counts.inactive) +
        '%;background:#ef4444"></span></div></div>';
    } catch (_) {
      box.innerHTML = '<p class="dir-muted">Staff snapshot unavailable.</p>';
    }
  }

  async function loadHeadReports() {
    const termEl = document.getElementById('hd-r-term');
    const periodEl = document.getElementById('hd-r-period');
    if (!termEl || !periodEl) return;
    const term = Number(termEl.value || 1);
    const period = String(periodEl.value || 'mid');
    const year = selectedHeadReportYear();
    const u = new URL('/api/head/overview', window.location.origin);
    u.searchParams.set('term', String(term));
    u.searchParams.set('period', period);
    u.searchParams.set('year', String(year));
    const res = await fetch(u.toString(), { headers: { ...authHeaders() } });
    const j = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      const status = document.getElementById('hd-report-status');
      if (status) status.textContent = j.error || 'Could not load reports overview.';
      if (!headReportGroups.length) await loadHeadReportExplorerGroups();
      return;
    }
    renderHeadReports(j);
    if (!headReportGroups.length) await loadHeadReportExplorerGroups();
    const status = document.getElementById('hd-report-status');
    if (status) status.textContent = 'Showing Term ' + term + ', ' + period + ', year ' + year + '.';
  }

  async function applyHeadReportingContext() {
    const termEl = document.getElementById('hd-r-term');
    const periodEl = document.getElementById('hd-r-period');
    const status = document.getElementById('hd-report-status');
    if (!termEl || !periodEl) return;
    const term = Number(termEl.value || 1);
    const period = String(periodEl.value || 'mid');
    const year = selectedHeadReportYear();
    if (status) status.textContent = 'Saving...';
    const res = await fetch('/api/head/reporting-context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ term: term, period: period, year: year }),
    });
    const j = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      if (status) status.textContent = j.error || 'Could not save reporting context.';
      return;
    }
    if (status) {
      const moved = j.promotion && Number(j.promotion.moved || 0);
      status.textContent =
        moved > 0
          ? 'Saved. Automatic promotion moved ' + moved + ' learners for year ' + year + '.'
          : 'Saved. Reporting context updated for year ' + year + '.';
    }
    await loadOverviewTable();
    await refreshOverviewStats();
    await loadHeadReports();
    const hcTerm = document.getElementById('hc-term');
    const hcPeriod = document.getElementById('hc-period');
    if (hcTerm) hcTerm.value = String(term);
    if (hcPeriod) hcPeriod.value = String(period);
    const headCommentsPanel = document.getElementById('panel-head-comments');
    if (
      headCommentsPanel &&
      headCommentsPanel.classList.contains('active') &&
      window.__oceanHeadCommentsInit
    ) {
      await window.__oceanHeadCommentsInit();
    }
  }

  async function loadOverviewTable() {
    const tbody = document.getElementById('head-overview-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    let rows = [];
    try {
      const res = await fetch('/api/students/count-summary');
      if (res.ok) rows = await res.json();
    } catch (_) {}
    const byKey = {};
    rows.forEach(function (r) {
      const key = r.class_level + '|' + (r.stream || '');
      byKey[key] = Number(r.count) || 0;
    });
    CLASS_ROWS.forEach(function (r) {
      const key = r.classLevel + '|' + (r.stream || '');
      const n = byKey[key] != null ? byKey[key] : 0;
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = r.label;
      const td2 = document.createElement('td');
      td2.textContent = String(n);
      const td3 = document.createElement('td');
      const a = document.createElement('a');
      a.className = 'btn btn-primary';
      a.href = classSignInHref(r.classLevel, r.stream || '');
      a.textContent = 'Open dashboard';
      td3.appendChild(a);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    });
  }

  function switchToTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.add('active');
    if (name === 'overview') {
      refreshOverviewStats();
      loadOverviewTable();
    }
    if (name === 'head-comments' && window.__oceanHeadCommentsInit) {
      window.__oceanHeadCommentsInit();
    }
    if (name === 'comment-review' && window.__oceanHeadCommentReviewInit) {
      window.__oceanHeadCommentReviewInit();
    }
    if (name === 'reports') {
      if (!headReportGroups.length) loadHeadReportExplorerGroups();
      loadHeadReports();
      loadHeadReportExplorerData();
    }
    if (name === 'messages' && window.__oceanLeaderMessagesInit) {
      window.__oceanLeaderMessagesInit();
    } else if (window.__oceanLeaderMessagesPause) {
      window.__oceanLeaderMessagesPause();
    }
    if (name === 'staff') {
      loadStaffTable();
    }
    if (name === 'learner-lookup' && window.__oceanLearnerLookupInit) {
      window.__oceanLearnerLookupInit();
    }
    if (name === 'settings' && window.OceanSettings) {
      window.OceanSettings.syncProfileBar();
      window.OceanSettings.applyTipsVisibility();
    }
  }

  window.__oceanHeadSwitchTab = switchToTab;

  function humanClassLevel(cl) {
    return titles[cl] || cl || '';
  }

  async function loadStaffTable() {
    const tbody = document.getElementById('hd-staff-tbody');
    if (!tbody) return;
    const res = await fetch('/api/director/staff', { headers: { ...authHeaders() } });
    if (!res.ok) {
      const j = await res.json().catch(function () {
        return {};
      });
      const msg = j.error || 'Could not load staff accounts.';
      tbody.innerHTML = '<tr><td colspan="6">' + escapeHtml(msg) + '</td></tr>';
      return;
    }
    const rows = await res.json().catch(function () {
      return [];
    });
    tbody.innerHTML = '';
    let myStaffId = null;
    try {
      const raw = sessionStorage.getItem('ocean_staff_profile');
      if (raw) myStaffId = Number(JSON.parse(raw).id);
    } catch (_) {}
    rows.forEach(function (r) {
      const tr = document.createElement('tr');
      const scope =
        r.role === 'class_teacher' && r.class_level
          ? humanClassLevel(r.class_level) + (r.stream ? ' · ' + r.stream : '')
          : '—';
      tr.innerHTML =
        '<td>' +
        escapeHtml(r.display_name || '') +
        '</td><td>' +
        escapeHtml(r.email || '') +
        '</td><td>' +
        escapeHtml(r.role || '') +
        '</td><td>' +
        escapeHtml(scope) +
        '</td><td>' +
        (r.active ? 'Active' : 'Disabled') +
        '</td><td></td>';
      const tdAct = tr.querySelector('td:last-child');
      tdAct.style.whiteSpace = 'nowrap';
      const actWrap = document.createElement('div');
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
        del.addEventListener('click', async function () {
          if (
            !window.confirm(
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
            const j = await delRes.json().catch(function () {
              return {};
            });
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
          btn.addEventListener('click', async function () {
            if (!window.confirm('Disable this account?')) return;
            const patch = await fetch('/api/director/staff/' + r.id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ active: false }),
            });
            if (!patch.ok) {
              const j = await patch.json().catch(function () {
                return {};
              });
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
      tbody.appendChild(tr);
    });
  }

  function initStaffPanel() {
    const form = document.getElementById('hd-staff-form');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const body = {
        email: (document.getElementById('hsf-email') || {}).value || '',
        password: (document.getElementById('hsf-password') || {}).value || '',
        display_name: (document.getElementById('hsf-name') || {}).value || '',
        role: (document.getElementById('hsf-role') || {}).value || '',
        class_level: ((document.getElementById('hsf-class-level') || {}).value || '').trim() || null,
        stream: ((document.getElementById('hsf-stream') || {}).value || '').trim(),
      };
      const res = await fetch('/api/director/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        alert(j.error || 'Could not create account');
        return;
      }
      form.reset();
      loadStaffTable();
      alert('Account created. Share the email and password with the staff member.');
    });
  }

  window.__oceanHead = {
    CLASS_ROWS: CLASS_ROWS,
    labelClass: labelClass,
    addNotification: addNotification,
    refreshOverviewStats: refreshOverviewStats,
    switchToTab: switchToTab,
  };

  document.querySelectorAll('[data-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      const name = tab.getAttribute('data-tab');
      if (name) switchToTab(name);
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

  function initHeadReportActions() {
    const csvBtn = document.getElementById('hd-export-csv');
    if (csvBtn && !csvBtn.dataset.bound) {
      csvBtn.dataset.bound = '1';
      csvBtn.addEventListener('click', async function () {
        const t = document.getElementById('hd-r-term');
        const p = document.getElementById('hd-r-period');
        const term = t ? t.value : '1';
        const period = p ? p.value : 'mid';
        const year = selectedHeadReportYear();
        const res = await fetch(
          '/api/head/overview?term=' + encodeURIComponent(term) + '&period=' + encodeURIComponent(period) + '&year=' + encodeURIComponent(year),
          { headers: { ...authHeaders() } }
        );
        if (!res.ok) return;
        const data = await res.json().catch(function () { return {}; });
        const lines = [['Scope', 'Subject', 'Entered', 'Total', 'Percent']];
        (data.subjectProgressSchool || []).forEach(function (r) {
          lines.push(['School', r.subject, r.entered, r.total, r.percent]);
        });
        (data.subjectProgressByClass || []).forEach(function (grp) {
          const scope = grp.label;
          (grp.subjects || []).forEach(function (r) {
            lines.push([scope, r.subject, r.entered, r.total, r.percent]);
          });
        });
        const csv = lines.map(function (row) {
          return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'subject-progress-term' + term + '-' + period + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
    const rpLoadBtn = document.getElementById('hd-rp-load');
    if (rpLoadBtn && !rpLoadBtn.dataset.bound) {
      rpLoadBtn.dataset.bound = '1';
      rpLoadBtn.addEventListener('click', function () {
        loadHeadReportExplorerData();
      });
    }
    ['hd-rp-term', 'hd-rp-period', 'hd-rp-learner'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('change', function () {
        const panel = document.getElementById('panel-reports');
        if (panel && panel.classList.contains('active')) loadHeadReportExplorerData();
      });
    });
  }

  const auth = window.OceanStaffAuth;
  if (auth) {
    if (
      !auth.validateSessionFreshness({
        loginViaClasses: true,
        classesKind: 'head',
        loginPath: '/login-head.html',
      })
    ) {
      return;
    }
    const staff = auth.getStoredStaff();
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token || !staff) {
      auth.redirectToClassesSignIn('head', '/head-dashboard.html');
      return;
    }
    if (
      staff.role !== 'head_teacher' &&
      staff.role !== 'director' &&
      staff.role !== 'system_admin' &&
      staff.role !== 'ghost'
    ) {
      auth.redirectToClassesSignIn('head', '/head-dashboard.html');
      return;
    }
    if (staff.role === 'director') {
      window.location.href = '/director-dashboard.html';
      return;
    }
    auth.startIdleWatch({
      loginViaClasses: true,
      classesKind: 'head',
      loginPath: '/login-head.html',
    });
    const barName = document.getElementById('profile-bar-name');
    if (barName) barName.textContent = staff.display_name || 'Head teacher';
    if (window.OceanWelcomeBanner) window.OceanWelcomeBanner.refreshName('Head teacher');
    const roleEl = document.getElementById('profile-bar-role');
    if (roleEl) roleEl.textContent = 'Head teacher';
  }

  updateNotifUi();
  refreshOverviewStats();
  loadOverviewTable();
  initMovementAndClassTools();
  initStaffPanel();
  initHeadReportActions();
  fetch('/api/reporting-context')
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .then(function (ctx) {
      const termEl = document.getElementById('hd-r-term');
      const periodEl = document.getElementById('hd-r-period');
      if (termEl) termEl.value = String((ctx && ctx.term) || 1);
      if (periodEl) periodEl.value = String((ctx && ctx.period) || 'mid');
      buildHeadYearOptions((ctx && ctx.year) || new Date().getFullYear());
      const btn = document.getElementById('hd-report-apply');
      if (btn) btn.addEventListener('click', applyHeadReportingContext);
    })
    .catch(function () {
      buildHeadYearOptions(new Date().getFullYear());
      const btn = document.getElementById('hd-report-apply');
      if (btn) btn.addEventListener('click', applyHeadReportingContext);
    });
  switchToTab('overview');
  if (window.__oceanTeacherMobile && window.__oceanTeacherMobile.syncHomeStats) {
    setTimeout(function () {
      window.__oceanTeacherMobile.syncHomeStats();
    }, 1500);
  }
})();
