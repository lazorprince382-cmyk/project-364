/**
 * School-wide learner lookup — biodata, weekly progress, report preview.
 * Injects tab + panel on head, class, and skill dashboards.
 */
(function () {
  const TITLES = {
    daycare: 'Day Care',
    baby: 'Baby Class',
    middle: 'Middle Class',
    top: 'Top Class',
    primary1: 'Primary One',
    primary2: 'Primary Two',
  };
  const STREAM_LABELS = {
    waves: 'Waves',
    pearls: 'Pearls',
    dolphins: 'Dolphins',
    whales: 'Whales',
  };
  const PRIMARY_LEVELS = { primary1: true, primary2: true };
  const WEEKLY_TREND_COLORS = [
    'rgba(20, 184, 166, 0.88)',
    'rgba(56, 189, 248, 0.88)',
    'rgba(234, 179, 8, 0.88)',
    'rgba(251, 146, 60, 0.88)',
    'rgba(239, 68, 68, 0.88)',
    'rgba(168, 85, 247, 0.88)',
    'rgba(236, 72, 153, 0.88)',
    'rgba(132, 204, 22, 0.88)',
  ];
  const LEGACY_RATING_LABELS = { strong: 'Strong', average: 'Average', weak: 'Weak' };

  let selectedStudent = null;
  let searchTimer = null;
  let schoolYear = new Date().getFullYear();
  let lookupReady = false;
  let cachedWeeklyRows = null;

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function authHeaders() {
    const base = {};
    const auth = window.OceanStaffAuth;
    return auth && auth.authHeaders ? Object.assign({}, base, auth.authHeaders()) : base;
  }

  function labelClass(cl, st) {
    const dash = window.__oceanDashboard;
    if (dash && dash.titles && dash.titles[cl]) {
      const t = dash.titles[cl];
      if (st) return t + ' (' + (dash.streamLabels && dash.streamLabels[st] ? dash.streamLabels[st] : st) + ')';
      return t;
    }
    const t = TITLES[cl] || cl || '—';
    if (st) return t + ' — ' + (STREAM_LABELS[st] || st);
    return t;
  }

  function displayTitleFor(cl) {
    const dash = window.__oceanDashboard;
    if (dash && dash.titles && dash.titles[cl]) return dash.titles[cl];
    return TITLES[cl] || cl;
  }

  function subjectsForClass(cl) {
    if (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS[cl]) return window.OCEAN_SUBJECTS[cl].slice();
    if (PRIMARY_LEVELS[cl] && window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS.primary2) {
      return window.OCEAN_SUBJECTS.primary2.slice();
    }
    return [];
  }

  function isPrimaryClass(cl) {
    return !!PRIMARY_LEVELS[cl];
  }

  function injectTabButtons() {
    document.querySelectorAll('.dash-nav, .dash-tabs-wrap .tabs').forEach(function (nav) {
      if (!nav || nav.querySelector('[data-tab="learner-lookup"]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = nav.classList.contains('dash-nav') ? 'tab dash-nav-btn' : 'tab';
      btn.setAttribute('data-tab', 'learner-lookup');
      btn.textContent = 'Learner lookup';
      const ref = nav.querySelector('[data-tab="settings"]');
      if (ref) nav.insertBefore(btn, ref);
      else nav.appendChild(btn);
    });
  }

  function panelHtml() {
    return (
      '<h3 style="margin-top:0;font-size:1.05rem">Learner lookup</h3>' +
      '<p class="ll-muted" style="margin-top:0">Search any learner in the school to view biodata, weekly progress, and a read-only report for the term and year you choose.</p>' +
      '<div class="ll-search-wrap">' +
      '<label for="ll-search">Search by name or registration number</label>' +
      '<input id="ll-search" type="search" autocomplete="off" placeholder="Type at least 2 characters…" />' +
      '<div id="ll-suggestions" class="ll-suggestions" hidden></div>' +
      '</div>' +
      '<div id="ll-empty" class="ll-empty">Select a learner above to view their profile.</div>' +
      '<div id="ll-content" hidden>' +
      '<div id="ll-profile" class="ll-profile"></div>' +
      '<div id="ll-filters" class="ll-filters comments-toolbar">' +
      '<div><label for="ll-term">Term</label><select id="ll-term">' +
      '<option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option>' +
      '</select></div>' +
      '<div><label for="ll-period">Reporting period</label><select id="ll-period">' +
      '<option value="begin">Beginning of term</option>' +
      '<option value="mid" selected>Mid term</option>' +
      '<option value="end">End of term</option>' +
      '</select></div>' +
      '<div style="min-width:200px"><label>Academic year</label>' +
      '<div class="ll-year-nav">' +
      '<button type="button" class="btn" id="ll-year-prev" title="Previous year">←</button>' +
      '<span id="ll-year-banner" class="ll-year-banner" aria-live="polite"></span>' +
      '<button type="button" class="btn" id="ll-year-next" title="Next year">→</button>' +
      '<select id="ll-year" style="max-width:6rem" aria-label="Academic year"></select>' +
      '</div></div>' +
      '</div>' +
      '<section class="ll-section"><div class="ll-weekly-head"><h4>Weekly progress</h4>' +
      '<div class="ll-weekly-subject-wrap"><label for="ll-weekly-subject">Subject</label>' +
      '<select id="ll-weekly-subject" disabled><option value="__all__">All subjects</option></select></div></div>' +
      '<div id="ll-weekly-status" class="ll-muted"></div>' +
      '<div id="ll-weekly-grid-wrap" class="ll-weekly-grid-wrap"></div>' +
      '<div id="ll-weekly-detail-wrap" class="ll-weekly-detail-wrap"></div></section>' +
      '<section class="ll-section"><h4>Report template</h4><p id="ll-report-caption" class="ll-muted"></p>' +
      '<div id="ll-report-wrap" class="ll-report-wrap report-sheet"><div id="ll-report-preview"></div></div></section>' +
      '</div>'
    );
  }

  function injectPanel() {
    if (document.getElementById('panel-learner-lookup')) return;
    const host =
      document.querySelector('.dash-main-inner') ||
      document.querySelector('.dash-main') ||
      document.body;
    const panel = document.createElement('div');
    panel.id = 'panel-learner-lookup';
    panel.className = 'tab-panel panel dash-panel-pad';
    panel.innerHTML = panelHtml();
    const settings = document.getElementById('panel-settings');
    if (settings && settings.parentNode) settings.parentNode.insertBefore(panel, settings);
    else host.appendChild(panel);
  }

  function getYear() {
    const el = document.getElementById('ll-year');
    if (!el) return schoolYear;
    const y = Number(el.value);
    return Number.isFinite(y) ? y : schoolYear;
  }

  function syncYearBanner() {
    const banner = document.getElementById('ll-year-banner');
    const y = getYear();
    if (banner) banner.textContent = String(y);
    const cap = document.getElementById('ll-report-caption');
    if (cap && selectedStudent) {
      const term = document.getElementById('ll-term');
      const period = document.getElementById('ll-period');
      cap.textContent =
        labelClass(selectedStudent.class_level, selectedStudent.stream) +
        ' · Term ' +
        (term ? term.value : '1') +
        ' · ' +
        periodLabel(period ? period.value : 'mid') +
        ' · Year ' +
        y;
    }
  }

  function periodLabel(p) {
    if (p === 'begin') return 'Beginning of term';
    if (p === 'end') return 'End of term';
    return 'Mid term';
  }

  function populateYearSelect(defaultYear) {
    const el = document.getElementById('ll-year');
    if (!el) return;
    const now = new Date().getFullYear();
    const pick = Number.isFinite(Number(defaultYear)) ? Number(defaultYear) : now;
    schoolYear = pick;
    el.innerHTML = '';
    for (let y = now - 5; y <= now + 2; y += 1) {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      if (y === pick) o.selected = true;
      el.appendChild(o);
    }
    syncYearBanner();
  }

  function shiftYear(delta) {
    const el = document.getElementById('ll-year');
    if (!el || !el.options.length) return;
    let idx = el.selectedIndex;
    idx = Math.max(0, Math.min(el.options.length - 1, idx + delta));
    el.selectedIndex = idx;
    schoolYear = getYear();
    syncYearBanner();
    reloadLearnerData();
  }

  async function fetchReportingContext() {
    try {
      const res = await fetch('/api/reporting-context', { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data && Number(data.year)) schoolYear = Number(data.year);
      const termEl = document.getElementById('ll-term');
      const periodEl = document.getElementById('ll-period');
      if (termEl && data && data.term) termEl.value = String(data.term);
      if (periodEl && data && data.period) periodEl.value = String(data.period);
    } catch (_) {}
  }

  async function searchLearners(q) {
    const u = new URL('/api/students/search', window.location.origin);
    u.searchParams.set('q', q);
    const res = await fetch(u.toString(), { headers: authHeaders() });
    if (!res.ok) throw new Error('search failed');
    return res.json();
  }

  function renderSuggestions(rows) {
    const box = document.getElementById('ll-suggestions');
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<p class="ll-muted" style="padding:0.65rem">No learners found.</p>';
      box.hidden = false;
      return;
    }
    box.innerHTML = '';
    rows.forEach(function (r) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'll-suggestion';
      const img = r.passport_path
        ? '<img src="' + escapeHtml(r.passport_path) + '" alt="" />'
        : '<span class="ll-profile-photo placeholder" style="width:36px;height:36px">—</span>';
      btn.innerHTML =
        img +
        '<span><strong>' +
        escapeHtml(r.full_name) +
        '</strong><br /><span class="ll-suggestion-meta">' +
        escapeHtml(r.reg_no) +
        ' · ' +
        escapeHtml(labelClass(r.class_level, r.stream)) +
        '</span></span>';
      btn.addEventListener('click', function () {
        box.hidden = true;
        const search = document.getElementById('ll-search');
        if (search) search.value = r.full_name;
        selectLearner(r);
      });
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function renderProfile(student) {
    const el = document.getElementById('ll-profile');
    if (!el) return;
    const subs = subjectsForClass(student.class_level);
    const photo = student.passport_path
      ? '<img class="ll-profile-photo" src="' + escapeHtml(student.passport_path) + '" alt="" />'
      : '<div class="ll-profile-photo placeholder">No photo</div>';
    const pills = subs
      .map(function (s) {
        return '<span class="ll-subject-pill">' + escapeHtml(s) + '</span>';
      })
      .join('');
    el.innerHTML =
      photo +
      '<div><h4>' +
      escapeHtml(student.full_name) +
      '</h4>' +
      '<dl class="ll-profile-dl">' +
      '<dt>Registration no.</dt><dd>' +
      escapeHtml(student.reg_no) +
      '</dd>' +
      '<dt>Class</dt><dd>' +
      escapeHtml(labelClass(student.class_level, student.stream)) +
      '</dd>' +
      '<dt>Subjects</dt><dd><div class="ll-subjects">' +
      (pills || '<span class="ll-muted">—</span>') +
      '</div></dd>' +
      '</dl></div>';
  }

  function sanitizeRatingLabel(label) {
    if (window.OceanWeeklyGoalRatings && window.OceanWeeklyGoalRatings.sanitizeRatingPhrase) {
      return window.OceanWeeklyGoalRatings.sanitizeRatingPhrase(label);
    }
    return String(label || '').trim();
  }

  function ratingDisplayText(band) {
    const b = String(band || '').trim();
    if (!b) return '';
    if (LEGACY_RATING_LABELS[b]) return LEGACY_RATING_LABELS[b];
    return sanitizeRatingLabel(b);
  }

  function ratingColorForLabel(label, optionsByWeek, weekNo) {
    if (!label) return 'rgba(100, 116, 139, 0.35)';
    if (label === 'strong') return 'rgba(20, 184, 166, 0.88)';
    if (label === 'average') return 'rgba(234, 179, 8, 0.88)';
    if (label === 'weak') return 'rgba(239, 68, 68, 0.88)';
    const opts = (optionsByWeek && optionsByWeek[weekNo]) || [];
    const idx = opts.indexOf(label);
    if (idx >= 0) return WEEKLY_TREND_COLORS[Math.min(idx, WEEKLY_TREND_COLORS.length - 1)];
    return 'rgba(148, 163, 184, 0.65)';
  }

  function ratingLevelIndex(label, optionsByWeek, weekNo) {
    if (!label) return -1;
    if (label === 'strong') return 0;
    if (label === 'average') return 1;
    if (label === 'weak') return 2;
    const opts = (optionsByWeek && optionsByWeek[weekNo]) || [];
    const idx = opts.indexOf(label);
    return idx >= 0 ? idx : 0;
  }

  function weekDotHtml(weekNo, band, optionsByWeek) {
    if (!band) {
      return (
        '<span class="ll-week-dot ll-week-dot-empty" title="Week ' +
        weekNo +
        ': not rated" aria-label="Week ' +
        weekNo +
        ' not rated"></span>'
      );
    }
    const title = 'Week ' + weekNo + ': ' + ratingDisplayText(band);
    const color = ratingColorForLabel(band, optionsByWeek, weekNo);
    const level = ratingLevelIndex(band, optionsByWeek, weekNo);
    return (
      '<span class="ll-week-dot" style="background:' +
      color +
      '" data-level="' +
      level +
      '" title="' +
      escapeHtml(title) +
      '" aria-label="' +
      escapeHtml(title) +
      '"></span>'
    );
  }

  function weeklyBandsUrl(student, subject, term) {
    const u = new URL('/api/weekly-bands', window.location.origin);
    u.searchParams.set('classLevel', student.class_level);
    if (student.stream) u.searchParams.set('stream', student.stream);
    u.searchParams.set('subject', subject);
    u.searchParams.set('term', term);
    u.searchParams.set('student_id', String(student.id));
    return u.toString();
  }

  function weeklyGoalsUrl(student, subject, term, year) {
    const u = new URL('/api/class-weekly-goals', window.location.origin);
    u.searchParams.set('classLevel', student.class_level);
    if (student.stream) u.searchParams.set('stream', student.stream);
    u.searchParams.set('subject', subject);
    u.searchParams.set('term', term);
    u.searchParams.set('year', String(year));
    return u.toString();
  }

  function renderWeeklyDetail(subjectRows) {
    const detailWrap = document.getElementById('ll-weekly-detail-wrap');
    if (!detailWrap) return;
    const entries = [];
    subjectRows.forEach(function (row) {
      for (let w = 1; w <= 11; w += 1) {
        const band = row.byWeek[w];
        if (!band) continue;
        entries.push({
          subject: row.subject,
          week: w,
          text: ratingDisplayText(band),
          color: ratingColorForLabel(band, row.optionsByWeek, w),
        });
      }
    });
    if (!entries.length) {
      detailWrap.innerHTML = '<p class="ll-muted ll-weekly-detail-empty">No weekly ratings recorded for this term yet.</p>';
      return;
    }
    const bySubject = {};
    entries.forEach(function (e) {
      if (!bySubject[e.subject]) bySubject[e.subject] = [];
      bySubject[e.subject].push(e);
    });
    let html = '<h5 class="ll-weekly-detail-title">Rating details</h5><p class="ll-muted ll-weekly-detail-hint">Hover a coloured dot above for a short preview; full wording is listed below.</p>';
    Object.keys(bySubject)
      .sort()
      .forEach(function (sub) {
        const items = bySubject[sub];
        html +=
          '<details class="ll-weekly-subject" open>' +
          '<summary><span class="ll-weekly-subject-name">' +
          escapeHtml(sub) +
          '</span><span class="ll-weekly-subject-count">' +
          items.length +
          ' week' +
          (items.length === 1 ? '' : 's') +
          '</span></summary><ul class="ll-weekly-rating-list">';
        items
          .sort(function (a, b) {
            return a.week - b.week;
          })
          .forEach(function (item) {
            html +=
              '<li><span class="ll-week-tag">W' +
              item.week +
              '</span>' +
              '<span class="ll-rating-dot" style="background:' +
              item.color +
              '"></span>' +
              '<span class="ll-rating-text">' +
              escapeHtml(item.text) +
              '</span></li>';
          });
        html += '</ul></details>';
      });
    detailWrap.innerHTML = html;
  }

  function getWeeklySubjectFilter() {
    const el = document.getElementById('ll-weekly-subject');
    return el && el.value ? el.value : '__all__';
  }

  function populateWeeklySubjectSelect(subjects, keepValue) {
    const el = document.getElementById('ll-weekly-subject');
    if (!el) return;
    const prev = keepValue != null ? keepValue : el.value;
    el.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '__all__';
    allOpt.textContent = 'All subjects';
    el.appendChild(allOpt);
    subjects.forEach(function (sub) {
      const o = document.createElement('option');
      o.value = sub;
      o.textContent = sub;
      el.appendChild(o);
    });
    el.disabled = !subjects.length;
    if (prev && (prev === '__all__' || subjects.indexOf(prev) >= 0)) el.value = prev;
    else el.value = '__all__';
  }

  function filterWeeklyRows(rows) {
    const filter = getWeeklySubjectFilter();
    if (filter === '__all__') return rows;
    return rows.filter(function (r) {
      return r.subject === filter;
    });
  }

  function renderWeeklyGridView(subjectRows) {
    const status = document.getElementById('ll-weekly-status');
    const gridWrap = document.getElementById('ll-weekly-grid-wrap');
    const termEl = document.getElementById('ll-term');
    const term = termEl ? termEl.value : '1';
    const year = getYear();
    const filter = getWeeklySubjectFilter();
    if (!gridWrap) return;

    if (!subjectRows.length) {
      gridWrap.innerHTML =
        '<p class="ll-muted">No weekly ratings for ' +
        (filter === '__all__' ? 'any subject' : escapeHtml(filter)) +
        ' in Term ' +
        term +
        ' · ' +
        year +
        '.</p>';
      renderWeeklyDetail([]);
      if (status) {
        status.textContent =
          'Term ' +
          term +
          ' · Year ' +
          year +
          (filter !== '__all__' ? ' · ' + filter : '') +
          ' — no ratings yet.';
      }
      return;
    }

    let header = '<tr><th>Subject</th>';
    for (let w = 1; w <= 11; w += 1) header += '<th><span class="ll-week-col">W' + w + '</span></th>';
    header += '</tr>';
    let body = '';
    subjectRows.forEach(function (row) {
      body += '<tr><td class="ll-weekly-subject-cell">' + escapeHtml(row.subject) + '</td>';
      for (let w = 1; w <= 11; w += 1) {
        body += '<td class="ll-weekly-dot-cell">' + weekDotHtml(w, row.byWeek[w], row.optionsByWeek) + '</td>';
      }
      body += '</tr>';
    });
    gridWrap.innerHTML =
      '<div class="ll-weekly-legend">' +
      '<span><span class="ll-week-dot" style="background:rgba(20,184,166,0.88)"></span> higher progress</span>' +
      '<span><span class="ll-week-dot" style="background:rgba(239,68,68,0.88)"></span> lower progress</span>' +
      '<span><span class="ll-week-dot ll-week-dot-empty"></span> not rated</span>' +
      '</div>' +
      '<div class="ll-weekly-table-scroll"><table class="data ll-weekly-table"><thead>' +
      header +
      '</thead><tbody>' +
      body +
      '</tbody></table></div>';

    renderWeeklyDetail(subjectRows);

    if (status) {
      status.textContent =
        'Term ' +
        term +
        ' · Year ' +
        year +
        (filter !== '__all__' ? ' · ' + filter : ' · all subjects') +
        ' — hover a dot for a short preview; full comments are below.';
    }
  }

  function renderWeeklyFromCache() {
    if (!cachedWeeklyRows) return;
    renderWeeklyGridView(filterWeeklyRows(cachedWeeklyRows));
  }

  async function loadWeeklyGrid(student) {
    const status = document.getElementById('ll-weekly-status');
    const gridWrap = document.getElementById('ll-weekly-grid-wrap');
    const detailWrap = document.getElementById('ll-weekly-detail-wrap');
    if (!gridWrap) return;
    const termEl = document.getElementById('ll-term');
    const term = termEl ? termEl.value : '1';
    const year = getYear();
    const subjects = subjectsForClass(student.class_level);
    const subjectSelect = document.getElementById('ll-weekly-subject');
    const keepSubject = subjectSelect ? subjectSelect.value : '__all__';
    if (status) status.textContent = 'Loading weekly progress…';
    gridWrap.innerHTML = '';
    if (detailWrap) detailWrap.innerHTML = '';
    cachedWeeklyRows = null;
    if (!subjects.length) {
      populateWeeklySubjectSelect([]);
      if (status) status.textContent = 'No subjects listed for this class.';
      return;
    }
    try {
      const subjectRows = await Promise.all(
        subjects.map(async function (sub) {
          const [bandsRes, goalsRes] = await Promise.all([
            fetch(weeklyBandsUrl(student, sub, term), { headers: authHeaders() }),
            fetch(weeklyGoalsUrl(student, sub, term, year), { headers: authHeaders() }),
          ]);
          const rows = bandsRes.ok ? await bandsRes.json() : [];
          const goals = goalsRes.ok ? await goalsRes.json() : [];
          const byWeek = {};
          (rows || []).forEach(function (r) {
            if (Number(r.student_id) === Number(student.id)) byWeek[r.week_no] = r.band;
          });
          const optionsByWeek = {};
          (Array.isArray(goals) ? goals : []).forEach(function (g) {
            optionsByWeek[Number(g.week_no)] = Array.isArray(g.rating_options) ? g.rating_options : [];
          });
          return { subject: sub, byWeek: byWeek, optionsByWeek: optionsByWeek };
        })
      );
      cachedWeeklyRows = subjectRows;
      populateWeeklySubjectSelect(subjects, keepSubject);
      renderWeeklyGridView(filterWeeklyRows(subjectRows));
    } catch (_) {
      if (status) status.textContent = 'Could not load weekly progress.';
    }
  }

  async function loadReportPreview(student) {
    const target = document.getElementById('ll-report-preview');
    if (!target) return;
    const termEl = document.getElementById('ll-term');
    const periodEl = document.getElementById('ll-period');
    const term = termEl ? termEl.value : '1';
    const period = periodEl ? periodEl.value : 'mid';
    const year = getYear();
    syncYearBanner();
    target.innerHTML = '<p class="ll-loading">Loading report…</p>';
    if (!window.OceanClassReports || typeof window.OceanClassReports.renderLearner !== 'function') {
      target.innerHTML = '<p class="ll-muted">Report preview is not available on this page.</p>';
      return;
    }
    await window.OceanClassReports.renderLearner({
      student: student,
      classLevel: student.class_level,
      stream: student.stream || '',
      displayTitle: displayTitleFor(student.class_level),
      streamLabels: (window.__oceanDashboard && window.__oceanDashboard.streamLabels) || STREAM_LABELS,
      subjects: subjectsForClass(student.class_level),
      isPrimary: isPrimaryClass(student.class_level),
      skillOnlySubjects: window.OCEAN_SKILL_SUBJECTS || [],
      term: term,
      period: period,
      year: year,
      targetEl: target,
    });
  }

  function reloadLearnerData() {
    if (!selectedStudent) return;
    loadWeeklyGrid(selectedStudent);
    loadReportPreview(selectedStudent);
  }

  function selectLearner(student) {
    selectedStudent = student;
    const empty = document.getElementById('ll-empty');
    const content = document.getElementById('ll-content');
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    renderProfile(student);
    syncYearBanner();
    reloadLearnerData();
  }

  function bindEvents() {
    const search = document.getElementById('ll-search');
    const suggestions = document.getElementById('ll-suggestions');
    if (search) {
      search.addEventListener('input', function () {
        const q = search.value.trim();
        if (searchTimer) clearTimeout(searchTimer);
        if (q.length < 2) {
          if (suggestions) suggestions.hidden = true;
          return;
        }
        searchTimer = setTimeout(function () {
          searchLearners(q)
            .then(renderSuggestions)
            .catch(function () {
              if (suggestions) {
                suggestions.innerHTML = '<p class="ll-muted" style="padding:0.65rem">Search failed.</p>';
                suggestions.hidden = false;
              }
            });
        }, 280);
      });
      search.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && suggestions) suggestions.hidden = true;
      });
    }
    document.addEventListener('click', function (ev) {
      if (!suggestions || suggestions.hidden) return;
      if (ev.target === search || suggestions.contains(ev.target)) return;
      suggestions.hidden = true;
    });

    ['ll-term', 'll-period', 'll-year'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', function () {
        schoolYear = getYear();
        syncYearBanner();
        reloadLearnerData();
      });
    });
    const prev = document.getElementById('ll-year-prev');
    const next = document.getElementById('ll-year-next');
    if (prev) prev.addEventListener('click', function () { shiftYear(-1); });
    if (next) next.addEventListener('click', function () { shiftYear(1); });

    const weeklySubject = document.getElementById('ll-weekly-subject');
    if (weeklySubject) {
      weeklySubject.addEventListener('change', function () {
        renderWeeklyFromCache();
      });
    }
  }

  function initOnce() {
    if (lookupReady) return;
    lookupReady = true;
    injectPanel();
    injectTabButtons();
    populateYearSelect(schoolYear);
    fetchReportingContext().then(function () {
      populateYearSelect(schoolYear);
    });
    bindEvents();
  }

  injectPanel();
  injectTabButtons();

  window.__oceanLearnerLookupInit = function () {
    initOnce();
    const search = document.getElementById('ll-search');
    if (search) search.focus();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnce);
  } else {
    initOnce();
  }
})();
