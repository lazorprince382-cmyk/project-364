/**
 * Skill dashboard — learner comments for this skill subject (author: skill_teacher).
 */
(function () {
  const panel = document.getElementById('panel-skill-comments');
  if (!panel || !window.__oceanSkill) return;

  const subjectName = window.__oceanSkill.subjectName;
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

  function buildClassRows() {
    const rows = [];
    if (!window.OCEAN_CLASSES) return rows;
    OCEAN_CLASSES.forEach(function (cfg) {
      if (cfg.id === 'skills') return;
      if (cfg.needsStream && cfg.streams) {
        cfg.streams.forEach(function (s) {
          rows.push({
            classLevel: cfg.id,
            stream: s.id,
            label: (titles[cfg.id] || cfg.id) + ' — ' + s.label,
          });
        });
      } else {
        rows.push({ classLevel: cfg.id, stream: '', label: titles[cfg.id] || cfg.id });
      }
    });
    return rows;
  }

  const CLASS_ROWS = buildClassRows();
  const elClass = document.getElementById('sc-class-pick');
  const elTerm = document.getElementById('sc-term');
  const elPeriod = document.getElementById('sc-period');
  const elPeriodLabel = document.getElementById('sc-period-label');
  const elBody = document.getElementById('sc-body');
  const elChar = document.getElementById('sc-char-count');
  const elCarousel = document.getElementById('sc-carousel');
  const elSummaryLine = document.getElementById('sc-summary-line');
  const elSummaryPct = document.getElementById('sc-summary-pct');
  const elSummaryFill = document.getElementById('sc-summary-fill');

  let students = [];
  let idx = 0;
  let commentRows = [];
  let pick = null;
  let quickBankFetchToken = 0;

  CLASS_ROWS.forEach(function (r) {
    const o = document.createElement('option');
    o.value = r.classLevel + '|' + (r.stream || '');
    o.textContent = r.label;
    elClass.appendChild(o);
  });

  function parsePick() {
    const v = elClass.value;
    if (!v) return null;
    const p = v.split('|');
    return { classLevel: p[0], stream: p[1] != null ? p[1] : '' };
  }

  function labelClass(cl, st) {
    const t = titles[cl] || cl;
    return st ? t + ' — ' + (streamLabels[st] || st) : t;
  }

  function periodLabel(period) {
    if (period === 'begin') return 'Beginning of term';
    return period === 'mid' ? 'Mid term' : 'End of term';
  }

  function periodShortLabel(period) {
    if (period === 'begin') return 'Beginning';
    return period === 'mid' ? 'Mid' : 'End';
  }

  function updatePeriodLabel() {
    const t = elTerm.value;
    const p = elPeriod.value;
    elPeriodLabel.textContent =
      periodLabel(p) +
      ' ' +
      t +
      ' · Subject: ' +
      subjectName +
      ' — choose a class, then move learner to learner.';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function insertCommentSnippet(textarea, snippet) {
    if (!textarea || !snippet) return;
    const clean = String(snippet).trim();
    if (!clean) return;
    textarea.value = clean;
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(clean.length, clean.length);
    }
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyQuickCommentBank(items) {
    const QC = window.OceanQuickComments;
    if (!QC || !QC.renderCommentBankPicker) return;
    QC.renderCommentBankPicker('sc-comment-bank', elBody, items, insertCommentSnippet);
  }

  async function fetchWeeklyBandsForStudent(studentId) {
    pick = parsePick();
    if (!pick || !studentId) return [];
    try {
      const u = new URL('/api/weekly-bands', window.location.origin);
      u.searchParams.set('classLevel', pick.classLevel);
      if (pick.stream) u.searchParams.set('stream', pick.stream);
      u.searchParams.set('subject', subjectName);
      u.searchParams.set('term', String(elTerm.value));
      u.searchParams.set('student_id', String(studentId));
      const res = await fetch(u);
      return res.ok ? await res.json().catch(function () { return []; }) : [];
    } catch (_) {
      return [];
    }
  }

  async function refreshQuickCommentBank() {
    const QC = window.OceanQuickComments;
    if (!QC) return;
    const s = students[idx];
    const token = ++quickBankFetchToken;
    applyQuickCommentBank([]);
    let weeklyRows = [];
    if (s && pick) {
      weeklyRows = await fetchWeeklyBandsForStudent(s.id);
    }
    if (token !== quickBankFetchToken) return;
    const name = s ? QC.learnerEnglishFirstName(s.full_name) : 'Learner';
    const summary = QC.summarizeWeeklyBands(weeklyRows);
    const items = QC.buildSubjectComments({
      studentId: s ? s.id : 0,
      name: name,
      subject: subjectName,
      classLevel: pick ? pick.classLevel : 'baby',
      summary: summary,
      weeklyRows: weeklyRows,
    });
    applyQuickCommentBank(items);
  }

  async function loadStudents() {
    pick = parsePick();
    if (!pick) {
      students = [];
      idx = 0;
      renderCarousel();
      showLearner();
      return;
    }
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    const res = await fetch(u);
    students = res.ok ? await res.json() : [];
    idx = 0;
    renderCarousel();
    showLearner();
    await loadComments();
  }

  async function loadComments() {
    pick = parsePick();
    if (!pick) {
      commentRows = [];
      fillCommentForCurrent();
      return;
    }
    const u = new URL('/api/comments', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('subject', subjectName);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    const res = await fetch(u);
    commentRows = res.ok ? await res.json() : [];
    fillCommentForCurrent();
    updateSummary();
  }

  function commentForStudent(sid) {
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    const row = commentRows.find(function (r) {
      return r.student_id === sid && r.subject === subjectName && Number(r.term) === t && r.period === p;
    });
    return row ? row.body : '';
  }

  function renderCarousel() {
    elCarousel.innerHTML = '';
    students.forEach(function (s, i) {
      const div = document.createElement('div');
      div.className = 'comments-carousel-item' + (i === idx ? ' selected' : '');
      const img = s.passport_path
        ? '<img src="' + escapeHtml(s.passport_path) + '" alt="" />'
        : '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2256%22 height=%2256%22%3E%3Crect fill=%22%231e5078%22 width=%2256%22 height=%2256%22/%3E%3C/svg%3E" alt="" />';
      div.innerHTML = img + '<span>' + escapeHtml(s.full_name) + '</span>';
      div.addEventListener('click', function () {
        idx = i;
        renderCarousel();
        showLearner();
      });
      elCarousel.appendChild(div);
    });
  }

  function showLearner() {
    const s = students[idx];
    const ph = document.getElementById('sc-profile-photo');
    if (!s) {
      ph.innerHTML = '';
      document.getElementById('sc-d-name').textContent = '—';
      elBody.value = '';
      elChar.textContent = '0 / 300';
      refreshQuickCommentBank();
      return;
    }
    ph.innerHTML = s.passport_path
      ? '<img src="' + escapeHtml(s.passport_path) + '" alt="" />'
      : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">No photo</div>';
    document.getElementById('sc-d-name').textContent = s.full_name;
    document.getElementById('sc-d-class').textContent = pick ? labelClass(pick.classLevel, pick.stream) : '—';
    document.getElementById('sc-d-reg').textContent = s.reg_no || '—';
    fillCommentForCurrent();
    refreshQuickCommentBank();
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
    elBody.readOnly = false;
    elBody.classList.remove('comments-readonly');
  }

  function updateSummary() {
    const total = students.length;
    const done = commentRows.filter(function (r) {
      return (
        r.subject === subjectName &&
        String(r.term) === String(elTerm.value) &&
        r.period === elPeriod.value &&
        r.body &&
        r.body.trim()
      );
    }).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    elSummaryLine.textContent =
      (pick ? labelClass(pick.classLevel, pick.stream) : '—') +
      ' · ' +
      subjectName +
      ': ' +
      done +
      ' / ' +
      total +
      ' comments for ' +
      periodShortLabel(elPeriod.value) +
      ' Term ' +
      elTerm.value;
    elSummaryPct.textContent = pct + '%';
    elSummaryFill.style.width = pct + '%';
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

  async function saveComment() {
    const s = students[idx];
    if (!s || !pick) {
      alert('Choose a class first.');
      return;
    }
    const targetStudentId = s.id;
    let body = elBody.value.trim();
    if (!body) {
      alert('Write a comment before saving.');
      return;
    }
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: targetStudentId,
        subject: subjectName,
        term: Number(elTerm.value),
        period: elPeriod.value,
        body: body,
        author_role: 'skill_teacher',
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      alert(data.error || 'Could not save');
      return;
    }
    const flash = document.getElementById('flash');
    if (flash) {
      flash.innerHTML = '<div class="msg ok">Comment saved.</div>';
      setTimeout(function () {
        flash.innerHTML = '';
      }, 3000);
    }
    await loadComments();
  }

  function moveIdx(delta) {
    if (!students.length) return;
    idx = Math.max(0, Math.min(students.length - 1, idx + delta));
    renderCarousel();
    showLearner();
    const ch = elCarousel.children[idx];
    if (ch) ch.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  elClass.addEventListener('change', function () {
    loadStudents().then(function () {
      refreshQuickCommentBank();
    });
  });
  elTerm.addEventListener('change', function () {
    updatePeriodLabel();
    loadComments().then(function () {
      refreshQuickCommentBank();
    });
  });
  elPeriod.addEventListener('change', function () {
    updatePeriodLabel();
    loadComments();
  });
  elBody.addEventListener('input', function () {
    elChar.textContent = elBody.value.length + ' / 300';
  });
  window.addEventListener('ocean-weekly-bands-updated', function (ev) {
    if (ev.detail && ev.detail.subject && ev.detail.subject !== subjectName) return;
    refreshQuickCommentBank();
  });

  document.getElementById('sc-prev').addEventListener('click', function () {
    moveIdx(-1);
  });
  document.getElementById('sc-next').addEventListener('click', function () {
    moveIdx(1);
  });
  document.getElementById('sc-save-only').addEventListener('click', saveComment);
  document.getElementById('sc-save-next').addEventListener('click', async function () {
    await saveComment();
    moveIdx(1);
  });
  document.getElementById('sc-save-prev').addEventListener('click', async function () {
    await saveComment();
    moveIdx(-1);
  });

  window.__oceanSkillCommentsInit = function () {
    updatePeriodLabel();
    loadStudents();
  };
})();
