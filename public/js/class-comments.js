/**
 * Class dashboard — Comments + marks (Primary non-skill) + Comment export.
 * Depends on window.__oceanDashboard from dashboard.js
 */
(function () {
  const panel = document.getElementById('panel-comments');
  const skillReportsPanel = document.getElementById('panel-skill-reports');
  const learnerLookupPanel = document.getElementById('panel-learner-lookup');
  if (!window.__oceanDashboard) return;
  if (!panel && !skillReportsPanel && !learnerLookupPanel) return;

  const ctx = window.__oceanDashboard;
  const skillList = ctx.skillOnlySubjects || [];
  const isPrimary = !!ctx.isPrimary;
  /** All primary marks are out of 100 (grading % = marks scored). */
  const MARKS_OUT_OF = 100;

  const elSubject = document.getElementById('cc-subject');
  const elTerm = document.getElementById('cc-term');
  const elPeriod = document.getElementById('cc-period');
  const elPeriodLabel = document.getElementById('cc-period-label');
  const elBanner = document.getElementById('cc-readonly-banner');
  const elBody = document.getElementById('cc-body');
  const elChar = document.getElementById('cc-char-count');
  const elCarousel = document.getElementById('cc-carousel');
  const elSummaryLine = document.getElementById('cc-summary-line');
  const elSummaryPct = document.getElementById('cc-summary-pct');
  const elSummaryFill = document.getElementById('cc-summary-fill');
  const elMarksPanel = document.getElementById('cc-marks-panel');
  const elCommentPanel = document.getElementById('cc-comment-panel');
  const elCTBody = document.getElementById('cc-ct-body');
  const elCTChar = document.getElementById('cc-ct-char-count');
  const elCTSummaryLine = document.getElementById('cc-ct-summary-line');

  let students = [];
  let idx = 0;
  let commentRows = [];
  let markRows = [];
  let classTeacherRows = [];
  let gradingBands = [];
  let schoolReportingYear = new Date().getFullYear();
  let commentsPollTimer = null;
  const serverSnap = { subjectBody: '', classTeacherBody: '', marksScored: '' };

  function authHeaders() {
    const base = { 'Content-Type': 'application/json' };
    const auth = window.OceanStaffAuth;
    return auth && auth.authHeaders ? Object.assign({}, base, auth.authHeaders()) : base;
  }

  function syncServerSnapFromRows() {
    const s = students[idx];
    if (!s) {
      serverSnap.subjectBody = '';
      serverSnap.classTeacherBody = '';
      serverSnap.marksScored = '';
      return;
    }
    serverSnap.subjectBody = String(commentForStudent(s.id) || '').trim();
    serverSnap.classTeacherBody = String(classTeacherForStudent(s.id) || '').trim();
    const row = markForStudent(s.id);
    serverSnap.marksScored =
      row && row.marks_scored != null && row.marks_scored !== '' ? String(row.marks_scored).trim() : '';
  }

  function fieldIsDirty(kind) {
    const s = students[idx];
    if (!s) return false;
    if (kind === 'subject') return elBody.value.trim() !== serverSnap.subjectBody;
    if (kind === 'classTeacher') return elCTBody && elCTBody.value.trim() !== serverSnap.classTeacherBody;
    if (kind === 'marks') {
      const scoredEl = document.getElementById('cc-m-scored');
      if (!scoredEl) return false;
      return scoredEl.value.trim() !== serverSnap.marksScored;
    }
    return false;
  }

  function applyRemoteCommentChanges() {
    const s = students[idx];
    if (!s) return;
    if (!fieldIsDirty('subject') && document.activeElement !== elBody) fillCommentForCurrent();
    if (elCTBody && !fieldIsDirty('classTeacher') && document.activeElement !== elCTBody) fillClassTeacherForCurrent();
    const scoredEl = document.getElementById('cc-m-scored');
    if (scoredEl && !fieldIsDirty('marks') && document.activeElement !== scoredEl) fillMarkForCurrent();
    syncServerSnapFromRows();
    updateSummary();
    updateClassTeacherSummary();
  }

  async function pollCommentsRemote() {
    if (document.visibilityState !== 'visible') return;
    if (!panel.classList.contains('active')) return;
    try {
      const prevSubject = JSON.stringify(commentRows);
      const prevMarks = JSON.stringify(markRows);
      const prevCT = JSON.stringify(classTeacherRows);
      await Promise.all([loadComments(), loadMarks(), loadClassTeacherComments()]);
      const changed =
        prevSubject !== JSON.stringify(commentRows) ||
        prevMarks !== JSON.stringify(markRows) ||
        prevCT !== JSON.stringify(classTeacherRows);
      if (changed) applyRemoteCommentChanges();
    } catch (_) {}
  }

  function pauseCommentsPolling() {
    if (commentsPollTimer) {
      clearInterval(commentsPollTimer);
      commentsPollTimer = null;
    }
  }

  function startCommentsPolling() {
    pauseCommentsPolling();
    commentsPollTimer = setInterval(pollCommentsRemote, 8000);
  }

  window.__oceanCommentsPause = pauseCommentsPolling;
  window.__oceanCommentsStartPolling = startCommentsPolling;

  function labelClass() {
    return ctx.displayTitle + (ctx.stream ? ' (' + (ctx.streamLabels[ctx.stream] || ctx.stream) + ')' : '');
  }

  function periodLabel(period) {
    if (period === 'begin') return 'Beginning of term';
    return period === 'mid' ? 'Mid term' : 'End of term';
  }

  function periodCycleLabel(period) {
    if (period === 'begin') return 'beginning';
    return period === 'mid' ? 'mid' : 'end';
  }

  function periodShortLabel(period) {
    if (period === 'begin') return 'Begin';
    return period === 'mid' ? 'Mid' : 'End';
  }

  function periodHeadingWord(period) {
    if (period === 'begin') return 'BEGINNING OF TERM';
    return period === 'mid' ? 'MID TERM' : 'END TERM';
  }

  function periodTitle() {
    const t = elTerm.value;
    const p = elPeriod.value;
    return periodLabel(p) + ' · Term ' + t;
  }

  function updatePeriodLabel() {
    const t = elTerm.value;
    const p = elPeriod.value;
    elPeriodLabel.textContent = periodLabel(p) + ' ' + t + ' — reporting for Term ' + t + ' (' + periodCycleLabel(p) + ' cycle)';
  }

  function insertCommentSnippet(textarea, snippet, opts) {
    if (!textarea || !snippet) return;
    const clean = String(snippet).trim();
    if (!clean) return;
    const replace = opts && opts.replace;
    if (replace) {
      textarea.value = clean;
      if (typeof textarea.setSelectionRange === 'function') {
        textarea.setSelectionRange(clean.length, clean.length);
      }
    } else {
      const raw = String(textarea.value || '');
      const start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : raw.length;
      const end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : raw.length;
      const before = raw.slice(0, start);
      const after = raw.slice(end);
      const prefix = before && !/\s$/.test(before) ? ' ' : '';
      const suffix = after && !/^\s/.test(after) ? ' ' : '';
      const next = before + prefix + clean + suffix + after;
      textarea.value = next;
      const caret = (before + prefix + clean).length;
      if (typeof textarea.setSelectionRange === 'function') textarea.setSelectionRange(caret, caret);
    }
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  let quickBankFetchToken = 0;

  function ensureCommentPicker(bank, textarea) {
    let slot = bank.querySelector('.comment-bank-slot');
    if (slot) {
      return {
        openBtn: slot.querySelector('.comment-bank-open'),
        picker: slot.querySelector('.comment-bank-picker'),
        list: slot.querySelector('.comment-bank-list'),
      };
    }
    const old = bank.querySelector('.comment-bank-buttons');
    if (old) old.remove();
    slot = document.createElement('div');
    slot.className = 'comment-bank-slot';
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn comment-bank-open';
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.setAttribute('aria-haspopup', 'listbox');
    const picker = document.createElement('div');
    picker.className = 'comment-bank-picker';
    picker.hidden = true;
    const list = document.createElement('ul');
    list.className = 'comment-bank-list';
    list.setAttribute('role', 'listbox');
    picker.appendChild(list);
    slot.appendChild(openBtn);
    slot.appendChild(picker);
    bank.appendChild(slot);
    openBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const show = picker.hidden;
      document.querySelectorAll('.comment-bank-picker').forEach(function (p) {
        if (p !== picker) p.hidden = true;
      });
      document.querySelectorAll('.comment-bank-open').forEach(function (b) {
        if (b !== openBtn) b.setAttribute('aria-expanded', 'false');
      });
      picker.hidden = !show;
      openBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    });
    picker.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
    if (!bank._pickerOutsideClose) {
      bank._pickerOutsideClose = true;
      document.addEventListener('click', function () {
        picker.hidden = true;
        openBtn.setAttribute('aria-expanded', 'false');
      });
    }
    return { openBtn: openBtn, picker: picker, list: list };
  }

  function renderDynamicCommentBank(bankId, textarea, items) {
    const bank = document.getElementById(bankId);
    if (!bank) return;
    const hasItems = !!(items && items.length);
    bank.hidden = !hasItems;
    bank.style.display = hasItems ? '' : 'none';
    const ui = ensureCommentPicker(bank, textarea);
    ui.list.innerHTML = '';
    ui.picker.hidden = true;
    ui.openBtn.setAttribute('aria-expanded', 'false');
    if (!hasItems) {
      ui.openBtn.disabled = true;
      ui.openBtn.textContent = 'Suggested comments (add weekly progress first)';
      return;
    }
    const seen = {};
    const unique = [];
    (items || []).forEach(function (item) {
      const s = String(item && item.snippet ? item.snippet : '').trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      unique.push({ snippet: s });
    });
    ui.openBtn.disabled = false;
    ui.openBtn.textContent = 'Choose a suggested comment (' + unique.length + ')';
    unique.forEach(function (item, i) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'comment-bank-pick';
      btn.textContent = item.snippet;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        insertCommentSnippet(textarea, item.snippet, { replace: true });
        ui.picker.hidden = true;
        ui.openBtn.setAttribute('aria-expanded', 'false');
      });
      li.appendChild(btn);
      ui.list.appendChild(li);
    });
  }

  function applyQuickCommentBanks(subject, rows) {
    const QC = window.OceanQuickComments;
    if (!QC) return;
    const weeklyRows = Array.isArray(rows)
      ? rows.filter(function (r) {
          return String((r && r.band) || '').trim();
        })
      : [];
    if (!weeklyRows.length) {
      renderDynamicCommentBank('cc-comment-bank', elBody, []);
      renderDynamicCommentBank('cc-ct-bank', elCTBody, []);
      return;
    }
    const s = students[idx];
    const name = s ? QC.learnerEnglishFirstName(s.full_name) : 'Learner';
    const summary = QC.summarizeWeeklyBands(weeklyRows);
    const seedBase = s
      ? {
          studentId: s.id,
          name: name,
          subject: subject,
          classLevel: ctx.classLevel,
          summary: summary,
          weeklyRows: weeklyRows,
        }
      : { name: name, subject: subject || '', classLevel: ctx.classLevel, summary: summary, weeklyRows: weeklyRows };

    const subjectItems = QC.buildSubjectComments(seedBase);
    const ctItems = QC.buildClassTeacherComments(seedBase);
    renderDynamicCommentBank('cc-comment-bank', elBody, subjectItems);
    renderDynamicCommentBank('cc-ct-bank', elCTBody, ctItems);
  }

  async function refreshQuickCommentBanks() {
    const QC = window.OceanQuickComments;
    if (!QC) return;
    const s = students[idx];
    const subject = elSubject.value;
    const term = Number(elTerm.value || 1);
    const token = ++quickBankFetchToken;

    applyQuickCommentBanks(subject, []);

    let rows = [];
    if (s && subject) {
      try {
        const u = new URL('/api/weekly-bands', window.location.origin);
        u.searchParams.set('classLevel', ctx.classLevel);
        if (ctx.stream) u.searchParams.set('stream', ctx.stream);
        u.searchParams.set('subject', subject);
        u.searchParams.set('term', String(term));
        u.searchParams.set('student_id', String(s.id));
        const res = await fetch(u);
        rows = res.ok ? await res.json().catch(function () { return []; }) : [];
      } catch (_) {
        rows = [];
      }
    }
    if (token !== quickBankFetchToken) return;
    if (elSubject.value !== subject) return;

    applyQuickCommentBanks(subject, rows);
  }

  function subjectOptions() {
    elSubject.innerHTML = '';
    const list = ctx.subjects.slice();
    if (!list.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '—';
      elSubject.appendChild(o);
      return;
    }
    list.forEach(function (s) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      elSubject.appendChild(o);
    });
  }

  function isSkillSubject() {
    const sub = elSubject.value;
    return skillList.indexOf(sub) !== -1;
  }

  function isReadOnlySubject() {
    return false;
  }

  function isMarksSubject() {
    return isPrimary && elSubject.value && !isSkillSubject();
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

  /** Bands use percentage 0–100 (= marks scored; each assessment is out of 100). */
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
    const x = parseInt(String(agg == null ? '' : agg).trim(), 10);
    if (Number.isNaN(x) || x < 1 || x > 9) return null;
    return x;
  }

  /** Same logic as server lib/primaryDivision.js — DIV from total grades, not per band */
  function primaryAggregateFromMarkRowsLocal(rows) {
    const grades = [];
    (rows || []).forEach(function (r) {
      if (skillList.indexOf(r.subject) !== -1) return;
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

  /** Same key as Settings (settings.js): ocean_displayName */
  function initialsFromDisplayName() {
    try {
      const suffix =
        '_' +
        String(ctx.classLevel || '')
          .trim()
          .toLowerCase() +
        '_' +
        (String(ctx.stream || '')
          .trim()
          .toLowerCase() || '_');
      let name =
        (window.OceanSettings && typeof window.OceanSettings.getDisplayName === 'function'
          ? window.OceanSettings.getDisplayName()
          : '') ||
        localStorage.getItem('ocean_displayName' + suffix) ||
        localStorage.getItem('ocean_displayName') ||
        '';
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

  /** Live “system output” — grade & remark from scale; DIV from combined aggregates across subjects */
  function refreshMarksSystemOut() {
    const el = document.getElementById('cc-m-system-out');
    if (!el || !isMarksSubject()) return;
    const scoredEl = document.getElementById('cc-m-scored');
    if (!scoredEl) return;
    const raw = scoredEl.value.trim();
    const ini = initialsFromDisplayName();
    if (raw === '') {
      el.innerHTML =
        '<p class="cc-m-system-placeholder">Enter <strong>marks scored</strong> (out of 100). This subject’s <strong>grade</strong> and <strong>remark</strong> come from your grading scale. <strong>Overall division</strong> (not per subject) is worked out from the <strong>total of all subject grades</strong> for this learner (UNEB-style: equivalent 4-subject aggregate → Div I–IV or U).</p>';
      return;
    }
    const scored = Number(raw);
    if (Number.isNaN(scored) || scored < 0) {
      el.innerHTML = '<p class="cc-m-system-warn">Enter a valid number for marks scored (0–100).</p>';
      return;
    }
    if (scored > MARKS_OUT_OF) {
      el.innerHTML =
        '<p class="cc-m-system-warn">Marks scored cannot exceed 100 (each assessment is out of 100).</p>';
      return;
    }
    if (!gradingBands.length) {
      el.innerHTML =
        '<p class="cc-m-system-warn">No grading scale found. Under <strong>Settings</strong>, save a Primary marks grading scale (or use Uganda-style defaults).</p>';
      return;
    }
    const pct = scored;
    const g = gradeFromPercentClient(pct, gradingBands);
    const s = students[idx];
    const sub = elSubject.value;
    const t = elTerm.value;
    const p = elPeriod.value;
    const merged = [];
    markRows.forEach(function (r) {
      if (r.student_id !== s.id || String(r.term) !== String(t) || r.period !== p) return;
      if (r.subject === sub) return;
      merged.push({ subject: r.subject, agg: r.agg });
    });
    if (g.agg) merged.push({ subject: sub, agg: g.agg });
    const tot = primaryAggregateFromMarkRowsLocal(merged);
    const iniLine = ini
      ? escapeHtml(ini)
      : '<span class="cc-m-system-missing">— set <strong>Display name</strong> in Settings</span>';
    const iniHint = ini
      ? ''
      : '<p class="cc-m-system-warn cc-m-system-warn-soft">Initials are taken from your display name. Add it under Settings so reports show who entered the mark.</p>';
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
          '<li><strong>Overall division</strong> (from all subject grades combined, not this row alone): ' +
          escapeHtml(tot.division || '—') +
          '</li>'
        : '<li><strong>Overall division</strong>: — <span class="label-hint">(enter marks in other subjects too)</span></li>';
    el.innerHTML =
      '<h4 class="cc-m-system-title">System grading</h4>' +
      '<ul class="cc-m-system-list">' +
      '<li><strong>Percentage</strong>: ' +
      pct.toFixed(1) +
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

  function updateReadonlyUi() {
    const marksMode = isMarksSubject();
    if (elMarksPanel) elMarksPanel.style.display = marksMode ? 'block' : 'none';
    if (elCommentPanel) elCommentPanel.style.display = marksMode ? 'none' : 'block';
    if (window.__oceanTeacherMobile && window.__oceanTeacherMobile.syncMobileSubjectHeading) {
      window.__oceanTeacherMobile.syncMobileSubjectHeading();
    }

    const ro = false;
    elBanner.style.display = ro ? 'block' : 'none';
    elBanner.textContent = ro
      ? 'This subject is commented from the Skills workspace. You can read the comment below; editing is disabled here.'
      : '';
    elBody.readOnly = ro;
    elBody.classList.toggle('comments-readonly', ro);
    document.getElementById('cc-save-next').disabled = ro;
    document.getElementById('cc-save-prev').disabled = ro;
    document.getElementById('cc-save-only').disabled = ro;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
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

  async function loadStudents() {
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    const res = await fetch(u);
    students = res.ok ? await res.json() : [];
    idx = 0;
    renderCarousel();
  }

  async function loadComments() {
    const u = new URL('/api/comments', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('subject', elSubject.value);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    u.searchParams.set('year', String(selectedAcademicYear()));
    const res = await fetch(u);
    commentRows = res.ok ? await res.json() : [];
  }

  async function loadMarks() {
    const u = new URL('/api/marks', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    u.searchParams.set('year', String(selectedAcademicYear()));
    const res = await fetch(u);
    markRows = res.ok ? await res.json() : [];
  }

  async function loadClassTeacherComments() {
    if (!elCTBody) return;
    const u = new URL('/api/class-teacher-comments', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    u.searchParams.set('year', String(selectedAcademicYear()));
    const res = await fetch(u);
    classTeacherRows = res.ok ? await res.json() : [];
  }

  async function refreshSubjectRows() {
    if (isMarksSubject()) {
      await loadMarks();
      fillMarkForCurrent();
    } else {
      await loadComments();
      fillCommentForCurrent();
    }
    updateSummary();
  }

  function commentForStudent(sid) {
    const sub = elSubject.value;
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    const row = commentRows.find(function (r) {
      return r.student_id === sid && r.subject === sub && Number(r.term) === t && r.period === p;
    });
    return row ? row.body : '';
  }

  function classTeacherForStudent(sid) {
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    const row = classTeacherRows.find(function (r) {
      return r.student_id === sid && Number(r.term) === t && r.period === p;
    });
    return row ? row.body : '';
  }

  function fillClassTeacherForCurrent() {
    if (!elCTBody || !elCTChar) return;
    const s = students[idx];
    if (!s) {
      elCTBody.value = '';
      elCTChar.textContent = '0 / 300';
      return;
    }
    elCTBody.value = classTeacherForStudent(s.id);
    elCTChar.textContent = elCTBody.value.length + ' / 300';
    syncServerSnapFromRows();
  }

  function markForStudent(sid) {
    const sub = elSubject.value;
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    return markRows.find(function (r) {
      return r.student_id === sid && r.subject === sub && Number(r.term) === t && r.period === p;
    });
  }

  function scrollCarouselToSelected() {
    if (!elCarousel || !elCarousel.children.length) return;
    const item = elCarousel.children[idx];
    if (item) item.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  /** Start at first learner (e.g. after picking a new subject on the Comments tab). */
  function resetLearnerToFirst() {
    idx = 0;
    renderCarousel();
    showLearner();
    scrollCarouselToSelected();
  }

  function renderCarousel() {
    elCarousel.innerHTML = '';
    students.forEach(function (s, i) {
      const div = document.createElement('div');
      div.className = 'comments-carousel-item' + (i === idx ? ' selected' : '');
      const img = s.passport_path
        ? '<img src="' + escapeHtml(s.passport_path) + '" alt="" />'
        : '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org%22 width=%2256%22 height=%2256%22%3E%3Crect fill=%22%231e5078%22 width=%2256%22 height=%2256%22/%3E%3C/svg%3E" alt="" />';
      div.innerHTML = img + '<span>' + escapeHtml(s.full_name) + '</span>';
      div.addEventListener('click', function () {
        if (i === idx) return;
        idx = i;
        renderCarousel();
        showLearner();
        scrollCarouselToSelected();
      });
      elCarousel.appendChild(div);
    });
    requestAnimationFrame(scrollCarouselToSelected);
  }

  function showLearner() {
    const s = students[idx];
    if (!s) {
      document.getElementById('cc-d-name').textContent = '—';
      fillCommentForCurrent();
      fillMarkForCurrent();
      fillClassTeacherForCurrent();
      emitWeeklyContext();
      refreshQuickCommentBanks();
      return;
    }
    const ph = document.getElementById('cc-profile-photo');
    ph.innerHTML = s.passport_path
      ? '<img src="' + escapeHtml(s.passport_path) + '" alt="" />'
      : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">No photo</div>';
    document.getElementById('cc-d-name').textContent = s.full_name;
    document.getElementById('cc-d-class').textContent = labelClass();
    document.getElementById('cc-d-reg').textContent = s.reg_no || '—';
    if (isMarksSubject()) fillMarkForCurrent();
    else fillCommentForCurrent();
    fillClassTeacherForCurrent();
    syncServerSnapFromRows();
    updateReadonlyUi();
    emitWeeklyContext();
    refreshQuickCommentBanks();
  }

  function emitWeeklyContext() {
    const s = students[idx];
    window.dispatchEvent(
      new CustomEvent('ocean-comments-context', {
        detail: {
          studentId: s ? s.id : null,
          subject: elSubject.value,
          term: Number(elTerm.value || 1),
        },
      })
    );
  }

  function fillCommentForCurrent() {
    const s = students[idx];
    if (!s) {
      elBody.value = '';
      elChar.textContent = '0 / 300';
      return;
    }
    elBody.value = commentForStudent(s.id);
    elChar.textContent = elBody.value.length + ' / 300';
    syncServerSnapFromRows();
  }

  function fillMarkForCurrent() {
    const s = students[idx];
    const scoredEl = document.getElementById('cc-m-scored');
    if (!scoredEl) return;
    if (!s) {
      scoredEl.value = '';
      refreshMarksSystemOut();
      return;
    }
    const row = markForStudent(s.id);
    scoredEl.value =
      row && row.marks_scored != null && row.marks_scored !== '' ? String(row.marks_scored) : '';
    refreshMarksSystemOut();
    syncServerSnapFromRows();
  }

  function updateSummary() {
    const sub = elSubject.value;
    const t = elTerm.value;
    const p = elPeriod.value;
    const total = students.length;
    if (isMarksSubject()) {
      const relevant = markRows.filter(function (r) {
        return (
          r.subject === sub &&
          String(r.term) === String(t) &&
          r.period === p &&
          r.marks_scored != null &&
          String(r.marks_scored).trim() !== ''
        );
      });
      const done = relevant.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      elSummaryLine.textContent =
        'Marks entered for ' + sub + ' · ' + periodTitle() + ': ' + done + ' / ' + total + ' learners';
      elSummaryPct.textContent = pct + '%';
      elSummaryFill.style.width = pct + '%';
      return;
    }
    const relevant = commentRows.filter(function (r) {
      return r.subject === sub && String(r.term) === String(t) && r.period === p && r.body && r.body.trim();
    });
    const done = relevant.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    elSummaryLine.textContent =
      'Comments saved for ' + sub + ' · ' + periodTitle() + ': ' + done + ' / ' + total + ' learners';
    elSummaryPct.textContent = pct + '%';
    elSummaryFill.style.width = pct + '%';
  }

  function updateClassTeacherSummary() {
    if (!elCTSummaryLine) return;
    const t = elTerm.value;
    const p = elPeriod.value;
    const total = students.length;
    const done = classTeacherRows.filter(function (r) {
      return String(r.term) === String(t) && r.period === p && r.body && String(r.body).trim();
    }).length;
    elCTSummaryLine.textContent =
      "Class Teacher's comments saved · " + periodTitle() + ': ' + done + ' / ' + total + ' learners';
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

  async function persistSubjectComment(silent) {
    const s = students[idx];
    if (!s) return 'skipped';
    const targetStudentId = s.id;
    let body = elBody.value.trim();
    if (!body) {
      if (silent) return 'skipped';
      if (ctx.flash) ctx.flash('Write a comment before saving.', false);
      return 'error';
    }
    if (silent && body === String(commentForStudent(targetStudentId) || '').trim()) {
      return 'skipped';
    }
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        student_id: targetStudentId,
        subject: elSubject.value,
        term: Number(elTerm.value),
        period: elPeriod.value,
        year: selectedAcademicYear(),
        body: body,
        author_role: 'class_teacher',
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      if (ctx.flash) ctx.flash(data.error || 'Could not save', false);
      return 'error';
    }
    await loadComments();
    fillCommentForCurrent();
    updateSummary();
    if (!silent && ctx.flash) {
      ctx.flash('Comment saved.', true);
    }
    return 'saved';
  }

  async function saveComment() {
    await persistSubjectComment(false);
  }

  function classTeacherNeedsSave() {
    if (!elCTBody) return false;
    const s = students[idx];
    if (!s) return false;
    return elCTBody.value.trim() !== String(classTeacherForStudent(s.id) || '').trim();
  }

  async function saveClassTeacherComment(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    if (!elCTBody) return false;
    const s = students[idx];
    if (!s) return false;
    const targetStudentId = s.id;
    let body = elCTBody.value.trim();
    if (!body) {
      const res = await fetch('/api/class-teacher-comments', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          student_id: targetStudentId,
          term: Number(elTerm.value),
          period: elPeriod.value,
          year: selectedAcademicYear(),
          body: '',
        }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        if (ctx.flash) ctx.flash(data.error || 'Could not update class teacher comment', false);
        return false;
      }
      await loadClassTeacherComments();
      fillClassTeacherForCurrent();
      updateClassTeacherSummary();
      if (!silent && ctx.flash) ctx.flash('Class teacher comment cleared.', true);
      return true;
    }
    const res = await fetch('/api/class-teacher-comments', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        student_id: targetStudentId,
        term: Number(elTerm.value),
        period: elPeriod.value,
        year: selectedAcademicYear(),
        body: body,
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      if (ctx.flash) ctx.flash(data.error || 'Could not save class teacher comment', false);
      return false;
    }
    await loadClassTeacherComments();
    fillClassTeacherForCurrent();
    updateClassTeacherSummary();
    if (!silent && ctx.flash) {
      ctx.flash('Class teacher comment saved.', true);
    }
    return true;
  }

  async function saveMark(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    const s = students[idx];
    if (!s || !isMarksSubject()) return false;
    const scoredInp = document.getElementById('cc-m-scored').value.trim();
    const scoredNum = scoredInp === '' ? null : Number(scoredInp);
    if (scoredInp !== '' && (Number.isNaN(scoredNum) || scoredNum < 0)) {
      if (ctx.flash) ctx.flash('Enter a valid marks scored value, or leave blank to clear.', false);
      return false;
    }
    if (scoredInp !== '' && scoredNum > MARKS_OUT_OF) {
      if (ctx.flash) ctx.flash('Marks scored cannot exceed 100.', false);
      return false;
    }
    if (scoredInp !== '' && !initialsFromDisplayName()) {
      if (ctx.flash)
        ctx.flash('Set your display name under Settings (top of page) so initials can be saved with marks.', false);
      return false;
    }
    const res = await fetch('/api/marks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        student_id: s.id,
        subject: elSubject.value,
        term: Number(elTerm.value),
        period: elPeriod.value,
        year: selectedAcademicYear(),
        marks_scored: scoredNum,
        initials: initialsFromDisplayName(),
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      if (ctx.flash) ctx.flash(data.error || 'Could not save marks', false);
      return false;
    }
    await loadMarks();
    fillMarkForCurrent();
    updateSummary();
    if (!silent && ctx.flash) ctx.flash(data.deleted ? 'Marks cleared.' : 'Marks saved.', true);
    return true;
  }

  async function saveCombined(navDelta) {
    const s = students[idx];
    if (!s) return;
    const ctWanted = classTeacherNeedsSave();
    let ctSaved = false;
    if (ctWanted) {
      const ok = await saveClassTeacherComment({ silent: true });
      if (!ok) return;
      ctSaved = true;
    }
    let subjSaved = false;
    if (isMarksSubject()) {
      const scoredEl = document.getElementById('cc-m-scored');
      const inp = scoredEl ? scoredEl.value.trim() : '';
      const row = markForStudent(s.id);
      const stored =
        row && row.marks_scored != null && row.marks_scored !== '' ? String(row.marks_scored).trim() : '';
      let marksUnchanged = false;
      if (inp === '' && stored === '') marksUnchanged = true;
      else if (inp === '' || stored === '') marksUnchanged = false;
      else marksUnchanged = Number(inp) === Number(stored);
      if (!marksUnchanged) {
        const ok = await saveMark({ silent: true });
        if (!ok) return;
        subjSaved = true;
      }
    } else {
      const r = await persistSubjectComment(true);
      if (r === 'error') return;
      if (r === 'saved') subjSaved = true;
    }
    if (!ctSaved && !subjSaved) {
      if (ctx.flash)
        ctx.flash(
          'Nothing new to save — add or change the subject comment or marks, or edit the Class Teacher\'s comment above.',
          false
        );
      return;
    }
    const parts = [];
    if (ctSaved) parts.push("class teacher's comment");
    if (subjSaved) parts.push(isMarksSubject() ? 'marks' : 'subject comment');
    if (ctx.flash) ctx.flash('Saved ' + parts.join(' and ') + '.', true);
    if (navDelta != null) moveIdx(navDelta);
  }

  function moveIdx(delta) {
    if (!students.length) return;
    idx = Math.max(0, Math.min(students.length - 1, idx + delta));
    renderCarousel();
    showLearner();
    scrollCarouselToSelected();
  }

  if (elBody && elChar) {
    elBody.addEventListener('input', function () {
      elChar.textContent = elBody.value.length + ' / 300';
    });
  }

  const mScored = document.getElementById('cc-m-scored');
  if (mScored) mScored.addEventListener('input', refreshMarksSystemOut);

  function refreshTermPeriodDependent() {
    updatePeriodLabel();
    return Promise.all([refreshSubjectRows(), loadClassTeacherComments()]).then(function () {
      fillClassTeacherForCurrent();
      updateClassTeacherSummary();
      updateReadonlyUi();
    });
  }

  window.__oceanCommentsIsMarksSubject = isMarksSubject;

  if (elSubject && elTerm && elPeriod) {
    elSubject.addEventListener('change', function () {
      updatePeriodLabel();
      updateReadonlyUi();
      renderCarousel();
      refreshSubjectRows().then(function () {
        showLearner();
        scrollCarouselToSelected();
        updateReadonlyUi();
        emitWeeklyContext();
        refreshQuickCommentBanks();
      });
    });
    elTerm.addEventListener('change', function () {
      refreshTermPeriodDependent().then(function () {
        emitWeeklyContext();
        refreshQuickCommentBanks();
      });
    });
    elPeriod.addEventListener('change', function () {
      refreshTermPeriodDependent();
    });
  }

  const ccPrev = document.getElementById('cc-prev');
  const ccNext = document.getElementById('cc-next');
  const ccSaveOnly = document.getElementById('cc-save-only');
  const ccSaveNext = document.getElementById('cc-save-next');
  const ccSavePrev = document.getElementById('cc-save-prev');
  if (ccPrev) ccPrev.addEventListener('click', function () { moveIdx(-1); });
  if (ccNext) ccNext.addEventListener('click', function () { moveIdx(1); });
  if (ccSaveOnly) ccSaveOnly.addEventListener('click', async function () { await saveCombined(null); });
  if (ccSaveNext) ccSaveNext.addEventListener('click', async function () { await saveCombined(1); });
  if (ccSavePrev) ccSavePrev.addEventListener('click', async function () { await saveCombined(-1); });

  if (elCTBody && elCTChar) {
    elCTBody.addEventListener('input', function () {
      elCTChar.textContent = elCTBody.value.length + ' / 300';
    });
  }
  if (panel && elSubject) {
    window.addEventListener('ocean-weekly-bands-updated', function () {
      refreshQuickCommentBanks();
    });
  }

  function hdr(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/\s*\/\s*/g, '/ ');
  }

  function studentsUrl(year) {
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    if (year != null && String(year).trim() !== '') u.searchParams.set('year', String(year).trim());
    return u.toString();
  }

  function commentsUrlForExport(term, period) {
    const u = new URL('/api/comments', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', term);
    u.searchParams.set('period', period);
    u.searchParams.set('year', String(selectedAcademicYear()));
    return u.toString();
  }

  function marksUrlForExport(term, period) {
    const u = new URL('/api/marks', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', term);
    u.searchParams.set('period', period);
    u.searchParams.set('year', String(selectedAcademicYear()));
    return u.toString();
  }

  function headCommentsUrlForExport(term, period) {
    const u = new URL('/api/head-comments', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', term);
    u.searchParams.set('period', period);
    u.searchParams.set('year', String(selectedAcademicYear()));
    return u.toString();
  }

  function classTeacherCommentsUrlForExport(term, period) {
    const u = new URL('/api/class-teacher-comments', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', term);
    u.searchParams.set('period', period);
    u.searchParams.set('year', String(selectedAcademicYear()));
    return u.toString();
  }

  function subjectColumnsFromBoth(filteredComments, filteredMarks) {
    const base = (ctx.subjects || []).map(function (x) {
      return String(x);
    });
    const seen = {};
    base.forEach(function (s) {
      seen[s] = true;
    });
    function add(s) {
      if (s && !seen[s]) {
        seen[s] = true;
        base.push(s);
      }
    }
    filteredComments.forEach(function (r) {
      add(r.subject);
    });
    filteredMarks.forEach(function (r) {
      add(r.subject);
    });
    return base;
  }

  function filterTermPeriod(rows, term, period) {
    const tNum = Number(term);
    return rows.filter(function (r) {
      return Number(r.term) === tNum && r.period === period;
    });
  }

  function buildWideAoa(roster, allComments, allMarks, term, period, allHead, allClassTeacher) {
    const fc = filterTermPeriod(allComments, term, period);
    const fm = filterTermPeriod(allMarks, term, period);
    const fh = filterTermPeriod(Array.isArray(allHead) ? allHead : [], term, period);
    const fct = filterTermPeriod(Array.isArray(allClassTeacher) ? allClassTeacher : [], term, period);
    const headBy = {};
    fh.forEach(function (r) {
      headBy[r.student_id] = r.body != null ? String(r.body) : '';
    });
    const ctBy = {};
    fct.forEach(function (r) {
      ctBy[r.student_id] = r.body != null ? String(r.body) : '';
    });
    const subjectCols = subjectColumnsFromBoth(fc, fm);
    const cls = labelClass();
    const heads = ['NAME', 'CLASS', 'REG NO.'];
    subjectCols.forEach(function (sub) {
      if (isPrimary && skillList.indexOf(sub) === -1) {
        heads.push(
          hdr(sub) + ' — MARKS',
          hdr(sub) + ' — GRADE (AGG)',
          hdr(sub) + ' — REMARK',
          hdr(sub) + ' — INITIALS'
        );
      } else {
        heads.push(hdr(sub));
      }
    });
    if (isPrimary) {
      heads.push('OVERALL DIVISION');
    }
    heads.push("CLASS TEACHER'S COMMENT", isPrimary ? "HEAD TEACHER'S COMMENT" : "HEAD CAREGIVER'S COMMENT");
    const byC = {};
    fc.forEach(function (r) {
      byC[r.student_id + '\t' + r.subject] = r.body;
    });
    const byM = {};
    fm.forEach(function (r) {
      byM[r.student_id + '\t' + r.subject] = r;
    });
    const divByStudent = {};
    roster.forEach(function (stu) {
      const rowsForStu = fm.filter(function (r) {
        return r.student_id === stu.id;
      });
      const mapRows = rowsForStu.map(function (r) {
        return { subject: r.subject, agg: r.agg };
      });
      divByStudent[stu.id] = primaryAggregateFromMarkRowsLocal(mapRows).division || '';
    });
    const rosterCopy = roster.slice().sort(function (a, b) {
      return String(a.full_name).localeCompare(String(b.full_name), undefined, { sensitivity: 'base' });
    });
    const aoa = [heads];
    rosterCopy.forEach(function (s) {
      const row = [String(s.full_name || '').toUpperCase(), String(cls).toUpperCase(), s.reg_no || ''];
      const overallDiv = divByStudent[s.id] || '';
      subjectCols.forEach(function (sub) {
        if (isPrimary && skillList.indexOf(sub) === -1) {
          const m = byM[s.id + '\t' + sub];
          if (m) {
            row.push(
              m.marks_scored != null ? m.marks_scored : '',
              m.agg || '',
              m.remark || '',
              m.initials || ''
            );
          } else {
            row.push('', '', '', '');
          }
        } else {
          row.push(byC[s.id + '\t' + sub] || '');
        }
      });
      if (isPrimary) {
        row.push(overallDiv);
      }
      row.push(ctBy[s.id] || '', headBy[s.id] || '');
      aoa.push(row);
    });
    return aoa;
  }

  function withExportSchoolPreamble(aoa) {
    if (!aoa || !aoa.length) return aoa;
    const name =
      typeof window !== 'undefined' && window.OCEAN_SCHOOL_NAME
        ? window.OCEAN_SCHOOL_NAME
        : 'THE OCEAN OF KNOWLEDGE SCHOOL';
    const nc = aoa[0].length;
    const schoolRow = new Array(nc).fill('');
    schoolRow[0] = name;
    const blank = new Array(nc).fill('');
    return [schoolRow, blank].concat(aoa);
  }

  async function refreshExportTable() {
    const termEl = document.getElementById('ex-term');
    const periodEl = document.getElementById('ex-period');
    const term = termEl ? termEl.value : '1';
    const period = periodEl ? periodEl.value : 'mid';
    const thead = document.getElementById('cc-export-thead');
    const tbody = document.getElementById('cc-export-body');
    const [stuRes, comRes, marRes, headRes, ctRes] = await Promise.all([
      fetch(studentsUrl(reportYear)),
      fetch(commentsUrlForExport(term, period)),
      fetch(marksUrlForExport(term, period)),
      fetch(headCommentsUrlForExport(term, period)),
      fetch(classTeacherCommentsUrlForExport(term, period)),
    ]);
    const roster = stuRes.ok ? await stuRes.json() : [];
    const allComments = comRes.ok ? await comRes.json() : [];
    const allMarks = marRes.ok ? await marRes.json() : [];
    let allHead = [];
    if (headRes.ok) {
      try {
        allHead = await headRes.json();
      } catch (_) {
        allHead = [];
      }
    }
    if (!Array.isArray(allHead)) allHead = [];
    let allClassTeacher = [];
    if (ctRes.ok) {
      try {
        allClassTeacher = await ctRes.json();
      } catch (_) {
        allClassTeacher = [];
      }
    }
    if (!Array.isArray(allClassTeacher)) allClassTeacher = [];
    const aoa = buildWideAoa(roster, allComments, allMarks, term, period, allHead, allClassTeacher);
    const heads = aoa[0];
    const trh = document.createElement('tr');
    heads.forEach(function (h) {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.innerHTML = '';
    thead.appendChild(trh);
    tbody.innerHTML = '';
    if (!roster.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = heads.length;
      td.style.color = 'var(--muted)';
      td.textContent = 'No learners registered for this class.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (let r = 1; r < aoa.length; r++) {
      const tr = document.createElement('tr');
      aoa[r].forEach(function (cell) {
        const td = document.createElement('td');
        td.textContent = cell == null ? '' : String(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  }

  function loadSheetJs(cb) {
    if (window.XLSX) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
    s.onload = cb;
    s.onerror = function () {
      alert('Could not load Excel library');
    };
    document.head.appendChild(s);
  }

  const ccExportBtn = document.getElementById('cc-export-btn');
  if (ccExportBtn) ccExportBtn.addEventListener('click', function () {
    loadSheetJs(function () {
      const term = document.getElementById('ex-term').value;
      const period = document.getElementById('ex-period').value;
      Promise.all([
        fetch(studentsUrl()),
        fetch(commentsUrlForExport(term, period)),
        fetch(marksUrlForExport(term, period)),
        fetch(headCommentsUrlForExport(term, period)),
        fetch(classTeacherCommentsUrlForExport(term, period)),
      ])
        .then(function (res) {
          return Promise.all(
            res.map(function (r) {
              return r.json();
            })
          );
        })
        .then(function (rowsArr) {
          const roster = rowsArr[0];
          const rows = rowsArr[1];
          const marks = rowsArr[2];
          let headRows = rowsArr[3];
          let ctRows = rowsArr[4];
          if (!Array.isArray(headRows)) headRows = [];
          if (!Array.isArray(ctRows)) ctRows = [];
          const aoa = withExportSchoolPreamble(buildWideAoa(roster, rows, marks, term, period, headRows, ctRows));
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          const wb = XLSX.utils.book_new();
          const sheetName = ('T' + term + ' ' + periodShortLabel(period)).slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
          const fname =
            'comments-' +
            ctx.classLevel +
            (ctx.stream ? '-' + ctx.stream : '') +
            '-term' +
            term +
            '-' +
            period +
            '.xlsx';
          XLSX.writeFile(wb, fname);
        });
    });
  });

  const ccExportRefresh = document.getElementById('cc-export-refresh');
  if (ccExportRefresh) ccExportRefresh.addEventListener('click', function () {
    refreshExportTable();
  });

  const exTerm = document.getElementById('ex-term');
  const exPeriod = document.getElementById('ex-period');
  if (exTerm) exTerm.addEventListener('change', refreshExportTable);
  if (exPeriod) exPeriod.addEventListener('change', refreshExportTable);

  // ---------- Report template (HTML/CSS printable) ----------
  function reportPeriodLabel(period, term, reportYear) {
    const y = Number(reportYear);
    const yearText = Number.isFinite(y) && y >= 2000 && y <= 2100 ? String(y) : String(new Date().getFullYear());
    return periodLabel(period) + ' · Term ' + term + ' · ' + yearText;
  }

  const REPORT_FONT_FAMILIES = {
    default: '',
    calibri: "Calibri, 'Segoe UI', Arial, sans-serif",
    georgia: "Georgia, 'Times New Roman', serif",
    verdana: 'Verdana, Geneva, sans-serif',
    trebuchet: "'Trebuchet MS', 'Segoe UI', Arial, sans-serif",
    times: "'Times New Roman', Times, serif",
  };

  let currentReportSettings = null;
  let reportSubjectOrderDraft = [];
  let reportVisualEditorEnabled = false;
  let reportEditorDragState = null;
  let reportDraggedSubject = '';

  function isPictureTemplateClass() {
    return ctx.classLevel === 'baby' || ctx.classLevel === 'middle' || ctx.classLevel === 'daycare' || ctx.classLevel === 'top';
  }

  function isPrimaryReportClass() {
    return ctx.classLevel === 'primary1' || ctx.classLevel === 'primary2';
  }

  function supportsReportVisualEditor() {
    return isPictureTemplateClass() || isPrimaryReportClass();
  }

  function defaultPictureSubjectOrder() {
    return ctx.classLevel === 'middle'
      ? ['Language Development', 'Reading', 'Writing', 'Numeracy', 'General Knowledge', 'Computer', 'Music', 'Salon', 'Fashion and Design', 'Bakery']
      : ctx.classLevel === 'daycare'
      ? ['Listening and Speaking', 'Drawing and Shading', 'General Knowledge', 'Social Development', 'Rhymes and songs', 'Health Habits']
      : ctx.classLevel === 'top'
      ? ['Language Development', 'Health Habits', 'Reading', 'Writing', 'Social Development', 'Numeracy', 'Fashion and Design', 'Bakery', 'Salon', 'Music', 'Computer']
      : ['Reading', 'Writing', 'Numeracy', 'General Knowledge', 'Computer', 'Music', 'Salon', 'Fashion and Design'];
  }

  function defaultReportLayoutSettings() {
    return {
      subjectOrder: isPictureTemplateClass() ? defaultPictureSubjectOrder() : [],
      subjectGridOffsetX: 0,
      subjectGridOffsetY: 0,
      commentsOffsetX: 0,
      commentsOffsetY: 0,
      badgeScale: 1,
      commentGapMm: 4,
      metaScale: 1,
      metaOffsetIn: 0,
      metaWidthIn: 4.7,
      photoScale: 1,
      photoOffsetXIn: 0,
      photoOffsetYIn: 0,
      headingScale: 1,
      commentFontScale: 1,
    };
  }

  function clampTemplateOffset(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-160, Math.min(160, n));
  }

  function normalizeReportLayoutSettingsLocal(raw) {
    const base = defaultReportLayoutSettings();
    const src = raw && typeof raw === 'object' ? raw : {};
    const allowed = base.subjectOrder.slice();
    let order = Array.isArray(src.subjectOrder)
      ? src.subjectOrder
          .map(function (x) {
            return String(x || '').trim();
          })
          .filter(function (x, i, arr) {
            return x && arr.indexOf(x) === i && allowed.indexOf(x) !== -1;
          })
      : [];
    allowed.forEach(function (sub) {
      if (order.indexOf(sub) === -1) order.push(sub);
    });
    return {
      subjectOrder: order,
      subjectGridOffsetX: clampTemplateOffset(src.subjectGridOffsetX),
      subjectGridOffsetY: clampTemplateOffset(src.subjectGridOffsetY),
      commentsOffsetX: clampTemplateOffset(src.commentsOffsetX),
      commentsOffsetY: clampTemplateOffset(src.commentsOffsetY),
      badgeScale: clampBadgeScale(src.badgeScale),
      commentGapMm: clampCommentGapMm(src.commentGapMm),
      metaScale: clampSectionFontScale(src.metaScale),
      metaOffsetIn: clampMetaOffsetIn(src.metaOffsetIn),
      metaWidthIn: clampMetaWidthIn(src.metaWidthIn),
      photoScale: clampPhotoScale(src.photoScale),
      photoOffsetXIn: clampPhotoOffsetXIn(src.photoOffsetXIn),
      photoOffsetYIn: clampPhotoOffsetYIn(src.photoOffsetYIn),
      headingScale: clampSectionFontScale(src.headingScale),
      commentFontScale: clampSectionFontScale(src.commentFontScale),
    };
  }

  function clampBadgeScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.7, Math.min(1.5, n));
  }

  function clampCommentGapMm(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 4;
    return Math.max(0, Math.min(24, n));
  }

  function clampSectionFontScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.75, Math.min(1.45, n));
  }

  function clampMetaOffsetIn(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-2, Math.min(2, n));
  }

  function clampMetaWidthIn(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 4.7;
    return Math.max(3, Math.min(6.2, n));
  }

  function clampPhotoScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.7, Math.min(1.5, n));
  }

  function clampPhotoOffsetXIn(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-2, Math.min(2, n));
  }

  function clampPhotoOffsetYIn(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-1.5, Math.min(1.5, n));
  }

  function normalizeReportSettingsLocal(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const scale = Number(src.fontScale);
    const fontScale = Number.isFinite(scale) ? Math.max(0.8, Math.min(1.6, scale)) : 1;
    const fontFamily = REPORT_FONT_FAMILIES[String(src.fontFamily || '').trim()] != null ? String(src.fontFamily || '').trim() : 'default';
    return {
      nextTermBegins: src.nextTermBegins != null ? String(src.nextTermBegins) : '',
      fontScale: fontScale,
      templatePath: src.templatePath != null ? String(src.templatePath) : '',
      fontFamily: fontFamily || 'default',
      layout: normalizeReportLayoutSettingsLocal(src.layout),
    };
  }

  function mergeReportSettingsLocal(current, patch) {
    const base = normalizeReportSettingsLocal(current);
    const next = patch && typeof patch === 'object' ? patch : {};
    const merged = {
      nextTermBegins: next.nextTermBegins != null ? String(next.nextTermBegins) : base.nextTermBegins,
      fontScale: next.fontScale != null ? next.fontScale : base.fontScale,
      templatePath: next.templatePath != null ? String(next.templatePath) : base.templatePath,
      fontFamily: next.fontFamily != null ? String(next.fontFamily) : base.fontFamily,
      layout: Object.assign({}, base.layout, next.layout || {}),
    };
    return normalizeReportSettingsLocal(merged);
  }

  function reportFontScaleLabel(scale) {
    return String(Math.round(Number(scale || 1) * 100)) + '%';
  }

  function reportInchLabel(value) {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toFixed(1) + 'in';
  }

  function currentReportPreviewScale() {
    const raw =
      rpFontToolbarRange && rpFontToolbarRange.value
        ? Number(rpFontToolbarRange.value)
        : rpFontRange && rpFontRange.value
        ? Number(rpFontRange.value)
        : currentReportSettings && currentReportSettings.fontScale != null
        ? Number(currentReportSettings.fontScale)
        : 1;
    return Number.isFinite(raw) ? Math.max(0.8, Math.min(1.6, raw)) : 1;
  }

  function clearReportSubjectDragClasses(scope) {
    const root = scope || document;
    Array.prototype.forEach.call(root.querySelectorAll('.baby-subject-card.report-drag-over'), function (el) {
      el.classList.remove('report-drag-over');
    });
    Array.prototype.forEach.call(root.querySelectorAll('.baby-subject-card.report-dragging'), function (el) {
      el.classList.remove('report-dragging');
    });
  }

  function reorderSubjectCards(gridEl, order) {
    if (!gridEl || !Array.isArray(order) || !order.length) return;
    const cards = Array.prototype.slice.call(gridEl.querySelectorAll('.baby-subject-card[data-subject]'));
    if (!cards.length) return;
    const bySubject = {};
    cards.forEach(function (card) {
      bySubject[card.getAttribute('data-subject') || ''] = card;
    });
    order.forEach(function (subject) {
      const card = bySubject[subject];
      if (card) gridEl.appendChild(card);
    });
  }

  function applyReportTemplateCustomization(settings, rootEl) {
    const normalized = normalizeReportSettingsLocal(settings || currentReportSettings || {});
    const root = rootEl || document.getElementById('rp-template');
    const cards = root
      ? root.querySelectorAll('.baby-report-card, .primary-report-card')
      : document.querySelectorAll('#rp-template .baby-report-card, #rp-template .primary-report-card');
    cards.forEach(function (card) {
      const family = REPORT_FONT_FAMILIES[normalized.fontFamily] || '';
      card.style.fontFamily = family;
      const bodyBlock = card.querySelector('.baby-subjects-grid, .primary-report-body');
      if (bodyBlock) {
        bodyBlock.style.transformOrigin = 'top left';
        bodyBlock.style.transform =
          'translate(' +
          normalized.layout.subjectGridOffsetX +
          'px, ' +
          normalized.layout.subjectGridOffsetY +
          'px)';
        if (bodyBlock.classList.contains('baby-subjects-grid')) {
          reorderSubjectCards(bodyBlock, normalized.layout.subjectOrder);
        }
      }
      card.style.setProperty('--rp-badge-scale', String(normalized.layout.badgeScale || 1));
      card.style.setProperty('--rp-comment-gap-mm', String(normalized.layout.commentGapMm != null ? normalized.layout.commentGapMm : 4));
      card.style.setProperty('--rp-meta-scale', String(normalized.layout.metaScale || 1));
      card.style.setProperty('--rp-meta-offset-in', String(normalized.layout.metaOffsetIn || 0));
      card.style.setProperty('--rp-meta-width-in', String(normalized.layout.metaWidthIn || 4.7));
      card.style.setProperty('--rp-photo-scale', String(normalized.layout.photoScale || 1));
      card.style.setProperty('--rp-photo-offset-x-in', String(normalized.layout.photoOffsetXIn || 0));
      card.style.setProperty('--rp-photo-offset-y-in', String(normalized.layout.photoOffsetYIn || 0));
      card.style.setProperty('--rp-heading-scale', String(normalized.layout.headingScale || 1));
      card.style.setProperty('--rp-comment-scale', String(normalized.layout.commentFontScale || 1));
      const commentsBlock = card.querySelector('.baby-bottom-comments, .primary-comments, .report-comments');
      if (commentsBlock) {
        commentsBlock.style.transformOrigin = 'top left';
        commentsBlock.style.transform =
          'translate(' +
          normalized.layout.commentsOffsetX +
          'px, ' +
          normalized.layout.commentsOffsetY +
          'px)';
      }
    });
    if (!reportEditorDragState) syncReportVisualEditor();
  }

  function syncReportOffsetInputs(layout) {
    const normalized = normalizeReportLayoutSettingsLocal(layout || {});
    if (rpSubjectOffsetX) rpSubjectOffsetX.value = String(normalized.subjectGridOffsetX || 0);
    if (rpSubjectOffsetY) rpSubjectOffsetY.value = String(normalized.subjectGridOffsetY || 0);
    if (rpCommentsOffsetX) rpCommentsOffsetX.value = String(normalized.commentsOffsetX || 0);
    if (rpCommentsOffsetY) rpCommentsOffsetY.value = String(normalized.commentsOffsetY || 0);
    if (rpBadgeRange) rpBadgeRange.value = String(normalized.badgeScale || 1);
    if (rpBadgeRangeValue) rpBadgeRangeValue.textContent = reportFontScaleLabel(normalized.badgeScale || 1);
    if (rpMetaRange) rpMetaRange.value = String(normalized.metaScale || 1);
    if (rpMetaRangeValue) rpMetaRangeValue.textContent = reportFontScaleLabel(normalized.metaScale || 1);
    if (rpMetaXRange) rpMetaXRange.value = String(normalized.metaOffsetIn || 0);
    if (rpMetaXValue) rpMetaXValue.textContent = reportInchLabel(normalized.metaOffsetIn || 0);
    if (rpMetaWidthRange) rpMetaWidthRange.value = String(normalized.metaWidthIn || 4.7);
    if (rpMetaWidthValue) rpMetaWidthValue.textContent = reportInchLabel(normalized.metaWidthIn || 4.7);
    if (rpPhotoSizeRange) rpPhotoSizeRange.value = String(normalized.photoScale || 1);
    if (rpPhotoSizeValue) rpPhotoSizeValue.textContent = reportFontScaleLabel(normalized.photoScale || 1);
    if (rpPhotoXRange) rpPhotoXRange.value = String(normalized.photoOffsetXIn || 0);
    if (rpPhotoXValue) rpPhotoXValue.textContent = reportInchLabel(normalized.photoOffsetXIn || 0);
    if (rpPhotoYRange) rpPhotoYRange.value = String(normalized.photoOffsetYIn || 0);
    if (rpPhotoYValue) rpPhotoYValue.textContent = reportInchLabel(normalized.photoOffsetYIn || 0);
    if (rpHeadingRange) rpHeadingRange.value = String(normalized.headingScale || 1);
    if (rpHeadingRangeValue) rpHeadingRangeValue.textContent = reportFontScaleLabel(normalized.headingScale || 1);
    if (rpCommentsFontRange) rpCommentsFontRange.value = String(normalized.commentFontScale || 1);
    if (rpCommentsFontRangeValue) rpCommentsFontRangeValue.textContent = reportFontScaleLabel(normalized.commentFontScale || 1);
    if (rpCommentGapRange) rpCommentGapRange.value = String(normalized.commentGapMm != null ? normalized.commentGapMm : 4);
    if (rpCommentGapValue) rpCommentGapValue.textContent = String(normalized.commentGapMm != null ? normalized.commentGapMm : 4) + 'mm';
  }

  function orderedSubjectsFromGrid(gridEl) {
    if (!gridEl) return [];
    return Array.prototype.map.call(
      gridEl.querySelectorAll('.baby-subject-card[data-subject]'),
      function (card) {
        return String(card.getAttribute('data-subject') || '');
      }
    ).filter(function (name) {
      return !!name;
    });
  }

  function stopReportSectionDrag() {
    if (!reportEditorDragState) return;
    if (reportEditorDragState.target) reportEditorDragState.target.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onReportSectionDragMove);
    window.removeEventListener('pointerup', stopReportSectionDrag);
    window.removeEventListener('pointercancel', stopReportSectionDrag);
    reportEditorDragState = null;
  }

  function onReportSectionDragMove(event) {
    if (!reportEditorDragState) return;
    const scale = reportEditorDragState.scale || 1;
    const dx = clampTemplateOffset(reportEditorDragState.baseX + (event.clientX - reportEditorDragState.startX) / scale);
    const dy = clampTemplateOffset(reportEditorDragState.baseY + (event.clientY - reportEditorDragState.startY) / scale);
    if (reportEditorDragState.kind === 'subjectGrid') {
      if (rpSubjectOffsetX) rpSubjectOffsetX.value = String(dx);
      if (rpSubjectOffsetY) rpSubjectOffsetY.value = String(dy);
    } else if (reportEditorDragState.kind === 'comments') {
      if (rpCommentsOffsetX) rpCommentsOffsetX.value = String(dx);
      if (rpCommentsOffsetY) rpCommentsOffsetY.value = String(dy);
    }
    previewReportTemplateControls();
  }

  function startReportSectionDrag(event, kind, target) {
    if (!reportVisualEditorEnabled || !target) return;
    event.preventDefault();
    event.stopPropagation();
    stopReportSectionDrag();
    const draft = currentReportTemplateDraft();
    reportEditorDragState = {
      kind: kind,
      target: target,
      startX: event.clientX,
      startY: event.clientY,
      baseX: kind === 'subjectGrid' ? draft.layout.subjectGridOffsetX : draft.layout.commentsOffsetX,
      baseY: kind === 'subjectGrid' ? draft.layout.subjectGridOffsetY : draft.layout.commentsOffsetY,
      scale: currentReportPreviewScale(),
    };
    target.classList.add('is-dragging');
    window.addEventListener('pointermove', onReportSectionDragMove);
    window.addEventListener('pointerup', stopReportSectionDrag);
    window.addEventListener('pointercancel', stopReportSectionDrag);
  }

  function ensureReportDragHandle(target, kind, label) {
    if (!target) return;
    let handle = target.querySelector('.report-drag-handle[data-editor-kind="' + kind + '"]');
    if (!handle) {
      handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'report-drag-handle';
      handle.setAttribute('data-editor-kind', kind);
      target.appendChild(handle);
    }
    handle.textContent = label;
    handle.onpointerdown = function (event) {
      startReportSectionDrag(event, kind, target);
    };
  }

  function handleReportSubjectDragStart(event) {
    if (!reportVisualEditorEnabled) return;
    const subject = String(event.currentTarget.getAttribute('data-subject') || '');
    if (!subject) return;
    reportDraggedSubject = subject;
    event.currentTarget.classList.add('report-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', subject);
    }
  }

  function handleReportSubjectDragOver(event) {
    if (!reportVisualEditorEnabled) return;
    event.preventDefault();
    const card = event.currentTarget;
    const targetSubject = String(card.getAttribute('data-subject') || '');
    if (targetSubject && targetSubject !== reportDraggedSubject) {
      card.classList.add('report-drag-over');
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleReportSubjectDragLeave(event) {
    event.currentTarget.classList.remove('report-drag-over');
  }

  function handleReportSubjectDrop(event) {
    if (!reportVisualEditorEnabled) return;
    event.preventDefault();
    const targetCard = event.currentTarget;
    targetCard.classList.remove('report-drag-over');
    const targetSubject = String(targetCard.getAttribute('data-subject') || '');
    const draggedSubject = reportDraggedSubject || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : '');
    if (!draggedSubject || !targetSubject || draggedSubject === targetSubject) return;
    const grid = targetCard.closest('.baby-subjects-grid');
    const order = orderedSubjectsFromGrid(grid);
    const fromIndex = order.indexOf(draggedSubject);
    const toIndex = order.indexOf(targetSubject);
    if (fromIndex === -1 || toIndex === -1) return;
    const rect = targetCard.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2 || event.clientX > rect.left + rect.width / 2;
    const next = order.slice();
    next.splice(fromIndex, 1);
    let insertIndex = toIndex + (insertAfter ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    next.splice(insertIndex, 0, draggedSubject);
    reportSubjectOrderDraft = next;
    renderReportSubjectOrderEditor();
    previewReportTemplateControls();
  }

  function handleReportSubjectDragEnd(event) {
    reportDraggedSubject = '';
    event.currentTarget.classList.remove('report-dragging');
    clearReportSubjectDragClasses(document.getElementById('rp-template'));
  }

  function bindSubjectCardDrag(card) {
    if (!card) return;
    card.setAttribute('draggable', reportVisualEditorEnabled ? 'true' : 'false');
    card.ondragstart = reportVisualEditorEnabled ? handleReportSubjectDragStart : null;
    card.ondragover = reportVisualEditorEnabled ? handleReportSubjectDragOver : null;
    card.ondragleave = reportVisualEditorEnabled ? handleReportSubjectDragLeave : null;
    card.ondrop = reportVisualEditorEnabled ? handleReportSubjectDrop : null;
    card.ondragend = reportVisualEditorEnabled ? handleReportSubjectDragEnd : null;
  }

  function syncReportVisualEditor() {
    const templateEl = document.getElementById('rp-template');
    if (!templateEl) return;
    templateEl.classList.toggle('is-template-editing', !!reportVisualEditorEnabled);
    Array.prototype.forEach.call(templateEl.querySelectorAll('.report-edit-target'), function (el) {
      el.classList.remove('report-edit-target', 'is-dragging');
      Array.prototype.forEach.call(el.querySelectorAll('.report-drag-handle'), function (handle) {
        handle.remove();
      });
    });
    Array.prototype.forEach.call(templateEl.querySelectorAll('.baby-subject-card[data-subject]'), function (card) {
      bindSubjectCardDrag(card);
    });
    clearReportSubjectDragClasses(templateEl);
    if (!reportVisualEditorEnabled) {
      stopReportSectionDrag();
      return;
    }
    Array.prototype.forEach.call(templateEl.querySelectorAll('.baby-subjects-grid, .primary-report-body'), function (block) {
      block.classList.add('report-edit-target');
      ensureReportDragHandle(
        block,
        'subjectGrid',
        block.classList.contains('primary-report-body') ? 'Move main report block' : 'Move subject block'
      );
      Array.prototype.forEach.call(block.querySelectorAll('.baby-subject-card[data-subject]'), function (card) {
        bindSubjectCardDrag(card);
      });
    });
    Array.prototype.forEach.call(templateEl.querySelectorAll('.baby-bottom-comments, .primary-comments'), function (block) {
      block.classList.add('report-edit-target');
      ensureReportDragHandle(block, 'comments', 'Move comments');
    });
  }

  function setReportVisualEditorEnabled(enabled) {
    const allowed = supportsReportVisualEditor();
    reportVisualEditorEnabled = !!enabled && allowed;
    if (rpCustomizePanel) rpCustomizePanel.setAttribute('data-visual-editor', reportVisualEditorEnabled ? 'on' : 'off');
    if (rpVisualToggle) {
      rpVisualToggle.disabled = !allowed;
      rpVisualToggle.textContent = allowed
        ? 'Visual editor: ' + (reportVisualEditorEnabled ? 'ON' : 'OFF')
        : 'Visual editor: N/A';
      rpVisualToggle.setAttribute('aria-pressed', reportVisualEditorEnabled ? 'true' : 'false');
    }
    syncReportVisualEditor();
  }

  function safeText(v) {
    return v == null || v === '' ? '—' : String(v);
  }

  async function fetchSchoolReportingContext() {
    try {
      const res = await fetch('/api/reporting-context');
      if (!res.ok) return null;
      return res.json().then(function (data) {
        if (data && Number(data.year)) schoolReportingYear = Number(data.year);
        return data;
      }).catch(function () {
        return null;
      });
    } catch (_) {
      return null;
    }
  }

  function selectedAcademicYear() {
    const yearEl = document.getElementById('rp-year');
    const customEl = document.getElementById('rp-year-custom');
    if (yearEl) {
      if (yearEl.value === '__custom__') {
        const customYear = Number(customEl && customEl.value ? customEl.value : '');
        if (Number.isFinite(customYear) && customYear >= 2000 && customYear <= 2100) return customYear;
      } else {
        const y = Number(yearEl.value);
        if (Number.isFinite(y) && y >= 2000 && y <= 2100) return y;
      }
    }
    return Number(schoolReportingYear) || new Date().getFullYear();
  }

  function reportTermHeading(period, term, reportYear) {
    const termWord = { '1': 'ONE', '2': 'TWO', '3': 'THREE' }[String(term)] || String(term);
    const periodWord = periodHeadingWord(period);
    return periodWord + ' ' + termWord + ' ' + String(reportYear || new Date().getFullYear());
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
          '<td>' + escapeHtml(String(band.min) + ' – ' + String(band.max)) + '</td>' +
          '<td title="' + escapeHtml(band.remark || '') + '">' + escapeHtml(band.agg || '') + '</td>'
        );
      });
      while (cells.length < 3) cells.push('<td></td><td></td>');
      rows.push('<tr>' + cells.join('') + '</tr>');
    }
    return (
      '<div class="primary-grade-scale">' +
      '<h5>GRADING SCALE</h5>' +
      '<table><tbody>' + rows.join('') + '</tbody></table>' +
      '</div>'
    );
  }

  function buildStudentReportHtml(student, subjectCols, byC, byM, ctBy, headBy, term, period, nextTermBegins, reportYear, comparisonByM) {
    const classLabel = labelClass();
    if (isPrimary) {
      const termLabel = reportTermHeading(period, term, reportYear);
      const subjectOrder = (ctx.subjects || []).slice();
      const academicSubjects = subjectOrder.filter(function (s) {
        return skillList.indexOf(s) === -1;
      });
      const skillSubjects = subjectOrder.filter(function (s) {
        return skillList.indexOf(s) !== -1;
      });
      const beginByM = comparisonByM && comparisonByM.__beginByM ? comparisonByM.__beginByM : null;
      const hasThreeTerm = period === 'end' && comparisonByM;
      const hasComparison = (period === 'mid' || period === 'end') && comparisonByM;
      const firstPeriodLabel = hasThreeTerm ? 'Beginning Of Term' : period === 'end' ? 'Mid Term' : 'Beginning Of Term';
      const secondPeriodLabel = hasThreeTerm ? 'Mid Term' : period === 'end' ? 'End Of Term' : 'Mid Term';
      const thirdPeriodLabel = 'End Of Term';
      function reportMarkRow(map, sub) {
        const m = (map && map[student.id + '\t' + sub]) || {};
        const scored = m.marks_scored != null ? Number(m.marks_scored) : null;
        const currentGrade = Number.isFinite(scored) && gradingBands.length
          ? gradeFromPercentClient(scored, gradingBands)
          : { agg: m.agg || '', remark: m.remark || '' };
        return {
          subject: sub,
          fullMarks: 100,
          scored: scored,
          agg: currentGrade.agg || '',
          remark: currentGrade.remark || '',
          initials: m.initials || '',
        };
      }
      const academicRows = academicSubjects.map(function (sub) {
        return reportMarkRow(byM, sub);
      });
      const beginRows = hasThreeTerm
        ? academicSubjects.map(function (sub) { return reportMarkRow(beginByM, sub); })
        : [];
      const comparisonRows = hasComparison
        ? academicSubjects.map(function (sub) { return reportMarkRow(comparisonByM, sub); })
        : [];
      const totalScored = academicRows.reduce(function (sum, r) {
        return sum + (Number.isFinite(r.scored) ? r.scored : 0);
      }, 0);
      const aggregateInfo = primaryAggregateFromMarkRowsLocal(
        academicRows.map(function (r) {
          return { subject: r.subject, agg: r.agg };
        })
      );
      const comparisonTotalScored = comparisonRows.reduce(function (sum, r) {
        return sum + (Number.isFinite(r.scored) ? r.scored : 0);
      }, 0);
      const comparisonAggregateInfo = primaryAggregateFromMarkRowsLocal(
        comparisonRows.map(function (r) { return { subject: r.subject, agg: r.agg }; })
      );
      const beginTotalScored = beginRows.reduce(function (sum, r) {
        return sum + (Number.isFinite(r.scored) ? r.scored : 0);
      }, 0);
      const beginAggregateInfo = primaryAggregateFromMarkRowsLocal(
        beginRows.map(function (r) { return { subject: r.subject, agg: r.agg }; })
      );
      function periodCells(row) {
        return '<td class="num">100</td>' +
          '<td class="num">' + escapeHtml(Number.isFinite(row.scored) ? String(row.scored) : '') + '</td>' +
          '<td class="num">' + escapeHtml(row.agg || '') + '</td>' +
          '<td>' + escapeHtml(row.remark || '') + '</td>';
      }
      const marksRowsHtml = academicRows
        .map(function (r, rowIndex) {
          const begin = beginRows[rowIndex] || {};
          const first = comparisonRows[rowIndex] || {};
          return (
            '<tr>' +
            '<td>' + escapeHtml(r.subject) + '</td>' +
            (hasThreeTerm ? periodCells(begin) : '') +
            (hasComparison ? periodCells(first) : '') +
            periodCells(r) +
            '<td class="num">' + escapeHtml(r.initials || '') + '</td>' +
            '</tr>'
          );
        })
        .join('');
      const skillsRowsHtml = skillSubjects
        .map(function (sub) {
          return (
            '<tr>' +
            '<td>' + escapeHtml(sub) + '</td>' +
            '<td>' + escapeHtml(byC[student.id + '\t' + sub] || '') + '</td>' +
            '</tr>'
          );
        })
        .join('');
      const comparisonColGroup = hasThreeTerm
        ? '<colgroup><col class="col-subject" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-initials" /></colgroup>'
        : '<colgroup><col class="col-subject" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-full" /><col class="col-scored" /><col class="col-grade" /><col class="col-remark" /><col class="col-initials" /></colgroup>';
      const comparisonHead = hasThreeTerm
        ? '<thead><tr class="period-head"><th rowspan="2">Subject</th><th colspan="4">' + escapeHtml(firstPeriodLabel) + '</th><th colspan="4">' + escapeHtml(secondPeriodLabel) + '</th><th colspan="4">' + escapeHtml(thirdPeriodLabel) + '</th><th rowspan="2">Initials</th></tr><tr class="period-subhead"><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th></tr></thead>'
        : '<thead><tr class="period-head"><th rowspan="2">Subject</th><th colspan="4">' + escapeHtml(firstPeriodLabel) + '</th><th colspan="4">' + escapeHtml(secondPeriodLabel) + '</th><th rowspan="2">Initials</th></tr><tr class="period-subhead"><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th><th>Full Marks</th><th>Marks Scored</th><th>Grade</th><th>Remark</th></tr></thead>';
      const totalRowHtml = hasThreeTerm
        ? '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(beginRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(beginTotalScored)) + '</td><td class="num">' + escapeHtml(beginAggregateInfo.sum != null ? String(beginAggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(beginAggregateInfo.division || '-') + '</td><td class="num">' + escapeHtml(String(comparisonRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(comparisonTotalScored)) + '</td><td class="num">' + escapeHtml(comparisonAggregateInfo.sum != null ? String(comparisonAggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(comparisonAggregateInfo.division || '-') + '</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '-') + '</td><td></td></tr>'
        : null;
      return (
        '<div class="primary-report-card">' +
        '<img class="baby-edge baby-edge-top-left" src="/images/reports/baby/edge.png" alt="" />' +
        '<img class="baby-edge baby-edge-bottom-right" src="/images/reports/baby/edge.png" alt="" />' +
        '<div class="primary-report-head">' +
        '<img class="baby-school-title-image" src="/images/reports/baby/school-name-mark.png" alt="School name" />' +
        '<p class="baby-kicker">“Up with skills”</p>' +
        '<p class="baby-term">' + escapeHtml(termLabel) + '</p>' +
        '<p class="baby-term baby-term-report">REPORT</p>' +
        '<div class="baby-head-line"></div>' +
        '<img class="baby-student-photo" src="' +
        escapeHtml(student.passport_path || '/images/ocean-school-logo.png') +
        '" alt="" />' +
        '<img class="baby-badge" src="/images/reports/baby/badge.png" alt="" />' +
        '<div class="baby-meta">' +
        '<p><strong>NAME:</strong> <span>' + escapeHtml((student.full_name || '').toUpperCase()) + '</span></p>' +
        '<p><strong>CLASS:</strong> <span>' + escapeHtml((classLabel || '').toUpperCase()) + '</span></p>' +
        '<p><strong>REG NO:</strong> <span>' + escapeHtml((student.reg_no || '').toUpperCase()) + '</span></p>' +
        '</div>' +
        '</div>' +
        '<div class="primary-report-body">' +
        '<table class="primary-marks-table' + (hasComparison ? ' primary-marks-table-comparison' : '') + (hasThreeTerm ? ' primary-marks-table-three-term' : '') + '">' +
        (hasComparison ? comparisonColGroup : '') +
        (hasComparison ? comparisonHead : '<thead><tr><th>Subject</th><th>F/M</th><th>Marks scored</th><th>Grade</th><th>Remark</th><th>Initials</th></tr></thead>') +
        '<tbody>' +
        marksRowsHtml +
        (hasThreeTerm ? totalRowHtml : hasComparison
          ? '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(comparisonRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(comparisonTotalScored)) + '</td><td class="num">' + escapeHtml(comparisonAggregateInfo.sum != null ? String(comparisonAggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(comparisonAggregateInfo.division || '—') + '</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '—') + '</td><td></td></tr>'
          : '<tr class="total-row"><td>TOTAL</td><td class="num">' + escapeHtml(String(academicRows.length * 100)) + '</td><td class="num">' + escapeHtml(String(totalScored)) + '</td><td class="num">' + escapeHtml(aggregateInfo.sum != null ? String(aggregateInfo.sum) : '') + '</td><td>DIV - ' + escapeHtml(aggregateInfo.division || '—') + '</td><td></td></tr>') +
        '</tbody>' +
        '</table>' +
        primaryGradeScaleHtml() +
        '<h5 class="primary-skill-title">Skills</h5>' +
        '<table class="primary-skill-table"><tbody>' + skillsRowsHtml + '</tbody></table>' +
        '</div>' +
        '<div class="primary-comments">' +
        '<p><strong>Class teacher\'s comment:</strong> ' + escapeHtml(ctBy[student.id] || '') + '</p>' +
        '<div class="primary-sign-row"><span>Signature:</span><span class="sig-line"></span></div>' +
        '<p><strong>Head teacher\'s comment:</strong> ' + escapeHtml(headBy[student.id] || '') + '</p>' +
        '<div class="primary-sign-row"><span>Signature:</span><span class="sig-line"></span></div>' +
        (period === 'end'
          ? '<p class="baby-next-term">Next term begins: <span>' + escapeHtml(nextTermBegins || '—') + '</span></p>'
          : '') +
        '</div>' +
        '</div>'
      );
    }
    const isEarlyYearsTemplate =
      ctx.classLevel === 'baby' ||
      ctx.classLevel === 'middle' ||
      ctx.classLevel === 'daycare' ||
      ctx.classLevel === 'top';
    if (isEarlyYearsTemplate) {
      const termLabel = reportTermHeading(period, term, reportYear);
      const cardOrder = defaultPictureSubjectOrder();
      const subjectIcons = {
        'Language Development': '/images/reports/baby/language-development.png',
        Reading: '/images/reports/baby/reading.png',
        Writing: '/images/reports/baby/writing.png',
        Numeracy: '/images/reports/baby/numeracy.png',
        Computer: '/images/reports/baby/computer.png',
        Music: '/images/reports/baby/music.png',
        Salon: '/images/reports/baby/salon.png',
        'Fashion and Design': '/images/reports/baby/fashion-and-design.png',
        Bakery: '/images/reports/baby/bakery.png',
        'Listening and Speaking': '/images/reports/daycare/listening-and-speaking.png',
        'Drawing and Shading': '/images/reports/daycare/drawing-and-shading.png',
        'General Knowledge': '/images/reports/daycare/general-knowledge.png',
        'Social Development': '/images/reports/daycare/social-development.png',
        'Rhymes and songs': '/images/reports/daycare/rhymes-and-songs.png',
        'Health Habits': '/images/reports/daycare/health-habits.png',
      };
      const titleClass = {
        'Language Development': 'subject-lang',
        Reading: 'subject-reading',
        Writing: 'subject-writing',
        Numeracy: 'subject-numeracy',
        Computer: 'subject-computer',
        Music: 'subject-music',
        Salon: 'subject-salon',
        'Fashion and Design': 'subject-fashion',
        Bakery: 'subject-bakery',
        'Listening and Speaking': 'subject-listening',
        'Drawing and Shading': 'subject-drawing',
        'General Knowledge': 'subject-general-knowledge',
        'Social Development': 'subject-social-development',
        'Rhymes and songs': 'subject-rhymes',
        'Health Habits': 'subject-health-habits',
      };
      const cards = cardOrder
        .map(function (sub) {
          const body =
            byC[student.id + '\t' + sub] ||
            (sub === 'Rhymes and songs' ? byC[student.id + '\t' + ('Rhyth' + 'ms and Songs')] : '') ||
            '';
          return (
            '<article class="baby-subject-card" data-subject="' +
            escapeHtml(sub) +
            '">' +
            '<img src="' +
            escapeHtml(subjectIcons[sub] || '') +
            '" alt="" />' +
            '<h5 class="' +
            escapeHtml(titleClass[sub] || '') +
            '">' +
            escapeHtml(sub) +
            '</h5>' +
            '<p>' +
            escapeHtml(body || '—') +
            '</p>' +
            '</article>'
          );
        })
        .join('');
      return (
        '<div class="baby-report-card' +
        (ctx.classLevel === 'middle' ? ' middle-report-card' : '') +
        (ctx.classLevel === 'daycare' ? ' daycare-report-card' : '') +
        (ctx.classLevel === 'top' ? ' top-report-card' : '') +
        '">' +
        '<img class="baby-edge baby-edge-top-left" src="/images/reports/baby/edge.png" alt="" />' +
        '<img class="baby-edge baby-edge-bottom-right" src="/images/reports/baby/edge.png" alt="" />' +
        '<div class="baby-report-head">' +
        '<img class="baby-school-title-image" src="/images/reports/baby/school-name-mark.png" alt="School name" />' +
        '<p class="baby-kicker">“Up with skills”</p>' +
        '<p class="baby-term">' +
        escapeHtml(termLabel) +
        '</p>' +
        '<p class="baby-term baby-term-report">REPORT</p>' +
        '<div class="baby-head-line"></div>' +
        '<img class="baby-student-photo" src="' +
        escapeHtml(student.passport_path || '/images/ocean-school-logo.png') +
        '" alt="" />' +
        '<img class="baby-badge" src="/images/reports/baby/badge.png" alt="" />' +
        '<div class="baby-meta">' +
        '<p><strong>NAME:</strong> <span>' +
        escapeHtml((student.full_name || '').toUpperCase()) +
        '</span></p>' +
        '<p><strong>CLASS:</strong> <span>' +
        escapeHtml((classLabel || '').toUpperCase()) +
        '</span></p>' +
        '<p><strong>REG NO:</strong> <span>' +
        escapeHtml((student.reg_no || '').toUpperCase()) +
        '</span></p>' +
        '</div>' +
        '</div>' +
        '<section class="baby-subjects-grid">' +
        cards +
        '</section>' +
        '<div class="baby-bottom-comments' + (period !== 'end' ? ' no-next-term' : '') + '">' +
        '<div class="baby-comment-sign-row">' +
        '<p><strong>Class teacher\'s comment:</strong> ' +
        escapeHtml(ctBy[student.id] || '') +
        '</p>' +
        '<div class="baby-sign-row"><span>Signature:</span><span class="sig-line"></span></div>' +
        '</div>' +
        '<div class="baby-comment-sign-row baby-head-row">' +
        '<p><strong>Head caregiver\'s comment:</strong> ' +
        escapeHtml(headBy[student.id] || '') +
        '</p>' +
        '<div class="baby-sign-row"><span>Signature:</span><span class="sig-line"></span></div>' +
        '</div>' +
        (period === 'end'
          ? '<p class="baby-next-term">Next term begins: <span>' +
            escapeHtml(nextTermBegins || '—') +
            '</span></p>'
          : '') +
        '</div>' +
        '</div>'
      );
    }

    const rows = [];
    subjectCols.forEach(function (sub) {
      if (isPrimary && skillList.indexOf(sub) === -1) {
        const m = byM[student.id + '\t' + sub];
        rows.push(
          '<tr><td>' +
            escapeHtml(sub) +
            '</td><td>' +
            escapeHtml(m && m.marks_scored != null ? String(m.marks_scored) : '') +
            '</td><td>' +
            escapeHtml((m && m.agg) || '') +
            '</td><td>' +
            escapeHtml((m && m.remark) || '') +
            '</td></tr>'
        );
      } else {
        const body =
          byC[student.id + '\t' + sub] ||
          (sub === 'Rhymes and songs' ? byC[student.id + '\t' + ('Rhyth' + 'ms and Songs')] : '') ||
          '';
        rows.push(
          '<tr><td>' +
            escapeHtml(sub) +
            '</td><td colspan="3" class="report-long-cell">' +
            escapeHtml(body) +
            '</td></tr>'
        );
      }
    });

    let divisionLine = '';
    if (isPrimary) {
      const marksForLearner = Object.keys(byM)
        .filter(function (k) {
          return String(k).indexOf(student.id + '\t') === 0;
        })
        .map(function (k) {
          return byM[k];
        });
      const div = primaryAggregateFromMarkRowsLocal(
        marksForLearner.map(function (r) {
          return { subject: r.subject, agg: r.agg };
        })
      ).division;
      divisionLine = '<p class="report-division"><strong>Overall division:</strong> ' + escapeHtml(div || '—') + '</p>';
    }

    return (
      '<div class="report-head">' +
      '<h4>' +
      escapeHtml(window.OCEAN_SCHOOL_NAME || 'THE OCEAN OF KNOWLEDGE SCHOOL') +
      '</h4>' +
      '<p>' +
      escapeHtml(reportPeriodLabel(period, term, reportYear)) +
      '</p>' +
      '</div>' +
      '<div class="report-meta">' +
      '<div><span>Name</span><strong>' +
      escapeHtml(student.full_name || '') +
      '</strong></div>' +
      '<div><span>Reg No.</span><strong>' +
      escapeHtml(student.reg_no || '') +
      '</strong></div>' +
      '<div><span>Class</span><strong>' +
      escapeHtml(classLabel) +
      '</strong></div>' +
      '</div>' +
      '<table class="report-table"><thead><tr><th>Subject</th><th>Marks</th><th>AGG</th><th>Remark / Comment</th></tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table>' +
      divisionLine +
      '<div class="report-comments">' +
      '<div class="report-comment-entry"><p><strong>Class Teacher\'s comment:</strong> ' +
      escapeHtml(ctBy[student.id] || '') +
      '</p><div class="report-sign-row"><span>Signature:</span><span class="sig-line"></span></div></div>' +
      '<div class="report-comment-entry"><p><strong>' +
      escapeHtml(isPrimary ? "Head Teacher's comment" : "Head Caregiver's comment") +
      ':</strong> ' +
      escapeHtml(headBy[student.id] || '') +
      '</p><div class="report-sign-row"><span>Signature:</span><span class="sig-line"></span></div></div>' +
      (period === 'end'
        ? '<p><strong>Next term begins:</strong> ' +
          escapeHtml(nextTermBegins || '—') +
          '</p>'
        : '') +
      '</div>'
    );
  }

  async function refreshReportTemplate() {
    const termEl = document.getElementById('rp-term');
    const yearEl = document.getElementById('rp-year');
    const periodEl = document.getElementById('rp-period');
    const studentEl = document.getElementById('rp-student');
    const nextTermEl = document.getElementById('rp-next-term');
    const templateOpen = document.getElementById('rp-template-open');
    const target = document.getElementById('rp-template');
    const empty = document.getElementById('rp-empty');
    if (!termEl || !periodEl || !studentEl || !target || !empty || !yearEl) return;

    try {
    const term = termEl.value;
    const customYear =
      rpYearCustom && rpYearCustom.style.display !== 'none' ? String(rpYearCustom.value || '').trim() : '';
    const reportYear = customYear || yearEl.value || String(new Date().getFullYear());
    const period = periodEl.value;
    const comparisonPeriod = isPrimary && period === 'mid' ? 'begin' : isPrimary && period === 'end' ? 'mid' : '';
    const beginComparisonPeriod = isPrimary && period === 'end' ? 'begin' : '';

    const [stuRes, comRes, marRes, headRes, ctRes, comparisonMarRes, beginComparisonMarRes] = await Promise.all([
      fetch(studentsUrl(reportYear)),
      fetch(commentsUrlForExport(term, period)),
      fetch(marksUrlForExport(term, period)),
      fetch(headCommentsUrlForExport(term, period)),
      fetch(classTeacherCommentsUrlForExport(term, period)),
      comparisonPeriod ? fetch(marksUrlForExport(term, comparisonPeriod)) : Promise.resolve(null),
      beginComparisonPeriod ? fetch(marksUrlForExport(term, beginComparisonPeriod)) : Promise.resolve(null),
    ]);
    const roster = stuRes.ok ? await stuRes.json() : [];
    const allComments = comRes.ok ? await comRes.json() : [];
    const allMarks = marRes.ok ? await marRes.json() : [];
    const comparisonMarks = comparisonMarRes && comparisonMarRes.ok
      ? await comparisonMarRes.json().catch(function () { return []; })
      : [];
    const beginComparisonMarks = beginComparisonMarRes && beginComparisonMarRes.ok
      ? await beginComparisonMarRes.json().catch(function () { return []; })
      : [];
    let allHead = headRes.ok ? await headRes.json().catch(function () { return []; }) : [];
    let allClassTeacher = ctRes.ok ? await ctRes.json().catch(function () { return []; }) : [];
    if (!Array.isArray(allHead)) allHead = [];
    if (!Array.isArray(allClassTeacher)) allClassTeacher = [];

    const settingsUrl = new URL('/api/report-settings', window.location.origin);
    settingsUrl.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) settingsUrl.searchParams.set('stream', ctx.stream);
    const settingRes = await fetch(settingsUrl.toString());
    let reportSettings = normalizeReportSettingsLocal({});
    if (settingRes.ok) {
      const sj = await settingRes.json().catch(function () {
        return {};
      });
      reportSettings = normalizeReportSettingsLocal(sj);
    }
    currentReportSettings = reportSettings;
    syncReportCustomizePanel(reportSettings);
    let nextTermBegins = reportSettings.nextTermBegins || '';
    let fontScale = reportSettings.fontScale != null ? Number(reportSettings.fontScale) : 1;
    let templatePath = reportSettings.templatePath || '';
    if (!templatePath) {
      const fallbackTemplatePath = await findFallbackBabyTemplatePath();
      if (fallbackTemplatePath) {
        templatePath = fallbackTemplatePath;
        await saveReportSettingsPatch({ templatePath: fallbackTemplatePath });
      }
    }
    const isEndPeriod = period === 'end';
    if (nextTermEl) {
      const nextTermWrap = nextTermEl.parentElement;
      const nextTermSaveBtn = document.getElementById('rp-save-next-term');
      if (nextTermWrap) nextTermWrap.style.display = isEndPeriod ? '' : 'none';
      if (nextTermSaveBtn) nextTermSaveBtn.style.display = isEndPeriod ? '' : 'none';
      if (document.activeElement !== nextTermEl) nextTermEl.value = nextTermBegins;
    }
    if (templateOpen) {
      if (templatePath) {
        templateOpen.href = templatePath;
        templateOpen.style.display = '';
      } else {
        templateOpen.removeAttribute('href');
        templateOpen.style.display = 'none';
      }
    }

    const selectedBeforeRefresh = String(studentEl.value || '');
    studentEl.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '__all__';
    allOpt.textContent = 'All learners';
    studentEl.appendChild(allOpt);
    roster.forEach(function (s) {
      const o = document.createElement('option');
      o.value = String(s.id);
      o.textContent = s.full_name + ' (' + safeText(s.reg_no) + ')';
      studentEl.appendChild(o);
    });

    if (!roster.length) {
      empty.style.display = '';
      target.innerHTML = '';
      return;
    }

    empty.style.display = 'none';
    const allSelected = selectedBeforeRefresh === '__all__';
    const selectedId = Number(selectedBeforeRefresh || roster[0].id);
    const selected = roster.find(function (s) {
      return s.id === selectedId;
    }) || roster[0];
    studentEl.value = allSelected ? '__all__' : String(selected.id);

    const fc = filterTermPeriod(allComments, term, period);
    const fm = filterTermPeriod(allMarks, term, period);
    const fh = filterTermPeriod(allHead, term, period);
    const fct = filterTermPeriod(allClassTeacher, term, period);
    const subjectCols = subjectColumnsFromBoth(fc, fm);
    const byC = {};
    const byM = {};
    const comparisonByM = {};
    const beginComparisonByM = {};
    const headBy = {};
    const ctBy = {};
    fc.forEach(function (r) { byC[r.student_id + '\t' + r.subject] = r.body; });
    fm.forEach(function (r) { byM[r.student_id + '\t' + r.subject] = r; });
    (Array.isArray(comparisonMarks) ? comparisonMarks : []).forEach(function (r) {
      comparisonByM[r.student_id + '\t' + r.subject] = r;
    });
    (Array.isArray(beginComparisonMarks) ? beginComparisonMarks : []).forEach(function (r) {
      beginComparisonByM[r.student_id + '\t' + r.subject] = r;
    });
    if (beginComparisonPeriod) comparisonByM.__beginByM = beginComparisonByM;
    fh.forEach(function (r) { headBy[r.student_id] = r.body || ''; });
    fct.forEach(function (r) { ctBy[r.student_id] = r.body || ''; });

    const reportNextTerm = isEndPeriod
      ? (nextTermEl ? nextTermEl.value : '') || nextTermBegins
      : '';
    if (studentEl.value === '__all__') {
      target.innerHTML =
        '<div class="report-stack">' +
        roster
          .map(function (s) {
            return (
              '<div class="report-stack-item">' +
              buildStudentReportHtml(s, subjectCols, byC, byM, ctBy, headBy, term, period, reportNextTerm, reportYear, comparisonByM) +
              '</div>'
            );
          })
          .join('') +
        '</div>';
    } else {
      target.innerHTML = buildStudentReportHtml(
        selected,
        subjectCols,
        byC,
        byM,
        ctBy,
        headBy,
        term,
        period,
        reportNextTerm,
        reportYear,
        comparisonByM
      );
    }
    applyReportScale(fontScale);
    applyReportTemplateCustomization(reportSettings);
    refreshReportWorkflowUi();
    } catch (err) {
      console.error('[reports] Could not load report template', err);
      const detail = err && err.message ? ' (' + err.message + ')' : '';
      empty.style.display = '';
      empty.textContent = 'Could not load reports. Please refresh and try again.' + detail;
      target.innerHTML = '';
      if (ctx.flash) ctx.flash('Could not load reports. Please refresh and try again.' + detail, false);
    }
  }

  function applyReportScale(scale, rootEl) {
    const s = Number(scale);
    const clamped = Number.isNaN(s) ? 1 : Math.max(0.8, Math.min(1.6, s));
    const sheet = rootEl || document.getElementById('rp-template');
    const cards = sheet
      ? sheet.querySelectorAll('.baby-report-card, .primary-report-card')
      : document.querySelectorAll('#rp-template .baby-report-card, #rp-template .primary-report-card');
    if (!cards.length) return;
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
    let fitScale = 1;
    if (isMobile && sheet) {
      const sample = cards[0];
      const prevTransform = sample.style.transform;
      const prevOrigin = sample.style.transformOrigin;
      sample.style.transform = 'none';
      sample.style.transformOrigin = 'top center';
      const naturalWidthPx = sample.getBoundingClientRect().width;
      sample.style.transform = prevTransform;
      sample.style.transformOrigin = prevOrigin;
      if (naturalWidthPx > 0) {
        const available = Math.max(120, sheet.clientWidth - 20);
        fitScale = Math.min(1, available / naturalWidthPx);
      }
    }
    const finalScale = fitScale;

    let totalHeightPx = 0;
    cards.forEach(function (card) {
      card.style.setProperty('--rp-font-scale', String(clamped));
      card.style.setProperty('--rp-scale', String(finalScale));
      card.style.transformOrigin = 'top center';
      card.style.transform = 'scale(' + finalScale + ')';
      const parent = card.closest('.report-stack-item');
      if (parent) {
        const naturalHeight = card.scrollHeight || 0;
        const scaledHeightPx = naturalHeight > 0 ? naturalHeight * finalScale : 0;
        if (scaledHeightPx > 0) {
          parent.style.minHeight = Math.ceil(scaledHeightPx + 8) + 'px';
          totalHeightPx += scaledHeightPx + 8;
        } else {
          parent.style.minHeight = 297 * finalScale + 'mm';
        }
      } else {
        const naturalHeightSingle = card.scrollHeight || 0;
        if (naturalHeightSingle > 0) totalHeightPx += naturalHeightSingle * finalScale;
      }
    });
    if (sheet) {
      if (totalHeightPx > 0) sheet.style.minHeight = Math.ceil(totalHeightPx + 12) + 'px';
      else sheet.style.minHeight = 297 * finalScale * cards.length + 'mm';
    }

    // Images can load after initial render and slightly change card width.
    // Re-apply once shortly after render so mobile fit stays accurate.
    if (isMobile) {
      if (applyReportScale._retryTimer) clearTimeout(applyReportScale._retryTimer);
      applyReportScale._retryTimer = setTimeout(function () {
        const panel = document.getElementById('panel-reports');
        if (!panel || !panel.classList.contains('active')) return;
        const now = Number(scale);
        const same = Number.isNaN(now) ? 1 : Math.max(0.8, Math.min(1.6, now));
        if (same !== clamped) return;
        const cardsNow = document.querySelectorAll('#rp-template .baby-report-card, #rp-template .primary-report-card');
        if (!cardsNow.length) return;
        const sampleNow = cardsNow[0];
        const prevT = sampleNow.style.transform;
        sampleNow.style.transform = 'none';
        const w = sampleNow.getBoundingClientRect().width;
        sampleNow.style.transform = prevT;
        if (!w || !sheet) return;
        const avail = Math.max(120, sheet.clientWidth - 20);
        const refit = Math.min(1, avail / w);
        const next = refit;
        cardsNow.forEach(function (card) {
          card.style.setProperty('--rp-font-scale', String(clamped));
          card.style.transformOrigin = 'top center';
          card.style.transform = 'scale(' + next + ')';
          const parent = card.closest('.report-stack-item');
          if (parent) {
            const h = card.scrollHeight || 0;
            if (h > 0) parent.style.minHeight = Math.ceil(h * next + 8) + 'px';
          }
        });
      }, 180);
    }
  }

  async function captureA4ReportCanvas(renderNode) {
    const props = [
      'transform',
      'transformOrigin',
      'border',
      'boxShadow',
      'outline',
      'width',
      'height',
      'minHeight',
      'maxWidth',
      'boxSizing',
      'overflow',
    ];
    const prev = {};
    props.forEach(function (prop) {
      prev[prop] = renderNode.style[prop];
    });
    try {
      renderNode.style.transform = 'none';
      renderNode.style.transformOrigin = 'top left';
      renderNode.style.border = 'none';
      renderNode.style.boxShadow = 'none';
      renderNode.style.outline = 'none';
      renderNode.style.width = '210mm';
      renderNode.style.height = '297mm';
      renderNode.style.minHeight = '297mm';
      renderNode.style.maxWidth = 'none';
      renderNode.style.boxSizing = 'border-box';
      renderNode.style.overflow = 'hidden';
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch (_) {}
      }
      const rect = renderNode.getBoundingClientRect();
      return window.html2canvas(renderNode, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        windowWidth: Math.ceil(Math.max(document.documentElement.clientWidth || 0, rect.width)),
        windowHeight: Math.ceil(Math.max(document.documentElement.clientHeight || 0, rect.height)),
      });
    } finally {
      props.forEach(function (prop) {
        renderNode.style[prop] = prev[prop];
      });
    }
  }

  function addA4CanvasToPdf(pdf, canvas, pageIndex) {
    if (pageIndex > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  }

  async function findFallbackBabyTemplatePath() {
    if (ctx.classLevel !== 'baby') return '';
    try {
      const u = new URL('/api/documents', window.location.origin);
      u.searchParams.set('classLevel', ctx.classLevel);
      if (ctx.stream) u.searchParams.set('stream', ctx.stream);
      u.searchParams.set('subject', 'Language Development');
      const res = await fetch(u.toString());
      if (!res.ok) return '';
      const rows = await res.json().catch(function () {
        return [];
      });
      if (!Array.isArray(rows) || !rows.length) return '';

      const scored = rows
        .filter(function (r) {
          return r && r.file_path && String(r.file_path).trim();
        })
        .map(function (r) {
          const title = String(r.title || '').toLowerCase();
          const filePath = String(r.file_path || '');
          const isPdf = /\.pdf($|\?)/i.test(filePath);
          const babyNamed = title === 'baby' || title.startsWith('baby ') || title.includes(' baby');
          const score = (babyNamed ? 10 : 0) + (isPdf ? 5 : 0);
          return {
            row: r,
            score: score,
            createdAt: new Date(r.created_at || 0).getTime() || 0,
          };
        })
        .sort(function (a, b) {
          if (b.score !== a.score) return b.score - a.score;
          return b.createdAt - a.createdAt;
        });

      return scored.length ? String(scored[0].row.file_path || '') : '';
    } catch (_) {
      return '';
    }
  }

  const rpRefresh = document.getElementById('rp-refresh');
  const rpPrint = document.getElementById('rp-print');
  const rpSaveNextTerm = document.getElementById('rp-save-next-term');
  const rpFontDec = document.getElementById('rp-font-dec');
  const rpFontInc = document.getElementById('rp-font-inc');
  const rpDownloadOne = document.getElementById('rp-download-one');
  const rpDownloadAll = document.getElementById('rp-download-all');
  const rpTemplateUpload = document.getElementById('rp-template-upload');
  const rpTemplateFile = document.getElementById('rp-template-file');
  const rpTerm = document.getElementById('rp-term');
  const rpYear = document.getElementById('rp-year');
  const rpYearCustom = document.getElementById('rp-year-custom');
  const rpPeriod = document.getElementById('rp-period');
  const rpStudent = document.getElementById('rp-student');
  const rpBadgeRange = document.getElementById('rp-badge-range');
  const rpBadgeRangeValue = document.getElementById('rp-badge-range-value');
  const rpBadgeDec = document.getElementById('rp-badge-dec');
  const rpBadgeInc = document.getElementById('rp-badge-inc');
  const rpMetaRange = document.getElementById('rp-meta-range');
  const rpMetaRangeValue = document.getElementById('rp-meta-range-value');
  const rpMetaXRange = document.getElementById('rp-meta-x-range');
  const rpMetaXValue = document.getElementById('rp-meta-x-value');
  const rpMetaWidthRange = document.getElementById('rp-meta-width-range');
  const rpMetaWidthValue = document.getElementById('rp-meta-width-value');
  const rpPhotoSizeRange = document.getElementById('rp-photo-size-range');
  const rpPhotoSizeValue = document.getElementById('rp-photo-size-value');
  const rpPhotoXRange = document.getElementById('rp-photo-x-range');
  const rpPhotoXValue = document.getElementById('rp-photo-x-value');
  const rpPhotoYRange = document.getElementById('rp-photo-y-range');
  const rpPhotoYValue = document.getElementById('rp-photo-y-value');
  const rpHeadingRange = document.getElementById('rp-heading-range');
  const rpHeadingRangeValue = document.getElementById('rp-heading-range-value');
  const rpCommentsFontRange = document.getElementById('rp-comments-font-range');
  const rpCommentsFontRangeValue = document.getElementById('rp-comments-font-range-value');
  const rpCommentGapRange = document.getElementById('rp-comment-gap-range');
  const rpCommentGapValue = document.getElementById('rp-comment-gap-value');
  const rpCommentGapDec = document.getElementById('rp-comment-gap-dec');
  const rpCommentGapInc = document.getElementById('rp-comment-gap-inc');
  const rpValidate = document.getElementById('rp-validate');
  const rpValidateOut = document.getElementById('rp-validate-out');
  const rpApprovalState = document.getElementById('rp-approval-state');
  const rpSaveWorkflow = document.getElementById('rp-save-workflow');
  const rpToggleLock = document.getElementById('rp-toggle-lock');
  const rpWorkflowMeta = document.getElementById('rp-workflow-meta');
  const rpAuditLoad = document.getElementById('rp-audit-load');
  const rpAuditLog = document.getElementById('rp-audit-log');
  const rpTabCurrent = document.getElementById('rp-tab-current');
  const rpTabHistory = document.getElementById('rp-tab-history');
  const rpCurrentView = document.getElementById('rp-current-view');
  const rpHistoryView = document.getElementById('rp-history-view');
  const hrYear = document.getElementById('hr-year');
  const hrYearCustom = document.getElementById('hr-year-custom');
  const hrTerm = document.getElementById('hr-term');
  const hrPeriod = document.getElementById('hr-period');
  const hrLoad = document.getElementById('hr-load');
  const hrSearch = document.getElementById('hr-search');
  const hrSearchBtn = document.getElementById('hr-search-btn');
  const hrDownloadSelected = document.getElementById('hr-download-selected');
  const hrDownloadAll = document.getElementById('hr-download-all');
  const hrStatus = document.getElementById('hr-status');
  const hrSummary = document.getElementById('hr-summary');
  const hrMetricsBody = document.getElementById('hr-metrics-body');
  const hrLearnersBody = document.getElementById('hr-learners-body');
  const hrTemplate = document.getElementById('hr-template');
  let historyRosterCache = [];
  let historyFilteredRoster = [];
  let historyByC = {};
  let historyByM = {};
  let historyComparisonByM = {};
  let historyHeadBy = {};
  let historyCtBy = {};
  let historyTerm = 1;
  let historyPeriod = 'mid';
  let historyYear = new Date().getFullYear();
  const rpCustomizeToggle = document.getElementById('rp-customize-toggle');
  const rpCustomizePanel = document.getElementById('rp-customize-panel');
  const rpVisualToggle = document.getElementById('rp-visual-toggle');
  const rpFontFamily = document.getElementById('rp-font-family');
  const rpFontToolbarRange = document.getElementById('rp-font-toolbar-range');
  const rpFontToolbarValue = document.getElementById('rp-font-toolbar-value');
  const rpFontRange = document.getElementById('rp-font-range');
  const rpFontRangeValue = document.getElementById('rp-font-range-value');
  const rpSubjectOffsetXLabel = document.getElementById('rp-subject-offset-x-label');
  const rpSubjectOffsetYLabel = document.getElementById('rp-subject-offset-y-label');
  const rpSubjectOffsetX = document.getElementById('rp-subject-offset-x');
  const rpSubjectOffsetY = document.getElementById('rp-subject-offset-y');
  const rpCommentsOffsetX = document.getElementById('rp-comments-offset-x');
  const rpCommentsOffsetY = document.getElementById('rp-comments-offset-y');
  const rpLayoutSave = document.getElementById('rp-layout-save');
  const rpLayoutReset = document.getElementById('rp-layout-reset');
  const rpSubjectOrderWrap = document.getElementById('rp-subject-order-wrap');
  const rpSubjectOrderList = document.getElementById('rp-subject-order-list');
  let reportSettingsSaveSeq = 0;

  function syncReportCustomizeLabels() {
    const subjectXLabel = isPrimaryReportClass() ? 'Main report block X' : 'Subject pictures X';
    const subjectYLabel = isPrimaryReportClass() ? 'Main report block Y' : 'Subject pictures Y';
    if (rpSubjectOffsetXLabel) rpSubjectOffsetXLabel.textContent = subjectXLabel;
    if (rpSubjectOffsetYLabel) rpSubjectOffsetYLabel.textContent = subjectYLabel;
  }
  const rpMenuToggle = document.getElementById('rp-menu-toggle');
  const rpActionsWrap = document.getElementById('rp-actions-wrap');
  if (rpRefresh) rpRefresh.addEventListener('click', refreshReportTemplate);
  if (rpTerm) rpTerm.addEventListener('change', refreshReportTemplate);
  if (rpYear) {
    rpYear.addEventListener('change', function () {
      if (rpYearCustom) {
        const custom = rpYear.value === '__custom__';
        rpYearCustom.style.display = custom ? '' : 'none';
        if (!custom) rpYearCustom.value = '';
      }
      refreshReportTemplate();
    });
  }
  if (rpYearCustom) {
    rpYearCustom.addEventListener('input', function () {
      refreshReportTemplate();
    });
  }
  if (rpPeriod) rpPeriod.addEventListener('change', refreshReportTemplate);
  if (rpStudent) rpStudent.addEventListener('change', refreshReportTemplate);
  function removeReportPrintHost() {
    const existing = document.getElementById('report-print-host');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }
  function prepareReportPrintHost() {
    removeReportPrintHost();
    const source = document.getElementById('rp-template');
    if (!source) return false;
    const cards = source.querySelectorAll('.baby-report-card, .primary-report-card');
    if (!cards.length) return false;
    const host = document.createElement('div');
    host.id = 'report-print-host';
    host.className = 'report-print-host';
    Array.prototype.forEach.call(cards, function (card) {
      const page = document.createElement('div');
      page.className = 'report-print-page';
      const clone = card.cloneNode(true);
      clone.classList.remove('is-dragging', 'report-edit-target', 'report-dragging', 'report-drag-over');
      clone.style.transform = 'none';
      clone.style.transformOrigin = 'top left';
      Array.prototype.forEach.call(clone.querySelectorAll('.report-drag-handle'), function (handle) {
        handle.remove();
      });
      Array.prototype.forEach.call(clone.querySelectorAll('.is-dragging, .report-edit-target, .report-dragging, .report-drag-over'), function (el) {
        el.classList.remove('is-dragging', 'report-edit-target', 'report-dragging', 'report-drag-over');
      });
      page.appendChild(clone);
      host.appendChild(page);
    });
    document.body.appendChild(host);
    return true;
  }
  if (rpPrint) {
    rpPrint.addEventListener('click', function () {
      if (!prepareReportPrintHost()) {
        if (ctx.flash) ctx.flash('No report on screen to print.', false);
        return;
      }
      document.body.classList.add('is-report-printing');
      const cleanup = function () {
        document.body.classList.remove('is-report-printing');
        removeReportPrintHost();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 60000);
    });
  }
  if (rpMenuToggle && rpActionsWrap) {
    rpMenuToggle.addEventListener('click', function () {
      const willOpen = !rpActionsWrap.classList.contains('is-open');
      rpActionsWrap.classList.toggle('is-open', willOpen);
      rpMenuToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  function setReportSubview(name) {
    const isHistory = name === 'history';
    if (rpCurrentView) rpCurrentView.style.display = isHistory ? 'none' : '';
    if (rpHistoryView) rpHistoryView.style.display = isHistory ? '' : 'none';
    if (rpTabCurrent) rpTabCurrent.className = isHistory ? 'btn' : 'btn btn-primary';
    if (rpTabHistory) rpTabHistory.className = isHistory ? 'btn btn-primary' : 'btn';
  }
  if (rpTabCurrent) rpTabCurrent.addEventListener('click', function () { setReportSubview('current'); });
  if (rpTabHistory) rpTabHistory.addEventListener('click', function () { setReportSubview('history'); });

  function selectedHistoryYear() {
    if (hrYear && hrYear.value === '__custom__') {
      const cy = Number(hrYearCustom && hrYearCustom.value ? hrYearCustom.value : '');
      if (Number.isFinite(cy) && cy >= 2000 && cy <= 2100) return cy;
    }
    const y = Number(hrYear && hrYear.value);
    if (Number.isFinite(y) && y >= 2000 && y <= 2100) return y;
    return selectedAcademicYear();
  }

  async function fetchValidateForHistory(term, period, year) {
    const u = new URL('/api/report-validate', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', String(term));
    u.searchParams.set('period', String(period));
    u.searchParams.set('year', String(year));
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    return res.json().catch(function () { return null; });
  }

  function historyUrl(path, term, period, year) {
    const u = new URL(path, window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', String(term));
    u.searchParams.set('period', String(period));
    u.searchParams.set('year', String(year));
    return u.toString();
  }

  function renderHistoryLearnerRows(roster) {
    if (!hrLearnersBody) return;
    hrLearnersBody.innerHTML = '';
    (roster || []).forEach(function (s, i) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + String(i + 1) + '</td><td>' + escapeHtml(s.full_name || '') + '</td><td>' + escapeHtml(s.reg_no || '') + '</td>';
      hrLearnersBody.appendChild(tr);
    });
  }

  function renderHistoryTemplate(roster, byC, byM, ctBy, headBy, term, period, year, comparisonByM) {
    if (!hrTemplate) return;
    if (!roster || !roster.length) {
      hrTemplate.innerHTML = '<p style="color: var(--muted); margin:0.2rem 0">No learners for this year in this class.</p>';
      return;
    }
    hrTemplate.innerHTML =
      '<div class="report-stack">' +
      roster
        .map(function (s) {
          return (
            '<div class="report-stack-item">' +
            buildStudentReportHtml(s, [], byC, byM, ctBy, headBy, String(term), String(period), '', String(year), comparisonByM) +
            '</div>'
          );
        })
        .join('') +
      '</div>';
    applyReportScale(fontScale);
  }

  function applyHistorySearchAndRender() {
    const q = String((hrSearch && hrSearch.value) || '').trim().toLowerCase();
    historyFilteredRoster = !q
      ? historyRosterCache.slice()
      : historyRosterCache.filter(function (r) {
          return (
            String(r.full_name || '').toLowerCase().indexOf(q) !== -1 ||
            String(r.reg_no || '').toLowerCase().indexOf(q) !== -1
          );
        });
    renderHistoryLearnerRows(historyFilteredRoster);
    renderHistoryTemplate(historyFilteredRoster, historyByC, historyByM, historyCtBy, historyHeadBy, historyTerm, historyPeriod, historyYear, historyComparisonByM);
    if (hrStatus) hrStatus.textContent = 'Found ' + String(historyFilteredRoster.length) + ' learner(s).';
  }

  async function loadHistoryReports() {
    if (!hrYear || !hrTerm || !hrPeriod || !hrStatus || !hrMetricsBody || !hrLearnersBody) return;
    const year = selectedHistoryYear();
    const term = Number(hrTerm.value || 1);
    const period = String(hrPeriod.value || 'mid');
    const comparisonPeriod = isPrimary && period === 'mid' ? 'begin' : isPrimary && period === 'end' ? 'mid' : '';
    const beginComparisonPeriod = isPrimary && period === 'end' ? 'begin' : '';
    hrStatus.textContent = 'Loading...';
    hrMetricsBody.innerHTML = '';
    renderHistoryLearnerRows([]);
    if (hrSummary) hrSummary.textContent = '';
    try {
      const rosterRes = await fetch(studentsUrl(year));
      const roster = rosterRes.ok ? await rosterRes.json().catch(function () { return []; }) : [];
      historyRosterCache = Array.isArray(roster) ? roster.slice() : [];
      historyFilteredRoster = historyRosterCache.slice();
      renderHistoryLearnerRows(historyFilteredRoster);

      const [comRes, marRes, headRes, ctRes, valRes, comparisonMarRes, beginComparisonMarRes] = await Promise.all([
        fetch(historyUrl('/api/comments', term, period, year)),
        fetch(historyUrl('/api/marks', term, period, year)),
        fetch(historyUrl('/api/head-comments', term, period, year)),
        fetch(historyUrl('/api/class-teacher-comments', term, period, year)),
        fetch(historyUrl('/api/report-validate', term, period, year)),
        comparisonPeriod ? fetch(historyUrl('/api/marks', term, comparisonPeriod, year)) : Promise.resolve(null),
        beginComparisonPeriod ? fetch(historyUrl('/api/marks', term, beginComparisonPeriod, year)) : Promise.resolve(null),
      ]);
      const rowsC = comRes.ok ? await comRes.json().catch(function () { return []; }) : [];
      const rowsM = marRes.ok ? await marRes.json().catch(function () { return []; }) : [];
      const rowsH = headRes.ok ? await headRes.json().catch(function () { return []; }) : [];
      const rowsCT = ctRes.ok ? await ctRes.json().catch(function () { return []; }) : [];
      const comparisonRowsM = comparisonMarRes && comparisonMarRes.ok
        ? await comparisonMarRes.json().catch(function () { return []; })
        : [];
      const beginComparisonRowsM = beginComparisonMarRes && beginComparisonMarRes.ok
        ? await beginComparisonMarRes.json().catch(function () { return []; })
        : [];
      const val = valRes.ok ? await valRes.json().catch(function () { return null; }) : null;

      historyByC = {};
      historyByM = {};
      historyComparisonByM = {};
      const historyBeginComparisonByM = {};
      historyHeadBy = {};
      historyCtBy = {};
      (rowsC || []).forEach(function (r) { historyByC[r.student_id + '\t' + r.subject] = r.body || ''; });
      (rowsM || []).forEach(function (r) { historyByM[r.student_id + '\t' + r.subject] = r; });
      (comparisonRowsM || []).forEach(function (r) { historyComparisonByM[r.student_id + '\t' + r.subject] = r; });
      (beginComparisonRowsM || []).forEach(function (r) { historyBeginComparisonByM[r.student_id + '\t' + r.subject] = r; });
      if (beginComparisonPeriod) historyComparisonByM.__beginByM = historyBeginComparisonByM;
      (rowsH || []).forEach(function (r) { historyHeadBy[r.student_id] = r.body || ''; });
      (rowsCT || []).forEach(function (r) { historyCtBy[r.student_id] = r.body || ''; });
      historyTerm = term;
      historyPeriod = period;
      historyYear = year;
      renderHistoryTemplate(historyFilteredRoster, historyByC, historyByM, historyCtBy, historyHeadBy, historyTerm, historyPeriod, historyYear, historyComparisonByM);

      const metrics = [];
      if (val) metrics.push({ label: 'Term ' + term + ' · ' + periodLabel(period), done: val.completeLearners || 0, total: val.totalLearners || 0 });
      metrics.forEach(function (m) {
        const tr = document.createElement('tr');
        const missing = Math.max(0, Number(m.total || 0) - Number(m.done || 0));
        tr.innerHTML = '<td>' + escapeHtml(m.label) + '</td><td>' + String(m.done || 0) + '</td><td>' + String(m.total || 0) + '</td><td>' + String(missing) + '</td>';
        hrMetricsBody.appendChild(tr);
      });
      if (hrSummary) hrSummary.textContent = 'Learners in ' + year + ': ' + String((roster || []).length) + '.';
      hrStatus.textContent = 'Loaded.';
    } catch (_) {
      hrStatus.textContent = 'Could not load history reports.';
    }
  }
  if (hrLoad) hrLoad.addEventListener('click', loadHistoryReports);
  if (hrSearchBtn) {
    hrSearchBtn.addEventListener('click', applyHistorySearchAndRender);
  }

  async function downloadHistoryFromHost(filename, singleOnly) {
    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
      if (ctx.flash) ctx.flash('PDF tools not loaded. Refresh and try again.', false);
      return;
    }
    const host = hrTemplate;
    if (!host) return;
    let pages = host.querySelectorAll('.report-stack-item');
    if (!pages.length) return;
    if (singleOnly) pages = [pages[0]];
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < pages.length; i += 1) {
      const node = pages[i];
      const cardNode = node.querySelector ? node.querySelector('.baby-report-card, .primary-report-card') : null;
      const renderNode = cardNode || node;
      const canvas = await captureA4ReportCanvas(renderNode);
      addA4CanvasToPdf(pdf, canvas, i);
    }
    pdf.save(filename);
  }

  if (hrDownloadSelected) {
    hrDownloadSelected.addEventListener('click', async function () {
      if (!historyFilteredRoster.length) {
        if (ctx.flash) ctx.flash('Search and load a learner first.', false);
        return;
      }
      if (historyFilteredRoster.length > 1 && ctx.flash) {
        ctx.flash('Multiple learners matched. Downloading first shown learner.', true);
      }
      await downloadHistoryFromHost(
        'history-report-' + String(historyFilteredRoster[0].reg_no || historyFilteredRoster[0].id || 'learner') + '.pdf',
        true
      );
    });
  }
  if (hrDownloadAll) {
    hrDownloadAll.addEventListener('click', async function () {
      if (!historyRosterCache.length) {
        if (ctx.flash) ctx.flash('Load history reports first.', false);
        return;
      }
      const prevSearch = hrSearch ? hrSearch.value : '';
      if (hrSearch) hrSearch.value = '';
      applyHistorySearchAndRender();
      await downloadHistoryFromHost(
        'history-reports-' + String(historyYear) + '-term' + String(historyTerm) + '-' + String(historyPeriod) + '.pdf',
        false
      );
      if (hrSearch) hrSearch.value = prevSearch;
      applyHistorySearchAndRender();
    });
  }
  async function fetchReportWorkflow() {
    if (!rpTerm || !rpPeriod) return null;
    const u = new URL('/api/report-workflow', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', rpTerm.value);
    u.searchParams.set('period', rpPeriod.value);
    u.searchParams.set('year', String(selectedAcademicYear()));
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    return res.json().catch(function () {
      return null;
    });
  }
  async function refreshReportWorkflowUi() {
    const wf = await fetchReportWorkflow();
    if (!wf) return;
    if (rpApprovalState) rpApprovalState.value = wf.approvalState || 'draft';
    if (rpToggleLock) rpToggleLock.textContent = wf.locked ? 'Unlock term' : 'Lock term';
    if (rpWorkflowMeta) {
      const when = wf.updatedAt ? new Date(wf.updatedAt).toLocaleString() : '—';
      rpWorkflowMeta.textContent =
        'Workflow: ' +
        (wf.approvalState || 'draft') +
        ' · Lock: ' +
        (wf.locked ? 'ON' : 'OFF') +
        ' · Updated: ' +
        when;
    }
  }
  async function runReportValidation() {
    if (!rpTerm || !rpPeriod) return null;
    const u = new URL('/api/report-validate', window.location.origin);
    u.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) u.searchParams.set('stream', ctx.stream);
    u.searchParams.set('term', rpTerm.value);
    u.searchParams.set('period', rpPeriod.value);
    u.searchParams.set('year', String(selectedAcademicYear()));
    if (rpStudent && rpStudent.value && rpStudent.value !== '__all__') {
      u.searchParams.set('studentId', rpStudent.value);
    }
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const data = await res.json().catch(function () {
      return null;
    });
    if (rpValidateOut && data) {
      rpValidateOut.textContent =
        'Complete: ' +
        data.completeLearners +
        '/' +
        data.totalLearners +
        ' · Missing: ' +
        data.incompleteLearners;
    }
    return data;
  }
  async function loadAuditForCurrentLearner() {
    if (!rpStudent || !rpTerm || !rpPeriod || !rpAuditLog) return;
    if (rpStudent.value === '__all__') {
      rpAuditLog.style.display = '';
      rpAuditLog.innerHTML = '<p style="margin:0">Choose one learner to view report history.</p>';
      return;
    }
    const u = new URL('/api/report-audit', window.location.origin);
    u.searchParams.set('student_id', rpStudent.value);
    u.searchParams.set('term', rpTerm.value);
    u.searchParams.set('period', rpPeriod.value);
    const res = await fetch(u.toString());
    if (!res.ok) {
      rpAuditLog.style.display = '';
      rpAuditLog.innerHTML = '<p style="margin:0">Could not load history.</p>';
      return;
    }
    const rows = await res.json().catch(function () {
      return [];
    });
    rpAuditLog.style.display = '';
    if (!rows.length) {
      rpAuditLog.innerHTML = '<p style="margin:0">No history entries yet.</p>';
      return;
    }
    rpAuditLog.innerHTML =
      '<h4 style="margin:0 0 0.45rem; font-size:0.96rem">Report history</h4>' +
      '<ul style="margin:0; padding-left:1.1rem">' +
      rows
        .map(function (r) {
          return (
            '<li style="margin:0 0 0.3rem">' +
            escapeHtml((r.created_at || '').replace('T', ' ').slice(0, 19)) +
            ' · ' +
            escapeHtml(r.entity_type || '') +
            ' · ' +
            escapeHtml(r.action || '') +
            (r.subject ? ' · ' + escapeHtml(r.subject) : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>';
  }
  async function downloadCurrentReportPdf(filename) {
    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
      if (ctx.flash) ctx.flash('PDF tools not loaded. Refresh and try again.', false);
      return;
    }
    const host = document.getElementById('rp-template');
    if (!host) return;
    let pages = host.querySelectorAll('.report-stack-item');
    if (!pages.length) {
      const first = host.firstElementChild;
      pages = first ? [first] : [];
    }
    if (!pages.length) {
      if (ctx.flash) ctx.flash('No report on screen to download.', false);
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const shouldRestoreVisualEditor = reportVisualEditorEnabled;
    if (shouldRestoreVisualEditor) setReportVisualEditorEnabled(false);
    try {
      for (let i = 0; i < pages.length; i += 1) {
        const node = pages[i];
        const cardNode = node.querySelector
          ? node.querySelector('.baby-report-card, .primary-report-card')
          : null;
        const renderNode = cardNode || node;
        const canvas = await captureA4ReportCanvas(renderNode);
        addA4CanvasToPdf(pdf, canvas, i);
      }
      pdf.save(filename || 'report.pdf');
    } finally {
      if (shouldRestoreVisualEditor) setReportVisualEditorEnabled(true);
    }
  }
  if (rpDownloadOne) {
    rpDownloadOne.addEventListener('click', async function () {
      if (rpStudent && rpStudent.value === '__all__') {
        if (ctx.flash) ctx.flash('Choose one learner to download individual PDF.', false);
        return;
      }
      const check = await runReportValidation();
      if (check && check.incompleteLearners > 0) {
        if (ctx.flash) ctx.flash('Missing report data found. Run "Check completeness" and fix first.', false);
        return;
      }
      await refreshReportTemplate();
      const learnerLabel =
        rpStudent && rpStudent.selectedOptions && rpStudent.selectedOptions[0]
          ? String(rpStudent.selectedOptions[0].textContent || 'learner')
          : 'learner';
      const safe = learnerLabel.replace(/[^\w.-]+/g, '_');
      await downloadCurrentReportPdf('report-' + safe + '.pdf');
    });
  }
  if (rpDownloadAll) {
    rpDownloadAll.addEventListener('click', async function () {
      if (!rpStudent) return;
      const prev = rpStudent.value;
      rpStudent.value = '__all__';
      const check = await runReportValidation();
      if (check && check.incompleteLearners > 0) {
        if (ctx.flash) ctx.flash('Some learners have missing report data. Run completeness check first.', false);
        rpStudent.value = prev || '__all__';
        await refreshReportTemplate();
        return;
      }
      await refreshReportTemplate();
      await downloadCurrentReportPdf('reports-all-learners.pdf');
      rpStudent.value = prev || '__all__';
      await refreshReportTemplate();
    });
  }
  if (rpValidate) {
    rpValidate.addEventListener('click', async function () {
      const data = await runReportValidation();
      if (!data) {
        if (ctx.flash) ctx.flash('Could not validate report completeness.', false);
        return;
      }
      if (ctx.flash) {
        ctx.flash(
          data.incompleteLearners
            ? 'Validation done: some learners are incomplete.'
            : 'Validation done: all required report data is complete.',
          !data.incompleteLearners
        );
      }
    });
  }
  if (rpSaveWorkflow) {
    rpSaveWorkflow.addEventListener('click', async function () {
      if (!rpApprovalState || !rpTerm || !rpPeriod) return;
      const wf = await fetchReportWorkflow();
      const locked = wf ? !!wf.locked : false;
      const payload = {
        classLevel: ctx.classLevel,
        stream: ctx.stream || '',
        term: Number(rpTerm.value),
        period: rpPeriod.value,
        approvalState: rpApprovalState.value,
        locked: locked,
      };
      const res = await fetch('/api/report-workflow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (ctx.flash) ctx.flash('Could not save workflow state.', false);
        return;
      }
      await refreshReportWorkflowUi();
      if (ctx.flash) ctx.flash('Workflow state saved.', true);
    });
  }
  if (rpToggleLock) {
    rpToggleLock.addEventListener('click', async function () {
      if (!rpTerm || !rpPeriod) return;
      const wf = await fetchReportWorkflow();
      const nextLocked = !(wf && wf.locked);
      const payload = {
        classLevel: ctx.classLevel,
        stream: ctx.stream || '',
        term: Number(rpTerm.value),
        period: rpPeriod.value,
        approvalState: (wf && wf.approvalState) || 'draft',
        locked: nextLocked,
      };
      const res = await fetch('/api/report-workflow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (ctx.flash) ctx.flash('Could not update term lock.', false);
        return;
      }
      await refreshReportWorkflowUi();
      if (ctx.flash) ctx.flash(nextLocked ? 'Term locked.' : 'Term unlocked.', true);
    });
  }
  if (rpAuditLoad) {
    rpAuditLoad.addEventListener('click', loadAuditForCurrentLearner);
  }
  if (rpSaveNextTerm) {
    rpSaveNextTerm.addEventListener('click', async function () {
      const nextTermEl = document.getElementById('rp-next-term');
      if (!nextTermEl) return;
      try {
        await saveReportSettingsPatch({ nextTermBegins: nextTermEl.value.trim() });
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save next-term date.', false);
        return;
      }
      if (ctx.flash) ctx.flash('Next-term date saved for this class report.', true);
      refreshReportTemplate();
    });
  }
  async function getCurrentReportSettings() {
    const settingsUrl = new URL('/api/report-settings', window.location.origin);
    settingsUrl.searchParams.set('classLevel', ctx.classLevel);
    if (ctx.stream) settingsUrl.searchParams.set('stream', ctx.stream);
    const res = await fetch(settingsUrl.toString());
    if (!res.ok) return normalizeReportSettingsLocal({});
    const data = await res.json().catch(function () {
      return {};
    });
    return normalizeReportSettingsLocal(data);
  }

  async function saveReportSettingsPatch(patch) {
    const seq = ++reportSettingsSaveSeq;
    const current = await getCurrentReportSettings();
    const merged = mergeReportSettingsLocal(current, patch || {});
    const payload = {
      classLevel: ctx.classLevel,
      stream: ctx.stream || '',
      nextTermBegins: merged.nextTermBegins || '',
      fontScale: merged.fontScale != null ? merged.fontScale : 1,
      templatePath: merged.templatePath || '',
      fontFamily: merged.fontFamily || 'default',
      layout: merged.layout || defaultReportLayoutSettings(),
    };
    const res = await fetch('/api/report-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to save report settings');
    const saved = await res.json().catch(function () {
      return null;
    });
    const normalized = normalizeReportSettingsLocal(saved && saved.ok ? saved : merged);
    if (seq === reportSettingsSaveSeq) currentReportSettings = normalized;
    return normalized;
  }

  function renderReportSubjectOrderEditor() {
    if (!rpSubjectOrderList || !rpSubjectOrderWrap) return;
    if (!isPictureTemplateClass()) {
      rpSubjectOrderWrap.hidden = true;
      rpSubjectOrderList.innerHTML = '';
      return;
    }
    rpSubjectOrderWrap.hidden = false;
    if (!reportSubjectOrderDraft.length) reportSubjectOrderDraft = defaultPictureSubjectOrder();
    rpSubjectOrderList.innerHTML = '';
    reportSubjectOrderDraft.forEach(function (subject, index) {
      const row = document.createElement('div');
      row.className = 'report-order-item';
      const label = document.createElement('strong');
      label.textContent = subject;
      const actions = document.createElement('div');
      actions.className = 'report-order-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'btn report-order-btn';
      up.textContent = '↑';
      up.disabled = index === 0;
      up.addEventListener('click', function () {
        if (index === 0) return;
        const next = reportSubjectOrderDraft.slice();
        const hold = next[index - 1];
        next[index - 1] = next[index];
        next[index] = hold;
        reportSubjectOrderDraft = next;
        renderReportSubjectOrderEditor();
        previewReportTemplateControls();
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'btn report-order-btn';
      down.textContent = '↓';
      down.disabled = index === reportSubjectOrderDraft.length - 1;
      down.addEventListener('click', function () {
        if (index >= reportSubjectOrderDraft.length - 1) return;
        const next = reportSubjectOrderDraft.slice();
        const hold = next[index + 1];
        next[index + 1] = next[index];
        next[index] = hold;
        reportSubjectOrderDraft = next;
        renderReportSubjectOrderEditor();
        previewReportTemplateControls();
      });
      actions.appendChild(up);
      actions.appendChild(down);
      row.appendChild(label);
      row.appendChild(actions);
      rpSubjectOrderList.appendChild(row);
    });
  }

  function syncReportCustomizePanel(settings) {
    const normalized = normalizeReportSettingsLocal(settings || {});
    currentReportSettings = normalized;
    syncReportCustomizeLabels();
    if (rpFontFamily) rpFontFamily.value = normalized.fontFamily || 'default';
    if (rpFontRange) rpFontRange.value = String(normalized.fontScale != null ? normalized.fontScale : 1);
    if (rpFontRangeValue) rpFontRangeValue.textContent = reportFontScaleLabel(normalized.fontScale);
    if (rpFontToolbarRange) rpFontToolbarRange.value = String(normalized.fontScale != null ? normalized.fontScale : 1);
    if (rpFontToolbarValue) rpFontToolbarValue.textContent = reportFontScaleLabel(normalized.fontScale);
    syncReportOffsetInputs(normalized.layout);
    reportSubjectOrderDraft = normalized.layout.subjectOrder.slice();
    renderReportSubjectOrderEditor();
    setReportVisualEditorEnabled(reportVisualEditorEnabled);
  }

  function currentReportTemplateDraft() {
    const base = normalizeReportSettingsLocal(currentReportSettings || {});
    const fontScaleInput = rpFontToolbarRange || rpFontRange;
    return mergeReportSettingsLocal(base, {
      fontFamily: rpFontFamily ? rpFontFamily.value : base.fontFamily,
      fontScale: fontScaleInput ? Number(fontScaleInput.value || base.fontScale) : base.fontScale,
      layout: {
        subjectOrder: reportSubjectOrderDraft.slice(),
        subjectGridOffsetX: rpSubjectOffsetX ? Number(rpSubjectOffsetX.value || 0) : base.layout.subjectGridOffsetX,
        subjectGridOffsetY: rpSubjectOffsetY ? Number(rpSubjectOffsetY.value || 0) : base.layout.subjectGridOffsetY,
        commentsOffsetX: rpCommentsOffsetX ? Number(rpCommentsOffsetX.value || 0) : base.layout.commentsOffsetX,
        commentsOffsetY: rpCommentsOffsetY ? Number(rpCommentsOffsetY.value || 0) : base.layout.commentsOffsetY,
        badgeScale: rpBadgeRange ? Number(rpBadgeRange.value || 1) : base.layout.badgeScale,
        metaScale: rpMetaRange ? Number(rpMetaRange.value || 1) : base.layout.metaScale,
        metaOffsetIn: rpMetaXRange ? Number(rpMetaXRange.value || 0) : base.layout.metaOffsetIn,
        metaWidthIn: rpMetaWidthRange ? Number(rpMetaWidthRange.value || 4.7) : base.layout.metaWidthIn,
        photoScale: rpPhotoSizeRange ? Number(rpPhotoSizeRange.value || 1) : base.layout.photoScale,
        photoOffsetXIn: rpPhotoXRange ? Number(rpPhotoXRange.value || 0) : base.layout.photoOffsetXIn,
        photoOffsetYIn: rpPhotoYRange ? Number(rpPhotoYRange.value || 0) : base.layout.photoOffsetYIn,
        headingScale: rpHeadingRange ? Number(rpHeadingRange.value || 1) : base.layout.headingScale,
        commentFontScale: rpCommentsFontRange ? Number(rpCommentsFontRange.value || 1) : base.layout.commentFontScale,
        commentGapMm: rpCommentGapRange
          ? Number(rpCommentGapRange.value)
          : base.layout.commentGapMm,
      },
    });
  }

  function previewReportTemplateControls() {
    const draft = currentReportTemplateDraft();
    if (rpFontRangeValue) rpFontRangeValue.textContent = reportFontScaleLabel(draft.fontScale);
    if (rpFontToolbarValue) rpFontToolbarValue.textContent = reportFontScaleLabel(draft.fontScale);
    if (rpFontRange && rpFontRange.value !== String(draft.fontScale)) rpFontRange.value = String(draft.fontScale);
    if (rpFontToolbarRange && rpFontToolbarRange.value !== String(draft.fontScale)) rpFontToolbarRange.value = String(draft.fontScale);
    if (rpBadgeRangeValue) rpBadgeRangeValue.textContent = reportFontScaleLabel(draft.layout.badgeScale || 1);
    if (rpMetaRangeValue) rpMetaRangeValue.textContent = reportFontScaleLabel(draft.layout.metaScale || 1);
    if (rpMetaXValue) rpMetaXValue.textContent = reportInchLabel(draft.layout.metaOffsetIn || 0);
    if (rpMetaWidthValue) rpMetaWidthValue.textContent = reportInchLabel(draft.layout.metaWidthIn || 4.7);
    if (rpPhotoSizeValue) rpPhotoSizeValue.textContent = reportFontScaleLabel(draft.layout.photoScale || 1);
    if (rpPhotoXValue) rpPhotoXValue.textContent = reportInchLabel(draft.layout.photoOffsetXIn || 0);
    if (rpPhotoYValue) rpPhotoYValue.textContent = reportInchLabel(draft.layout.photoOffsetYIn || 0);
    if (rpHeadingRangeValue) rpHeadingRangeValue.textContent = reportFontScaleLabel(draft.layout.headingScale || 1);
    if (rpCommentsFontRangeValue) rpCommentsFontRangeValue.textContent = reportFontScaleLabel(draft.layout.commentFontScale || 1);
    if (rpCommentGapValue) rpCommentGapValue.textContent = String(draft.layout.commentGapMm) + 'mm';
    syncReportOffsetInputs(draft.layout);
    applyReportScale(draft.fontScale);
    applyReportTemplateCustomization(draft);
  }

  if (rpCustomizeToggle && rpCustomizePanel) {
    rpCustomizeToggle.addEventListener('click', function () {
      const willOpen = rpCustomizePanel.hasAttribute('hidden');
      if (willOpen) {
        rpCustomizePanel.removeAttribute('hidden');
        setReportVisualEditorEnabled(true);
      } else {
        rpCustomizePanel.setAttribute('hidden', 'hidden');
        setReportVisualEditorEnabled(false);
      }
      rpCustomizeToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  if (rpVisualToggle) {
    rpVisualToggle.addEventListener('click', function () {
      setReportVisualEditorEnabled(!reportVisualEditorEnabled);
    });
  }

  [rpFontRange, rpFontToolbarRange, rpSubjectOffsetX, rpSubjectOffsetY, rpCommentsOffsetX, rpCommentsOffsetY, rpBadgeRange, rpMetaRange, rpMetaXRange, rpMetaWidthRange, rpPhotoSizeRange, rpPhotoXRange, rpPhotoYRange, rpHeadingRange, rpCommentsFontRange, rpCommentGapRange].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', previewReportTemplateControls);
  });
  [rpFontRange, rpFontToolbarRange].forEach(function (el) {
    if (!el) return;
    el.addEventListener('change', async function () {
      const draft = currentReportTemplateDraft();
      try {
        await saveReportSettingsPatch({ fontScale: draft.fontScale });
        currentReportSettings = mergeReportSettingsLocal(currentReportSettings || {}, { fontScale: draft.fontScale });
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save report font size.', false);
      }
    });
  });
  if (rpFontFamily) rpFontFamily.addEventListener('change', previewReportTemplateControls);

  if (rpLayoutSave) {
    rpLayoutSave.addEventListener('click', async function () {
      const draft = currentReportTemplateDraft();
      let saved;
      try {
        saved = await saveReportSettingsPatch({
          fontScale: draft.fontScale,
          fontFamily: draft.fontFamily,
          layout: draft.layout,
        });
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save template layout.', false);
        return;
      }
      const finalSettings = mergeReportSettingsLocal(saved || draft, {
        fontScale: draft.fontScale,
        fontFamily: draft.fontFamily,
        layout: draft.layout,
      });
      currentReportSettings = finalSettings;
      if (ctx.flash) ctx.flash('Template layout saved for this class.', true);
      syncReportCustomizePanel(finalSettings);
      applyReportScale(finalSettings.fontScale);
      applyReportTemplateCustomization(finalSettings);
    });
  }

  if (rpLayoutReset) {
    rpLayoutReset.addEventListener('click', async function () {
      const resetPatch = {
        fontScale: 1,
        fontFamily: 'default',
        layout: defaultReportLayoutSettings(),
      };
      try {
        await saveReportSettingsPatch(resetPatch);
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not restore template defaults.', false);
        return;
      }
      syncReportCustomizePanel(mergeReportSettingsLocal(currentReportSettings || {}, resetPatch));
      if (ctx.flash) ctx.flash('Template layout restored to defaults.', true);
      refreshReportTemplate();
    });
  }

  if (rpFontDec) {
    rpFontDec.addEventListener('click', async function () {
      const cur = await getCurrentReportSettings();
      const n = Math.max(0.8, Math.min(1.6, (Number(cur.fontScale) || 1) - 0.05));
      await saveReportSettingsPatch({ fontScale: n });
      refreshReportTemplate();
    });
  }
  if (rpFontInc) {
    rpFontInc.addEventListener('click', async function () {
      const cur = await getCurrentReportSettings();
      const n = Math.max(0.8, Math.min(1.6, (Number(cur.fontScale) || 1) + 0.05));
      await saveReportSettingsPatch({ fontScale: n });
      refreshReportTemplate();
    });
  }
  async function nudgeReportBadgeScale(delta) {
    const draft = currentReportTemplateDraft();
    const n = clampBadgeScale((Number(draft.layout.badgeScale) || 1) + delta);
    if (rpBadgeRange) rpBadgeRange.value = String(n);
    previewReportTemplateControls();
    await saveReportSettingsPatch({ layout: Object.assign({}, draft.layout, { badgeScale: n }) });
    currentReportSettings = mergeReportSettingsLocal(currentReportSettings || {}, {
      layout: { badgeScale: n },
    });
  }
  if (rpBadgeDec) {
    rpBadgeDec.addEventListener('click', async function () {
      try {
        await nudgeReportBadgeScale(-0.05);
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save badge size.', false);
      }
    });
  }
  if (rpBadgeInc) {
    rpBadgeInc.addEventListener('click', async function () {
      try {
        await nudgeReportBadgeScale(0.05);
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save badge size.', false);
      }
    });
  }
  if (rpBadgeRange) {
    rpBadgeRange.addEventListener('change', async function () {
      const draft = currentReportTemplateDraft();
      try {
        await saveReportSettingsPatch({ layout: draft.layout });
        currentReportSettings = mergeReportSettingsLocal(currentReportSettings || {}, { layout: draft.layout });
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save badge size.', false);
      }
    });
  }
  [rpMetaRange, rpMetaXRange, rpMetaWidthRange, rpPhotoSizeRange, rpPhotoXRange, rpPhotoYRange, rpHeadingRange, rpCommentsFontRange].forEach(function (el) {
    if (!el) return;
    el.addEventListener('change', async function () {
      const draft = currentReportTemplateDraft();
      try {
        await saveReportSettingsPatch({ layout: draft.layout });
        currentReportSettings = mergeReportSettingsLocal(currentReportSettings || {}, { layout: draft.layout });
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save section font size.', false);
      }
    });
  });
  async function nudgeReportCommentGap(delta) {
    const draft = currentReportTemplateDraft();
    const n = clampCommentGapMm(Number(draft.layout.commentGapMm) + delta);
    if (rpCommentGapRange) rpCommentGapRange.value = String(n);
    previewReportTemplateControls();
    const layout = Object.assign({}, draft.layout, { commentGapMm: n });
    await saveReportSettingsPatch({ layout: layout });
    currentReportSettings = mergeReportSettingsLocal(currentReportSettings || {}, { layout: layout });
  }
  if (rpCommentGapDec) {
    rpCommentGapDec.addEventListener('click', async function () {
      try { await nudgeReportCommentGap(-1); }
      catch (_) { if (ctx.flash) ctx.flash('Could not save comment spacing.', false); }
    });
  }
  if (rpCommentGapInc) {
    rpCommentGapInc.addEventListener('click', async function () {
      try { await nudgeReportCommentGap(1); }
      catch (_) { if (ctx.flash) ctx.flash('Could not save comment spacing.', false); }
    });
  }
  if (rpCommentGapRange) {
    rpCommentGapRange.addEventListener('change', async function () {
      const draft = currentReportTemplateDraft();
      try {
        await saveReportSettingsPatch({ layout: draft.layout });
        currentReportSettings = mergeReportSettingsLocal(currentReportSettings || {}, { layout: draft.layout });
      } catch (_) {
        if (ctx.flash) ctx.flash('Could not save comment spacing.', false);
      }
    });
  }
  if (rpTemplateUpload && rpTemplateFile) {
    rpTemplateUpload.addEventListener('click', async function () {
      const file = rpTemplateFile.files && rpTemplateFile.files[0];
      if (!file) {
        if (ctx.flash) ctx.flash('Choose a template file first.', false);
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('classLevel', ctx.classLevel);
      if (ctx.stream) fd.append('stream', ctx.stream);
      const res = await fetch('/api/report-template', { method: 'POST', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        if (ctx.flash) ctx.flash(data.error || 'Template upload failed.', false);
        return;
      }
      if (ctx.flash) ctx.flash('Template uploaded for this class.', true);
      rpTemplateFile.value = '';
      refreshReportTemplate();
    });
  }

  window.__oceanCommentsResetToFirstLearner = resetLearnerToFirst;

  window.__oceanCommentsInit = function () {
    subjectOptions();
    fetchSchoolReportingContext()
      .then(function (ctx0) {
        if (ctx0) {
          if (elTerm) elTerm.value = String(ctx0.term || 1);
          if (elPeriod) elPeriod.value = String(ctx0.period || 'mid');
        }
        updatePeriodLabel();
        return loadGradingBands();
      })
      .then(function () {
        return loadStudents();
      })
      .then(function () {
        return Promise.all([refreshSubjectRows(), loadClassTeacherComments()]);
      })
      .then(function () {
        resetLearnerToFirst();
        updateReadonlyUi();
        updateClassTeacherSummary();
        startCommentsPolling();
      });
  };

  window.__oceanExportInit = function () {
    const ct = document.getElementById('cc-term');
    const cp = document.getElementById('cc-period');
    if (exTerm && ct) exTerm.value = ct.value;
    if (exPeriod && cp) exPeriod.value = cp.value;
    const schoolLine = document.getElementById('cc-export-school-line');
    if (schoolLine && typeof window !== 'undefined' && window.OCEAN_SCHOOL_NAME) {
      schoolLine.textContent = window.OCEAN_SCHOOL_NAME;
    }
    refreshExportTable();
  };

  function populateReportYearSelect(defaultYear) {
    if (!rpYear) return;
    const now = new Date().getFullYear();
    const pick = Number.isFinite(Number(defaultYear)) ? Number(defaultYear) : now;
    rpYear.innerHTML = '';
    for (let y = now - 2; y <= now + 2; y += 1) {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      if (y === pick) o.selected = true;
      rpYear.appendChild(o);
    }
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom year...';
    rpYear.appendChild(customOpt);
    if (![now - 2, now - 1, now, now + 1, now + 2].includes(pick)) {
      rpYear.value = '__custom__';
      if (rpYearCustom) {
        rpYearCustom.style.display = '';
        rpYearCustom.value = String(pick);
      }
    } else if (rpYearCustom) {
      rpYearCustom.style.display = 'none';
      rpYearCustom.value = '';
    }
  }

  function finishReportsInit(ctx0) {
    const ct = document.getElementById('cc-term');
    const cp = document.getElementById('cc-period');
    const defaultTerm = ctx0 && ctx0.term ? String(ctx0.term) : ct ? ct.value : '1';
    const defaultPeriod = ctx0 && ctx0.period ? String(ctx0.period) : cp ? cp.value : 'mid';
    const defaultYear = ctx0 && ctx0.year ? Number(ctx0.year) : new Date().getFullYear();
    if (rpTerm) rpTerm.value = defaultTerm;
    if (rpPeriod) rpPeriod.value = defaultPeriod;
    populateReportYearSelect(defaultYear);
    if (hrYear) {
        hrYear.innerHTML = '';
        const now = new Date().getFullYear();
        for (let y = now - 5; y <= now + 2; y += 1) {
          const o = document.createElement('option');
          o.value = String(y);
          o.textContent = String(y);
          if (y === defaultYear) o.selected = true;
          hrYear.appendChild(o);
        }
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = 'Custom year...';
        hrYear.appendChild(customOpt);
        hrYear.addEventListener('change', function () {
          if (!hrYearCustom) return;
          const custom = hrYear.value === '__custom__';
          hrYearCustom.style.display = custom ? '' : 'none';
          if (!custom) hrYearCustom.value = '';
        });
      }
      if (hrYearCustom) {
        hrYearCustom.addEventListener('input', function () {
          if (hrStatus) hrStatus.textContent = '';
        });
      }
    if (rpYearCustom && rpYear && rpYear.value !== '__custom__') {
      rpYearCustom.style.display = 'none';
      rpYearCustom.value = '';
    }
    if (rpTabCurrent) setReportSubview('current');
    return refreshReportTemplate().then(function () {
      return refreshReportWorkflowUi();
    });
  }

  window.__oceanReportsInit = function () {
    populateReportYearSelect(new Date().getFullYear());
    return loadGradingBands()
      .then(fetchSchoolReportingContext)
      .then(finishReportsInit)
      .catch(function () {
        return finishReportsInit(null);
      });
  };

  async function renderLearnerReportForLookup(opts) {
    const student = opts && opts.student;
    const targetEl = opts && opts.targetEl;
    if (!student || !targetEl) return;
    if (!gradingBands.length) await loadGradingBands();
    const classLevel = String(opts.classLevel || student.class_level || '').trim();
    const stream = opts.stream != null ? String(opts.stream).trim() : String(student.stream || '').trim();
    const term = String(opts.term || '1');
    const period = String(opts.period || 'mid');
    const year = String(opts.year || new Date().getFullYear());
    const backup = {
      classLevel: ctx.classLevel,
      stream: ctx.stream,
      displayTitle: ctx.displayTitle,
      streamLabels: ctx.streamLabels,
      subjects: ctx.subjects,
      isPrimary: ctx.isPrimary,
      skillOnlySubjects: ctx.skillOnlySubjects,
    };
    ctx.classLevel = classLevel;
    ctx.stream = stream;
    ctx.displayTitle = opts.displayTitle || ctx.displayTitle || classLevel;
    ctx.streamLabels = opts.streamLabels || ctx.streamLabels || {};
    ctx.subjects = (opts.subjects || []).slice();
    ctx.isPrimary = !!opts.isPrimary;
    ctx.skillOnlySubjects = opts.skillOnlySubjects || ctx.skillOnlySubjects || [];

    function urlWithYear(base, path, extra) {
      const u = new URL(path, window.location.origin);
      u.searchParams.set('classLevel', classLevel);
      if (stream) u.searchParams.set('stream', stream);
      Object.keys(extra || {}).forEach(function (k) {
        u.searchParams.set(k, extra[k]);
      });
      u.searchParams.set('year', year);
      return u.toString();
    }

    try {
      const comparisonPeriod = isPrimary && period === 'mid' ? 'begin' : isPrimary && period === 'end' ? 'mid' : '';
      const beginComparisonPeriod = isPrimary && period === 'end' ? 'begin' : '';
      const [comRes, marRes, headRes, ctRes, settingRes, comparisonMarRes, beginComparisonMarRes] = await Promise.all([
        fetch(urlWithYear(null, '/api/comments', { term: term, period: period })),
        fetch(urlWithYear(null, '/api/marks', { term: term, period: period })),
        fetch(urlWithYear(null, '/api/head-comments', { term: term, period: period })),
        fetch(urlWithYear(null, '/api/class-teacher-comments', { term: term, period: period })),
        fetch(
          (function () {
            const u = new URL('/api/report-settings', window.location.origin);
            u.searchParams.set('classLevel', classLevel);
            if (stream) u.searchParams.set('stream', stream);
            return u.toString();
          })()
        ),
        comparisonPeriod
          ? fetch(urlWithYear(null, '/api/marks', { term: term, period: comparisonPeriod }))
          : Promise.resolve(null),
        beginComparisonPeriod
          ? fetch(urlWithYear(null, '/api/marks', { term: term, period: beginComparisonPeriod }))
          : Promise.resolve(null),
      ]);
      const allComments = comRes.ok ? await comRes.json() : [];
      const allMarks = marRes.ok ? await marRes.json() : [];
      const comparisonMarks = comparisonMarRes && comparisonMarRes.ok
        ? await comparisonMarRes.json().catch(function () { return []; })
        : [];
      const beginComparisonMarks = beginComparisonMarRes && beginComparisonMarRes.ok
        ? await beginComparisonMarRes.json().catch(function () { return []; })
        : [];
      let allHead = headRes.ok ? await headRes.json().catch(function () { return []; }) : [];
      let allClassTeacher = ctRes.ok ? await ctRes.json().catch(function () { return []; }) : [];
      if (!Array.isArray(allHead)) allHead = [];
      if (!Array.isArray(allClassTeacher)) allClassTeacher = [];
      let reportSettings = normalizeReportSettingsLocal({});
      if (settingRes.ok) {
        const sj = await settingRes.json().catch(function () { return {}; });
        reportSettings = normalizeReportSettingsLocal(sj);
      }
      const fc = filterTermPeriod(allComments, term, period);
      const fm = filterTermPeriod(allMarks, term, period);
      const fh = filterTermPeriod(allHead, term, period);
      const fct = filterTermPeriod(allClassTeacher, term, period);
      const subjectCols = subjectColumnsFromBoth(fc, fm);
      const byC = {};
      const byM = {};
      const comparisonByM = {};
      const beginComparisonByM = {};
      const headBy = {};
      const ctBy = {};
      fc.forEach(function (r) { byC[r.student_id + '\t' + r.subject] = r.body; });
      fm.forEach(function (r) { byM[r.student_id + '\t' + r.subject] = r; });
      (Array.isArray(comparisonMarks) ? comparisonMarks : []).forEach(function (r) {
        comparisonByM[r.student_id + '\t' + r.subject] = r;
      });
      (Array.isArray(beginComparisonMarks) ? beginComparisonMarks : []).forEach(function (r) {
        beginComparisonByM[r.student_id + '\t' + r.subject] = r;
      });
      if (beginComparisonPeriod) comparisonByM.__beginByM = beginComparisonByM;
      fh.forEach(function (r) { headBy[r.student_id] = r.body || ''; });
      fct.forEach(function (r) { ctBy[r.student_id] = r.body || ''; });
      const nextTermBegins = period === 'end' ? reportSettings.nextTermBegins || '' : '';
      targetEl.innerHTML = buildStudentReportHtml(
        student,
        subjectCols,
        byC,
        byM,
        ctBy,
        headBy,
        term,
        period,
        nextTermBegins,
        year,
        comparisonByM
      );
      const fontScale = reportSettings.fontScale != null ? Number(reportSettings.fontScale) : 1;
      applyReportScale(fontScale, targetEl);
      applyReportTemplateCustomization(reportSettings, targetEl);
    } catch (_) {
      targetEl.innerHTML = '<p class="ll-muted">Could not load report preview.</p>';
    } finally {
      Object.assign(ctx, backup);
    }
  }

  window.OceanClassReports = {
    init: window.__oceanReportsInit,
    refresh: refreshReportTemplate,
    populateYears: populateReportYearSelect,
    renderLearner: renderLearnerReportForLookup,
  };

  let reportScaleResizeTimer = null;
  window.addEventListener('resize', function () {
    if (reportScaleResizeTimer) clearTimeout(reportScaleResizeTimer);
    reportScaleResizeTimer = setTimeout(function () {
      const reportPanel = document.getElementById('panel-reports');
      if (!reportPanel || !reportPanel.classList.contains('active')) return;
      applyReportScale(fontScale);
    }, 120);
  });

  window.addEventListener('ocean-grading-saved', function (ev) {
    gradingBands = normalizeBandsClient(ev.detail && ev.detail.bands ? ev.detail.bands : []);
    if (isMarksSubject()) refreshMarksSystemOut();
    const reportPanel = document.getElementById('panel-reports');
    if (reportPanel && reportPanel.classList.contains('active')) refreshReportTemplate();
  });

  window.addEventListener('ocean-profile-updated', function () {
    if (isMarksSubject()) refreshMarksSystemOut();
  });
})();
