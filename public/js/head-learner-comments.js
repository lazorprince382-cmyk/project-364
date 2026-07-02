/**
 * Head teacher dashboard — one head narrative per learner per term & period (export column).
 */
(function () {
  const panel = document.getElementById('panel-head-comments');
  if (!panel || !window.__oceanHead) return;

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

  const CLASS_ROWS = window.__oceanHead.CLASS_ROWS || [];
  const elClass = document.getElementById('hc-class-pick');
  const elTerm = document.getElementById('hc-term');
  const elPeriod = document.getElementById('hc-period');
  const elPeriodLabel = document.getElementById('hc-period-label');
  const elBody = document.getElementById('hc-body');
  const elChar = document.getElementById('hc-char-count');
  const elCarousel = document.getElementById('hc-carousel');
  const elSummaryLine = document.getElementById('hc-summary-line');
  const elSummaryPct = document.getElementById('hc-summary-pct');
  const elSummaryFill = document.getElementById('hc-summary-fill');
  const elClassTeacherComment = document.getElementById('hc-class-teacher-comment');
  const elClassTeacherMeta = document.getElementById('hc-class-teacher-meta');
  const elClassTeacherChar = document.getElementById('hc-class-teacher-char');
  const elClassTeacherSave = document.getElementById('hc-class-teacher-save');
  const elClassTeacherReset = document.getElementById('hc-class-teacher-reset');
  const MAX = 400;
  const CLASS_TEACHER_MAX = 300;

  let students = [];
  let idx = 0;
  let commentRows = [];
  let classTeacherRows = [];
  let pick = null;

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

  function isPrimaryClass(cl) {
    return cl === 'primary1' || cl === 'primary2';
  }

  function periodLabel(period) {
    if (period === 'begin') return 'Beginning of term';
    return period === 'mid' ? 'Mid term' : 'End of term';
  }

  function periodShortLabel(period) {
    if (period === 'begin') return 'Beginning';
    return period === 'mid' ? 'Mid' : 'End';
  }

  async function applySharedReportingContext() {
    try {
      const res = await fetch('/api/reporting-context');
      if (!res.ok) return;
      const ctx = await res.json().catch(function () {
        return {};
      });
      if (ctx && ctx.term && elTerm) elTerm.value = String(ctx.term);
      if (ctx && ctx.period && elPeriod) elPeriod.value = String(ctx.period);
    } catch (_) {}
  }

  function updatePeriodLabel() {
    const t = elTerm.value;
    const p = elPeriod.value;
    const pk = parsePick();
    const col = pk && isPrimaryClass(pk.classLevel) ? 'Head Teacher’s comment' : 'Head Caregiver’s comment';
    elPeriodLabel.textContent =
      periodLabel(p) +
      ' ' +
      'Term ' +
      t +
      ' · Export column: ' +
      col +
      ' — pick a class, then move learner to learner.';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function flashMessage(message, ok) {
    const flash = document.getElementById('flash');
    if (!flash) return;
    flash.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + escapeHtml(message) + '</div>';
    setTimeout(function () {
      flash.innerHTML = '';
    }, 3000);
  }

  function classTeacherCommentsUrl() {
    if (!pick) return null;
    const u = new URL('/api/class-teacher-comments', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    return u;
  }

  async function loadStudents() {
    pick = parsePick();
    if (!pick) {
      students = [];
      idx = 0;
      classTeacherRows = [];
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
    classTeacherRows = [];
    renderCarousel();
    showLearner();
    await loadComments();
  }

  async function loadComments() {
    pick = parsePick();
    if (!pick) {
      commentRows = [];
      classTeacherRows = [];
      fillCommentForCurrent();
      updateSummary();
      updateHeadStatCard();
      return;
    }
    const headUrl = new URL('/api/head-comments', window.location.origin);
    headUrl.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) headUrl.searchParams.set('stream', pick.stream);
    headUrl.searchParams.set('term', elTerm.value);
    headUrl.searchParams.set('period', elPeriod.value);
    const ctUrl = classTeacherCommentsUrl();
    const responses = await Promise.all([fetch(headUrl), fetch(ctUrl)]);
    let raw = [];
    let ctRaw = [];
    try {
      raw = responses[0].ok ? await responses[0].json() : [];
    } catch (_) {
      raw = [];
    }
    try {
      ctRaw = responses[1].ok ? await responses[1].json() : [];
    } catch (_) {
      ctRaw = [];
    }
    commentRows = Array.isArray(raw) ? raw : [];
    classTeacherRows = Array.isArray(ctRaw) ? ctRaw : [];
    fillCommentForCurrent();
    updateSummary();
    updateHeadStatCard();
  }

  function commentForStudent(sid) {
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    const row = commentRows.find(function (r) {
      return r.student_id === sid && Number(r.term) === t && r.period === p;
    });
    return row ? row.body : '';
  }

  function classTeacherRowForStudent(sid) {
    const t = Number(elTerm.value);
    const p = elPeriod.value;
    return (
      classTeacherRows.find(function (r) {
        return r.student_id === sid && Number(r.term) === t && r.period === p;
      }) || null
    );
  }

  function updateClassTeacherContext() {
    if (!elClassTeacherComment) return;
    const s = students[idx];
    const slotLabel = periodLabel(elPeriod.value) + ' · Term ' + elTerm.value;
    if (elClassTeacherMeta) elClassTeacherMeta.textContent = slotLabel;
    if (!pick) {
      elClassTeacherComment.value = '';
      elClassTeacherComment.placeholder = 'Choose a class and learner to see the saved class teacher comment for this reporting slot.';
      elClassTeacherComment.disabled = true;
      if (elClassTeacherSave) elClassTeacherSave.disabled = true;
      if (elClassTeacherReset) elClassTeacherReset.disabled = true;
      if (elClassTeacherChar) elClassTeacherChar.textContent = '0 / ' + CLASS_TEACHER_MAX;
      return;
    }
    if (!s) {
      elClassTeacherComment.value = '';
      elClassTeacherComment.placeholder = 'No learner selected.';
      elClassTeacherComment.disabled = true;
      if (elClassTeacherSave) elClassTeacherSave.disabled = true;
      if (elClassTeacherReset) elClassTeacherReset.disabled = true;
      if (elClassTeacherChar) elClassTeacherChar.textContent = '0 / ' + CLASS_TEACHER_MAX;
      return;
    }
    const row = classTeacherRowForStudent(s.id);
    const body = row && row.body ? String(row.body).trim() : '';
    elClassTeacherComment.value = body;
    elClassTeacherComment.placeholder = 'No class teacher comment saved yet for this reporting slot.';
    elClassTeacherComment.disabled = false;
    if (elClassTeacherSave) elClassTeacherSave.disabled = false;
    if (elClassTeacherReset) elClassTeacherReset.disabled = false;
    if (elClassTeacherChar) elClassTeacherChar.textContent = body.length + ' / ' + CLASS_TEACHER_MAX;
  }

  function classTeacherCommentNeedsSave() {
    const s = students[idx];
    if (!s || !elClassTeacherComment) return false;
    const row = classTeacherRowForStudent(s.id);
    const savedBody = row && row.body ? String(row.body).trim() : '';
    return elClassTeacherComment.value.trim() !== savedBody;
  }

  async function reloadClassTeacherComments() {
    const u = classTeacherCommentsUrl();
    if (!u) {
      classTeacherRows = [];
      updateClassTeacherContext();
      return;
    }
    const res = await fetch(u);
    let raw = [];
    try {
      raw = res.ok ? await res.json() : [];
    } catch (_) {
      raw = [];
    }
    classTeacherRows = Array.isArray(raw) ? raw : [];
    updateClassTeacherContext();
  }

  async function saveClassTeacherComment(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    const s = students[idx];
    if (!s || !pick || !elClassTeacherComment) {
      if (!silent) alert('Choose a class and learner first.');
      return false;
    }
    if (!classTeacherCommentNeedsSave()) {
      if (!silent) flashMessage('Nothing new to save for class teacher comment.', false);
      return true;
    }
    const targetStudentId = s.id;
    let body = elClassTeacherComment.value.trim();
    if (body) {
      if (body.length > CLASS_TEACHER_MAX) body = body.slice(0, CLASS_TEACHER_MAX);
    }
    const res = await fetch('/api/class-teacher-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: targetStudentId,
        term: Number(elTerm.value),
        period: elPeriod.value,
        body: body,
        actor: 'head_teacher',
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      if (!silent) flashMessage(data.error || 'Could not save class teacher comment.', false);
      return false;
    }
    await reloadClassTeacherComments();
    if (!silent) {
      flashMessage(body ? 'Class teacher comment updated.' : 'Class teacher comment cleared.', true);
    }
    if (window.__oceanHead && window.__oceanHead.addNotification) {
      window.__oceanHead.addNotification(
        (body ? 'Updated class teacher comment' : 'Cleared class teacher comment') +
          ' — ' +
          (s.full_name || '') +
          ' · ' +
          labelClass(pick.classLevel, pick.stream)
      );
    }
    return true;
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
    const ph = document.getElementById('hc-profile-photo');
    if (!s) {
      ph.innerHTML = '';
      document.getElementById('hc-d-name').textContent = '—';
      elBody.value = '';
      elChar.textContent = '0 / ' + MAX;
      updateClassTeacherContext();
      return;
    }
    ph.innerHTML = s.passport_path
      ? '<img src="' + escapeHtml(s.passport_path) + '" alt="" />'
      : '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">No photo</div>';
    document.getElementById('hc-d-name').textContent = s.full_name;
    document.getElementById('hc-d-class').textContent = pick ? labelClass(pick.classLevel, pick.stream) : '—';
    document.getElementById('hc-d-reg').textContent = s.reg_no || '—';
    fillCommentForCurrent();
  }

  function fillCommentForCurrent() {
    const s = students[idx];
    if (!s) {
      elBody.value = '';
      elChar.textContent = '0 / ' + MAX;
      return;
    }
    elBody.value = commentForStudent(s.id);
    elChar.textContent = elBody.value.length + ' / ' + MAX;
    elBody.readOnly = false;
    elBody.classList.remove('comments-readonly');
    updateClassTeacherContext();
  }

  function updateSummary() {
    const total = students.length;
    const done = commentRows.filter(function (r) {
      return (
        String(r.term) === String(elTerm.value) &&
        r.period === elPeriod.value &&
        r.body &&
        String(r.body).trim()
      );
    }).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    elSummaryLine.textContent =
      (pick ? labelClass(pick.classLevel, pick.stream) : '—') +
      ': ' +
      done +
      ' / ' +
      total +
      ' with a head comment for ' +
      periodShortLabel(elPeriod.value) +
      ' Term ' +
      elTerm.value;
    elSummaryPct.textContent = pct + '%';
    elSummaryFill.style.width = pct + '%';
  }

  async function updateHeadStatCard() {
    const el = document.getElementById('stat-head-comments-done');
    if (!el || !pick) {
      if (el) el.textContent = '—';
      return;
    }
    const u = new URL('/api/head-comments', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('term', elTerm.value);
    u.searchParams.set('period', elPeriod.value);
    try {
      const res = await fetch(u);
      const rows = res.ok ? await res.json() : [];
      const withBody = rows.filter(function (r) {
        return r.body && String(r.body).trim();
      }).length;
      el.textContent = String(withBody) + ' / ' + String(students.length);
    } catch (_) {
      el.textContent = '—';
    }
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

  async function saveComment(allowEmpty) {
    const s = students[idx];
    if (!s || !pick) {
      alert('Choose a class first.');
      return false;
    }
    const targetStudentId = s.id;
    let body = elBody.value.trim();
    if (!body) {
      if (!allowEmpty) {
        alert('Write a comment before saving, or use Clear comment.');
        return false;
      }
      const had = commentForStudent(targetStudentId);
      if (!had) return true;
    } else {
      if (body.length > MAX) body = body.slice(0, MAX);
    }
    const res = await fetch('/api/head-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: targetStudentId,
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
    flashMessage(body ? 'Head comment saved.' : 'Head comment cleared.', true);
    if (window.__oceanHead && window.__oceanHead.addNotification) {
      window.__oceanHead.addNotification(
        (body ? 'Saved head comment' : 'Cleared head comment') +
          ' — ' +
          (s.full_name || '') +
          ' · ' +
          labelClass(pick.classLevel, pick.stream)
      );
    }
    await loadComments();
    return true;
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
    updatePeriodLabel();
    loadStudents();
  });
  elTerm.addEventListener('change', function () {
    updatePeriodLabel();
    loadComments();
  });
  elPeriod.addEventListener('change', function () {
    updatePeriodLabel();
    loadComments();
  });
  elBody.addEventListener('input', function () {
    elChar.textContent = elBody.value.length + ' / ' + MAX;
  });
  if (elClassTeacherComment) {
    elClassTeacherComment.addEventListener('input', function () {
      if (elClassTeacherChar) {
        elClassTeacherChar.textContent = elClassTeacherComment.value.length + ' / ' + CLASS_TEACHER_MAX;
      }
    });
  }
  if (elClassTeacherSave) {
    elClassTeacherSave.addEventListener('click', function () {
      saveClassTeacherComment();
    });
  }
  if (elClassTeacherReset) {
    elClassTeacherReset.addEventListener('click', function () {
      updateClassTeacherContext();
    });
  }

  document.getElementById('hc-prev').addEventListener('click', function () {
    moveIdx(-1);
  });
  document.getElementById('hc-next').addEventListener('click', function () {
    moveIdx(1);
  });
  document.getElementById('hc-save-only').addEventListener('click', function () {
    saveComment(false);
  });
  document.getElementById('hc-clear').addEventListener('click', async function () {
    const s = students[idx];
    if (!s || !commentForStudent(s.id)) {
      alert('No saved comment to clear for this learner.');
      return;
    }
    if (!confirm('Remove the head comment for this learner and slot?')) return;
    elBody.value = '';
    await saveComment(true);
  });
  document.getElementById('hc-save-next').addEventListener('click', async function () {
    const ok = await saveComment(false);
    if (ok) moveIdx(1);
  });
  document.getElementById('hc-save-prev').addEventListener('click', async function () {
    const ok = await saveComment(false);
    if (ok) moveIdx(-1);
  });

  window.__oceanHeadCommentsInit = async function () {
    await applySharedReportingContext();
    updatePeriodLabel();
    loadStudents();
  };
})();
