/**
 * Head teacher — review subject comments (nursery / skills) or Primary marks (same as class dashboard Comments tab).
 */
(function () {
  const panel = document.getElementById('panel-comment-review');
  if (!panel || !window.__oceanHead) return;

  const labelClass = window.__oceanHead.labelClass || function (cl, st) {
    return (cl || '') + (st ? ' — ' + st : '');
  };
  const CLASS_ROWS = window.__oceanHead.CLASS_ROWS || [];
  const skillList = window.OCEAN_SKILL_SUBJECTS || [];

  const elTerm = document.getElementById('cr-term');
  const elPeriod = document.getElementById('cr-period');
  const elClassPick = document.getElementById('cr-class-pick');
  const elSubjectPick = document.getElementById('cr-subject-pick');
  const elPeriodLabel = document.getElementById('cr-period-label');
  const elBody = document.getElementById('cr-body');
  const elChar = document.getElementById('cr-char-count');
  const elCarousel = document.getElementById('cr-carousel');
  const elSummaryLine = document.getElementById('cr-summary-line');
  const elSummaryPct = document.getElementById('cr-summary-pct');
  const elSummaryFill = document.getElementById('cr-summary-fill');
  const elMarksPanel = document.getElementById('cr-marks-panel');
  const elCommentBlock = document.getElementById('cr-comment-block');
  const elLearnerTitle = document.getElementById('cr-learner-focus-title');
  const elAuthorLabel = document.getElementById('cr-author-label');
  const MAX = 300;
  const MARKS_OUT_OF = 100;

  let allRows = [];
  let entries = [];
  let idx = 0;
  let markRows = [];
  let gradingBands = [];

  CLASS_ROWS.forEach(function (r) {
    const o = document.createElement('option');
    o.value = r.classLevel + '|' + (r.stream || '');
    o.textContent = r.label;
    elClassPick.appendChild(o);
  });

  function parseClassPick() {
    const v = elClassPick.value;
    if (!v) return null;
    const p = v.split('|');
    return { classLevel: p[0], stream: p[1] != null ? p[1] : '' };
  }

  function isPrimaryLevel(cl) {
    return cl === 'primary1' || cl === 'primary2';
  }

  function isMarksSubjectForClass(classLevel, subject) {
    const sub = String(subject || '').trim();
    return isPrimaryLevel(classLevel) && sub && skillList.indexOf(sub) === -1;
  }

  function currentMarksMode() {
    const pk = parseClassPick();
    const subj = elSubjectPick.value.trim();
    return !!(pk && subj && isMarksSubjectForClass(pk.classLevel, subj));
  }

  function periodLabel(period) {
    if (period === 'begin') return 'Beginning of term';
    return period === 'mid' ? 'Mid term' : 'End of term';
  }

  function rebuildSubjectOptionsFromClass() {
    const pk = parseClassPick();
    elSubjectPick.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All subjects';
    elSubjectPick.appendChild(allOpt);
    if (!pk || !window.OCEAN_SUBJECTS) return;
    const list = window.OCEAN_SUBJECTS[pk.classLevel] || [];
    list.forEach(function (s) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      elSubjectPick.appendChild(o);
    });
  }

  function updatePeriodLabel() {
    const t = elTerm.value;
    const p = elPeriod.value;
    const pk = parseClassPick();
    const subj = elSubjectPick.value.trim();
    let extra = '';
    if (pk && subj && entries.length) {
      if (currentMarksMode()) {
        const saved = entries.filter(function (e) {
          const row = markForStudent(e.id, subj);
          return row && row.marks_scored != null && String(row.marks_scored).trim() !== '';
        }).length;
        extra = ' · ' + entries.length + ' learners · ' + saved + ' with marks for ' + subj;
      } else {
        const saved = entries.filter(function (e) {
          return e._missing !== true && e.body && String(e.body).trim();
        }).length;
        extra = ' · ' + entries.length + ' learners · ' + saved + ' with a saved comment for ' + subj;
      }
    }
    const markNote = pk && isPrimaryLevel(pk.classLevel) && markRows.length ? ' · ' + markRows.length + ' mark row(s) for this class' : '';
    elPeriodLabel.textContent =
      periodLabel(p) +
      ' · Term ' +
      t +
      ' — ' +
      allRows.length +
      ' comment row(s) loaded' +
      (pk ? ' for this class' : ' (whole school)') +
      markNote +
      ' · ' +
      entries.length +
      ' in view' +
      extra +
      '.';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function authorLabel(role) {
    if (role == null || role === '') return '—';
    if (role === 'skill_teacher') return 'Skill teacher';
    return 'Class teacher';
  }

  function studentKey(id) {
    const n = Number(id);
    return Number.isNaN(n) ? String(id == null ? '' : id) : n;
  }

  function syntheticSlot(student, subject, termNum, periodVal) {
    return {
      id: student.id,
      student_id: student.id,
      subject: subject,
      term: termNum,
      period: periodVal,
      body: '',
      author_role: null,
      full_name: student.full_name,
      reg_no: student.reg_no,
      class_level: student.class_level,
      stream: student.stream,
      passport_path: student.passport_path,
      _missing: true,
    };
  }

  async function fetchRoster(pk) {
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', pk.classLevel);
    if (pk.stream) u.searchParams.set('stream', pk.stream);
    const res = await fetch(u);
    return res.ok ? await res.json() : [];
  }

  async function loadGradingBands() {
    try {
      const res = await fetch('/api/settings/grading-scale');
      const data = res.ok ? await res.json() : { bands: [] };
      gradingBands = normalizeBandsClient(data.bands || []);
    } catch (_) {
      gradingBands = [];
    }
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
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      if (n >= b.min && n <= b.max) {
        return { agg: b.agg, remark: b.remark };
      }
    }
    return { agg: '', remark: '' };
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

  function isPrimaryAggregateSubject(subject) {
    return PRIMARY_AGGREGATE_SUBJECT_KEYS.indexOf(primarySubjectKey(subject)) !== -1;
  }

  function primaryAggregateFromMarkRowsLocal(rows) {
    const grades = [];
    (rows || []).forEach(function (r) {
      if (!isPrimaryAggregateSubject(r.subject)) return;
      const g = parseAggDigit(r.agg);
      if (g != null) grades.push(g);
    });
    if (!grades.length) {
      return { sum: null, count: 0, equivalentAggregate: null, division: '' };
    }
    const sum = grades.reduce(function (a, b) {
      return a + b;
    }, 0);
    const n = grades.length;
    const equiv = Math.round((sum / n) * 4);
    const e = Math.max(4, Math.min(36, equiv));
    let div = '';
    if (e >= 4 && e <= 12) div = 'I';
    else if (e >= 13 && e <= 23) div = 'II';
    else if (e >= 24 && e <= 29) div = 'III';
    else if (e >= 30 && e <= 34) div = 'IV';
    else div = 'U';
    return { sum: sum, count: n, equivalentAggregate: e, division: div };
  }

  function initialsFromDisplayName() {
    try {
      let name = localStorage.getItem('ocean_displayName') || '';
      name = name.replace(/^(Mrs?|Ms|Miss|Mr|Dr)\.?\s+/i, '').trim();
      if (!name) return '';
      const parts = name.split(/\s+/).filter(Boolean).slice(0, 4);
      return parts
        .map(function (p) {
          return p.charAt(0).toUpperCase();
        })
        .join('.');
    } catch (_) {
      return '';
    }
  }

  function markForStudent(sid, sub) {
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    const sk = studentKey(sid);
    const subTrim = String(sub || '').trim();
    return markRows.find(function (r) {
      return (
        studentKey(r.student_id) === sk &&
        String(r.subject || '').trim() === subTrim &&
        Number(r.term) === t &&
        String(r.period) === String(p)
      );
    });
  }

  function refreshMarksSystemOut() {
    const el = document.getElementById('cr-m-system-out');
    const scoredEl = document.getElementById('cr-m-scored');
    if (!el || !scoredEl || !currentMarksMode()) return;
    const raw = scoredEl.value.trim();
    const ini = initialsFromDisplayName();
    const s = entries[idx];
    const sub = elSubjectPick.value.trim();
    if (!s || !s._markMode) {
      el.innerHTML = '';
      return;
    }
    if (raw === '') {
      el.innerHTML =
        '<p class="cc-m-system-placeholder">Enter <strong>marks scored</strong> (out of 100). <strong>Grade</strong> and <strong>remark</strong> follow your grading scale. <strong>Overall division</strong> uses all subject grades for this learner.</p>';
      return;
    }
    const scored = Number(raw);
    if (Number.isNaN(scored) || scored < 0) {
      el.innerHTML = '<p class="cc-m-system-warn">Enter a valid number for marks scored (0–100).</p>';
      return;
    }
    if (scored > MARKS_OUT_OF) {
      el.innerHTML = '<p class="cc-m-system-warn">Marks scored cannot exceed 100.</p>';
      return;
    }
    if (!gradingBands.length) {
      el.innerHTML =
        '<p class="cc-m-system-warn">No grading scale found. Under <strong>Settings</strong>, save a Primary marks grading scale.</p>';
      return;
    }
    const g = gradeFromPercentClient(scored, gradingBands);
    const t = elTerm.value;
    const p = elPeriod.value;
    const merged = [];
    markRows.forEach(function (r) {
      if (studentKey(r.student_id) !== studentKey(s.id)) return;
      if (String(r.term) !== String(t) || r.period !== p) return;
      if (String(r.subject || '').trim() === String(sub).trim()) return;
      merged.push({ subject: r.subject, agg: r.agg });
    });
    if (g.agg) merged.push({ subject: sub, agg: g.agg });
    const tot = primaryAggregateFromMarkRowsLocal(merged);
    const iniLine = ini
      ? escapeHtml(ini)
      : '<span class="cc-m-system-missing">— set <strong>Display name</strong> in Settings</span>';
    const iniHint = ini
      ? ''
      : '<p class="cc-m-system-warn cc-m-system-warn-soft">Initials are taken from your display name under Settings.</p>';
    const divLine =
      tot.count > 0
        ? '<li><strong>Total grade sum</strong>: ' +
          tot.sum +
          ' <span class="label-hint">(' +
          tot.count +
          ' subject' +
          (tot.count === 1 ? '' : 's') +
          ')</span></li>' +
          '<li><strong>4-subject equivalent aggregate</strong>: ' +
          (tot.equivalentAggregate != null ? tot.equivalentAggregate : '—') +
          '</li>' +
          '<li><strong>Overall division</strong> (combined grades): ' +
          escapeHtml(tot.division || '—') +
          '</li>'
        : '<li><strong>Overall division</strong>: — <span class="label-hint">(enter marks in other subjects too)</span></li>';
    el.innerHTML =
      '<h4 class="cc-m-system-title">System grading</h4>' +
      '<ul class="cc-m-system-list">' +
      '<li><strong>Percentage</strong>: ' +
      scored.toFixed(1) +
      '%</li>' +
      '<li><strong>Grade (AGG)</strong>: ' +
      escapeHtml(g.agg || '—') +
      ' <span class="label-hint">(1 = best)</span></li>' +
      '<li><strong>Remark</strong>: ' +
      escapeHtml(g.remark || '—') +
      '</li>' +
      divLine +
      '<li><strong>Teacher initials</strong>: ' +
      iniLine +
      '</li></ul>' +
      iniHint;
  }

  async function loadMarkRowsForClass() {
    const pk = parseClassPick();
    if (!pk || !isPrimaryLevel(pk.classLevel)) {
      markRows = [];
      return;
    }
    const mu = new URL('/api/marks', window.location.origin);
    mu.searchParams.set('classLevel', pk.classLevel);
    if (pk.stream) mu.searchParams.set('stream', pk.stream);
    mu.searchParams.set('term', elTerm.value);
    mu.searchParams.set('period', elPeriod.value);
    const res = await fetch(mu);
    let raw = [];
    try {
      raw = res.ok ? await res.json() : [];
    } catch (_) {
      raw = [];
    }
    markRows = Array.isArray(raw) ? raw : [];
  }

  async function buildEntries() {
    const pk = parseClassPick();
    const subj = elSubjectPick.value.trim();
    const subjTrim = String(subj).trim();
    const t = Number(elTerm.value);
    const p = elPeriod.value;

    if (pk && subj && isMarksSubjectForClass(pk.classLevel, subj)) {
      const roster = await fetchRoster(pk);
      roster.sort(function (a, b) {
        return String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, { sensitivity: 'base' });
      });
      entries = roster.map(function (s) {
        return Object.assign({}, s, {
          _markMode: true,
          student_id: s.id,
          subject: subjTrim,
          class_level: s.class_level,
          stream: s.stream,
        });
      });
    } else if (pk && subj) {
      const roster = await fetchRoster(pk);
      roster.sort(function (a, b) {
        return String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, { sensitivity: 'base' });
      });
      const byId = new Map();
      allRows.forEach(function (r) {
        if (
          String(r.subject || '').trim() === subjTrim &&
          Number(r.term) === Number(t) &&
          String(r.period || '').trim() === String(p || '').trim()
        ) {
          byId.set(studentKey(r.student_id), r);
        }
      });
      entries = roster.map(function (s) {
        const row = byId.get(studentKey(s.id));
        if (row) {
          return Object.assign({}, row, { id: s.id, student_id: s.id });
        }
        return syntheticSlot(s, subjTrim, t, p);
      });
    } else if (!pk) {
      entries = allRows.filter(function (r) {
        if (subj && String(r.subject || '').trim() !== subjTrim) return false;
        return true;
      });
    } else {
      entries = allRows.filter(function (r) {
        if (subj && String(r.subject || '').trim() !== subjTrim) return false;
        return true;
      });
    }

    idx = Math.max(0, Math.min(idx, Math.max(0, entries.length - 1)));
    renderCarousel();
    showEntry();
    updateSummary();
    updatePeriodLabel();
  }

  async function reloadAll() {
    await loadGradingBands();
    const pk = parseClassPick();
    const u = new URL('/api/comments/school-review', window.location.origin);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    if (pk) {
      u.searchParams.set('classLevel', pk.classLevel);
      if (pk.stream) u.searchParams.set('stream', pk.stream);
    }
    const res = await fetch(u);
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {
      payload = null;
    }
    allRows = Array.isArray(payload) ? payload : [];
    if (!res.ok) {
      const err =
        payload && typeof payload === 'object' && payload.error
          ? String(payload.error)
          : 'Could not load comments.';
      const flash = document.getElementById('flash');
      if (flash) {
        flash.innerHTML = '<div class="msg err">' + escapeHtml(err) + '</div>';
        setTimeout(function () {
          flash.innerHTML = '';
        }, 5000);
      }
    }
    await loadMarkRowsForClass();
    await buildEntries();
  }

  function mergeUpdatedRow(prevRow, data) {
    if (!prevRow || !data) return;
    [allRows, entries].forEach(function (arr) {
      arr.forEach(function (r) {
        if (
          studentKey(r.student_id) === studentKey(prevRow.student_id) &&
          String(r.subject || '').trim() === String(prevRow.subject || '').trim() &&
          Number(r.term) === Number(prevRow.term) &&
          String(r.period || '').trim() === String(prevRow.period || '').trim()
        ) {
          if (data.body != null) r.body = data.body;
          if (data.updated_at) r.updated_at = data.updated_at;
          if (data.id != null) r.id = data.id;
          if (data.author_role != null) r.author_role = data.author_role;
          if (r._missing) delete r._missing;
        }
      });
    });
  }

  function renderCarousel() {
    elCarousel.innerHTML = '';
    const subj = elSubjectPick.value.trim();
    entries.forEach(function (e, i) {
      const div = document.createElement('div');
      div.className = 'comments-carousel-item' + (i === idx ? ' selected' : '');
      const img = e.passport_path
        ? '<img src="' + escapeHtml(e.passport_path) + '" alt="" />'
        : '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2256%22 height=%2256%22%3E%3Crect fill=%22%231e5078%22 width=%2256%22 height=%2256%22/%3E%3C/svg%3E" alt="" />';
      const sub = escapeHtml(e.subject || subj || '');
      const nm = escapeHtml(e.full_name || '');
      let miss = '';
      if (e._markMode) {
        const mr = markForStudent(e.id, subj);
        if (!mr || mr.marks_scored == null || String(mr.marks_scored).trim() === '') {
          miss = '<span style="font-size:0.65rem;color:var(--muted)">·</span>';
        }
      } else if (e._missing === true) {
        miss = '<span style="font-size:0.65rem;color:var(--muted)">·</span>';
      }
      div.innerHTML =
        img +
        '<span style="display:block;max-width:5.5rem;overflow:hidden;text-overflow:ellipsis">' +
        nm +
        '</span><span style="display:block;font-size:0.72rem;color:var(--muted);max-width:5.5rem;overflow:hidden;text-overflow:ellipsis">' +
        sub +
        miss +
        '</span>';
      div.title = (e.full_name || '') + ' · ' + labelClass(e.class_level, e.stream) + ' · ' + (e.subject || subj || '');
      div.addEventListener('click', function () {
        idx = i;
        renderCarousel();
        showEntry();
        updateSummary();
      });
      elCarousel.appendChild(div);
    });
  }

  function fillMarkForCurrent() {
    const scoredEl = document.getElementById('cr-m-scored');
    if (!scoredEl) return;
    const e = entries[idx];
    if (!e || !e._markMode) {
      scoredEl.value = '';
      return;
    }
    const sub = elSubjectPick.value.trim();
    const row = markForStudent(e.id, sub);
    scoredEl.value =
      row && row.marks_scored != null && row.marks_scored !== '' ? String(row.marks_scored) : '';
    refreshMarksSystemOut();
  }

  function showEntry() {
    const e = entries[idx];
    const ph = document.getElementById('cr-profile-photo');
    const marksPanel = elMarksPanel;
    const commentBlock = elCommentBlock;

    if (!e) {
      if (marksPanel) marksPanel.style.display = 'none';
      if (commentBlock) commentBlock.style.display = 'block';
      ph.innerHTML = '';
      document.getElementById('cr-d-name').textContent = '—';
      document.getElementById('cr-d-class').textContent = '—';
      document.getElementById('cr-d-subject').textContent = '—';
      document.getElementById('cr-d-reg').textContent = '—';
      document.getElementById('cr-d-author').textContent = '—';
      if (elLearnerTitle) elLearnerTitle.textContent = 'Learner & comment context';
      if (elAuthorLabel) elAuthorLabel.textContent = 'Author (original)';
      elBody.value = '';
      elChar.textContent = '0 / ' + MAX;
      elBody.disabled = true;
      elBody.readOnly = true;
      elBody.classList.add('comments-readonly');
      const scoredEl = document.getElementById('cr-m-scored');
      if (scoredEl) scoredEl.value = '';
      const sys = document.getElementById('cr-m-system-out');
      if (sys) sys.innerHTML = '';
      return;
    }

    if (e._markMode) {
      if (marksPanel) marksPanel.style.display = 'block';
      if (commentBlock) commentBlock.style.display = 'none';
      if (elLearnerTitle) elLearnerTitle.textContent = 'Learner & marks (Primary)';
      if (elAuthorLabel) elAuthorLabel.textContent = 'Initials on file';
      elBody.disabled = true;
      elBody.readOnly = true;
      ph.innerHTML = e.passport_path
        ? '<img src="' + escapeHtml(e.passport_path) + '" alt="" />'
        : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">No photo</div>';
      document.getElementById('cr-d-name').textContent = e.full_name || '—';
      document.getElementById('cr-d-class').textContent = labelClass(e.class_level, e.stream);
      document.getElementById('cr-d-subject').textContent = e.subject || elSubjectPick.value.trim() || '—';
      document.getElementById('cr-d-reg').textContent = e.reg_no || '—';
      const sub = elSubjectPick.value.trim();
      const mrow = markForStudent(e.id, sub);
      document.getElementById('cr-d-author').textContent =
        mrow && mrow.initials ? String(mrow.initials) : '—';
      fillMarkForCurrent();
      return;
    }

    if (marksPanel) marksPanel.style.display = 'none';
    if (commentBlock) commentBlock.style.display = 'block';
    if (elLearnerTitle) elLearnerTitle.textContent = 'Learner & comment context';
    if (elAuthorLabel) elAuthorLabel.textContent = 'Author (original)';
    const scoredEl = document.getElementById('cr-m-scored');
    if (scoredEl) scoredEl.value = '';
    const sys = document.getElementById('cr-m-system-out');
    if (sys) sys.innerHTML = '';

    const missing = e._missing === true;
    elBody.disabled = false;
    elBody.readOnly = missing;
    elBody.classList.toggle('comments-readonly', missing);
    ph.innerHTML = e.passport_path
      ? '<img src="' + escapeHtml(e.passport_path) + '" alt="" />'
      : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">No photo</div>';
    document.getElementById('cr-d-name').textContent = e.full_name || '—';
    document.getElementById('cr-d-class').textContent = labelClass(e.class_level, e.stream);
    document.getElementById('cr-d-subject').textContent = e.subject || '—';
    document.getElementById('cr-d-reg').textContent = e.reg_no || '—';
    document.getElementById('cr-d-author').textContent = missing ? 'No comment saved yet' : authorLabel(e.author_role);
    elBody.value = e.body != null ? String(e.body) : '';
    elChar.textContent = elBody.value.length + ' / ' + MAX;
  }

  function updateSummary() {
    const n = entries.length;
    const pos = n ? idx + 1 : 0;
    const pk = parseClassPick();
    const subj = elSubjectPick.value.trim();
    if (n === 0) {
      elSummaryLine.textContent = pk
        ? 'No learners or comments in this view. Pick a subject from the list, or click Reload list.'
        : 'Pick a class group and subject to review every learner, or browse all saved comment rows for the whole school.';
      elSummaryPct.textContent = '—';
      elSummaryFill.style.width = '0%';
      return;
    }
    if (pk && subj && currentMarksMode()) {
      const done = entries.filter(function (e) {
        const row = markForStudent(e.id, subj);
        return row && row.marks_scored != null && String(row.marks_scored).trim() !== '';
      }).length;
      elSummaryLine.textContent =
        'Learner ' +
        pos +
        ' of ' +
        n +
        ' · marks for ' +
        subj +
        ': ' +
        done +
        ' / ' +
        n +
        ' entered (same as class dashboard).';
    } else if (pk && subj) {
      const saved = entries.filter(function (e) {
        return e._missing !== true && e.body && String(e.body).trim();
      }).length;
      elSummaryLine.textContent =
        'Learner ' +
        pos +
        ' of ' +
        n +
        ' · ' +
        saved +
        ' / ' +
        n +
        ' with a teacher comment for ' +
        subj +
        '.';
    } else {
      elSummaryLine.textContent = 'Row ' + pos + ' of ' + n + ' · ' + allRows.length + ' row(s) loaded for this filter.';
    }
    const pct = n ? Math.round((pos / n) * 100) : 0;
    elSummaryPct.textContent = n ? pct + '% through list' : '—';
    elSummaryFill.style.width = n ? pct + '%' : '0%';
  }

  async function rosterForEntry(e) {
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', e.class_level);
    if (e.stream) u.searchParams.set('stream', e.stream);
    const res = await fetch(u);
    return res.ok ? await res.json() : [];
  }

  async function polishCommentText(body, roster, preferredId) {
    try {
      const pr = await fetch('/api/assist/comment-polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: body,
          students: roster.map(function (r) {
            return { id: r.id, full_name: r.full_name };
          }),
          preferredStudentId: preferredId,
        }),
      });
      if (!pr.ok) return { text: body, changed: false };
      const d = await pr.json().catch(function () {
        return {};
      });
      if (!d.text || typeof d.text !== 'string') return { text: body, changed: false };
      return { text: d.text, changed: d.text !== body };
    } catch (_) {
      return { text: body, changed: false };
    }
  }

  async function saveMark() {
    const e = entries[idx];
    if (!e || !e._markMode) return false;
    const sub = elSubjectPick.value.trim();
    const scoredEl = document.getElementById('cr-m-scored');
    const scoredInp = scoredEl ? scoredEl.value.trim() : '';
    const scoredNum = scoredInp === '' ? null : Number(scoredInp);
    if (scoredInp !== '' && (Number.isNaN(scoredNum) || scoredNum < 0)) {
      alert('Enter a valid marks scored value, or leave blank to clear.');
      return false;
    }
    if (scoredInp !== '' && scoredNum > MARKS_OUT_OF) {
      alert('Marks scored cannot exceed 100.');
      return false;
    }
    if (scoredInp !== '' && !initialsFromDisplayName()) {
      alert('Set your display name under Settings so initials can be saved with marks (same as class teachers).');
      return false;
    }
    const res = await fetch('/api/marks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: e.id,
        subject: sub,
        term: Number(elTerm.value),
        period: elPeriod.value,
        marks_scored: scoredNum,
        initials: initialsFromDisplayName(),
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      alert(data.error || 'Could not save marks');
      return false;
    }
    await loadMarkRowsForClass();
    fillMarkForCurrent();
    updateSummary();
    renderCarousel();
    const flash = document.getElementById('flash');
    if (flash) {
      flash.innerHTML = '<div class="msg ok">' + (data.deleted ? 'Marks cleared.' : 'Marks saved.') + '</div>';
      setTimeout(function () {
        flash.innerHTML = '';
      }, 3000);
    }
    if (window.__oceanHead && window.__oceanHead.addNotification) {
      window.__oceanHead.addNotification(
        (data.deleted ? 'Cleared marks' : 'Updated marks') +
          ' — ' +
          sub +
          ' · ' +
          (e.full_name || '') +
          ' · ' +
          labelClass(e.class_level, e.stream)
      );
    }
    return true;
  }

  async function saveComment() {
    const e = entries[idx];
    if (!e) {
      alert('Nothing to save — no row selected.');
      return false;
    }
    if (e._markMode) return saveMark();
    if (e._missing === true) {
      alert(
        'No teacher comment has been saved for this learner and subject yet. Add it from the class dashboard (or Skills for vocational subjects), then reload here.'
      );
      return false;
    }
    let body = elBody.value.trim();
    if (!body) {
      alert('Comment cannot be empty. Open the class dashboard if you need to remove a row entirely.');
      return false;
    }
    if (body.length > MAX) body = body.slice(0, MAX);
    const res = await fetch('/api/comments/head-review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: e.student_id,
        subject: String(e.subject || '').trim(),
        term: Number(elTerm.value),
        period: elPeriod.value,
        body: body,
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      alert(data.error || 'Could not save');
      return false;
    }
    mergeUpdatedRow(e, data);
    Object.assign(e, data);
    delete e._missing;
    const flash = document.getElementById('flash');
    if (flash) {
      flash.innerHTML = '<div class="msg ok">Saved.</div>';
      setTimeout(function () {
        flash.innerHTML = '';
      }, 3000);
    }
    if (window.__oceanHead && window.__oceanHead.addNotification) {
      window.__oceanHead.addNotification(
        'Updated comment — ' +
          (e.subject || '') +
          ' · ' +
          (e.full_name || '') +
          ' · ' +
          labelClass(e.class_level, e.stream)
      );
    }
    showEntry();
    renderCarousel();
    updateSummary();
    return true;
  }

  async function saveEntry() {
    const e = entries[idx];
    if (e && e._markMode) return saveMark();
    return saveComment();
  }

  function moveIdx(delta) {
    if (!entries.length) return;
    idx = Math.max(0, Math.min(entries.length - 1, idx + delta));
    renderCarousel();
    showEntry();
    updateSummary();
    const ch = elCarousel.children[idx];
    if (ch) ch.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  elTerm.addEventListener('change', function () {
    reloadAll();
  });
  elPeriod.addEventListener('change', function () {
    reloadAll();
  });
  elClassPick.addEventListener('change', function () {
    elSubjectPick.value = '';
    rebuildSubjectOptionsFromClass();
    reloadAll();
  });
  elSubjectPick.addEventListener('change', function () {
    reloadAll();
  });
  document.getElementById('cr-reload').addEventListener('click', reloadAll);
  elBody.addEventListener('input', function () {
    if (!elBody.readOnly) elChar.textContent = elBody.value.length + ' / ' + MAX;
  });

  const scoredInput = document.getElementById('cr-m-scored');
  if (scoredInput) {
    scoredInput.addEventListener('input', function () {
      refreshMarksSystemOut();
    });
  }

  document.getElementById('cr-prev').addEventListener('click', function () {
    moveIdx(-1);
  });
  document.getElementById('cr-next').addEventListener('click', function () {
    moveIdx(1);
  });
  document.getElementById('cr-save-only').addEventListener('click', function () {
    saveEntry();
  });
  document.getElementById('cr-save-next').addEventListener('click', async function () {
    const ok = await saveEntry();
    if (ok) moveIdx(1);
  });
  document.getElementById('cr-save-prev').addEventListener('click', async function () {
    const ok = await saveEntry();
    if (ok) moveIdx(-1);
  });

  rebuildSubjectOptionsFromClass();

  window.__oceanHeadCommentReviewInit = function () {
    rebuildSubjectOptionsFromClass();
    updatePeriodLabel();
    reloadAll();
  };
})();
