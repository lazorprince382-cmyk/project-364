/**
 * Skill dashboard — weekly learner progress (term goal, weekly goals, dynamic ratings).
 */
(function () {
  const panel = document.getElementById('panel-progress');
  if (!panel || !window.__oceanSkill || !window.OCEAN_CLASSES) return;

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

  function buildClassRows() {
    const rows = [];
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

  function labelClass(classLevel, stream) {
    const title = titles[classLevel] || classLevel;
    return stream ? title + ' — ' + (streamLabels[stream] || stream) : title;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function flash(msg, ok) {
    const el = document.getElementById('flash');
    if (!el) return;
    el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + escapeHtml(msg) + '</div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 4000);
  }

  function parsePick(value) {
    const raw = value != null ? value : elClass.value;
    if (!raw) return null;
    const parts = String(raw).split('|');
    return {
      classLevel: String(parts[0] || '').trim(),
      stream: parts[1] != null ? String(parts[1]).trim() : '',
    };
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

  function suggestRatingOptionsFromGoal(goalText) {
    if (window.OceanWeeklyGoalRatings && window.OceanWeeklyGoalRatings.suggestRatingOptionsFromGoal) {
      return window.OceanWeeklyGoalRatings.suggestRatingOptionsFromGoal(goalText);
    }
    return [];
  }

  function weeklyGoalsApiError(res, fallback) {
    if (res && res.status === 404) {
      return 'Goals save is not available yet. Restart or update the server, then try again.';
    }
    return fallback;
  }

  function weeklyBandsUrl(term, week, studentId) {
    const pick = parsePick();
    if (!pick) return '';
    const u = new URL('/api/weekly-bands', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('subject', subjectName);
    u.searchParams.set('term', String(term));
    if (week != null) u.searchParams.set('week', String(week));
    if (studentId != null) u.searchParams.set('student_id', String(studentId));
    return u.toString();
  }

  function weeklyGoalUrl(term, week) {
    const pick = parsePick();
    if (!pick) return '';
    const u = new URL('/api/class-weekly-goal', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('subject', subjectName);
    u.searchParams.set('term', String(term));
    u.searchParams.set('week', String(week));
    return u.toString();
  }

  function weeklyGoalsUrl(term) {
    const pick = parsePick();
    if (!pick) return '';
    const u = new URL('/api/class-weekly-goals', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('subject', subjectName);
    u.searchParams.set('term', String(term));
    return u.toString();
  }

  function termGoalUrl(term) {
    const pick = parsePick();
    if (!pick) return '';
    const u = new URL('/api/class-term-goal', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    u.searchParams.set('subject', subjectName);
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

  function resolveWeeklyRatingOptions(textareaOptions, savedWeekOptions) {
    const typed = parseRatingOptionsText(textareaOptions);
    if (typed.length >= 2) return typed;
    const saved = Array.isArray(savedWeekOptions) ? savedWeekOptions.filter(Boolean) : [];
    if (saved.length >= 2) return saved;
    return typed;
  }

  const CLASS_ROWS = buildClassRows();
  const elClass = document.getElementById('sp-class-pick');
  const elTerm = document.getElementById('spwk-term');
  const elWeek = document.getElementById('spwk-week');
  const elBody = document.getElementById('spwk-body');

  let learnersRows = [];
  let wkGoalsContextKey = '';

  CLASS_ROWS.forEach(function (row) {
    const option = document.createElement('option');
    option.value = row.classLevel + '|' + (row.stream || '');
    option.textContent = row.label;
    elClass.appendChild(option);
  });
  if (!elClass.value && CLASS_ROWS[0]) {
    elClass.value = CLASS_ROWS[0].classLevel + '|' + (CLASS_ROWS[0].stream || '');
  }
  if (elWeek && !elWeek.options.length) {
    for (let w = 1; w <= 11; w++) {
      const o = document.createElement('option');
      o.value = String(w);
      o.textContent = 'Week ' + w;
      elWeek.appendChild(o);
    }
  }

  async function loadStudents() {
    const pick = parsePick();
    if (!pick) {
      learnersRows = [];
      return [];
    }
    const u = new URL('/api/students', window.location.origin);
    u.searchParams.set('classLevel', pick.classLevel);
    if (pick.stream) u.searchParams.set('stream', pick.stream);
    const res = await fetch(u);
    learnersRows = res.ok ? await res.json() : [];
    return learnersRows;
  }

  async function loadWeeklyGoalsEditor(term, week) {
    const pick = parsePick();
    if (!pick) return;
    const contextKey = [pick.classLevel, pick.stream, subjectName, term, week].join('|');
    const contextChanged = wkGoalsContextKey !== contextKey;
    wkGoalsContextKey = contextKey;

    const weekLabel = document.getElementById('spwk-week-label');
    const termGoalEl = document.getElementById('spwk-term-goal');
    const termGoalMeta = document.getElementById('spwk-term-goal-meta');
    const weeklyGoalEl = document.getElementById('spwk-weekly-goal');
    const ratingOptionsEl = document.getElementById('spwk-rating-options');
    const weeklyGoalMeta = document.getElementById('spwk-weekly-goal-meta');
    if (weekLabel) weekLabel.textContent = String(week);

    if (termGoalEl && contextChanged) {
      try {
        const res = await fetch(termGoalUrl(term));
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
        const res = await fetch(weeklyGoalUrl(term, week));
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

  async function renderWeeklyProgressChart(term, week) {
    const pieEl = document.getElementById('spwk-progress-pie');
    const legendEl = document.getElementById('spwk-progress-legend');
    const metaEl = document.getElementById('spwk-progress-meta');
    const pick = parsePick();
    if (!pieEl || !legendEl || !pick) return;
    if (metaEl) {
      metaEl.textContent =
        labelClass(pick.classLevel, pick.stream) + ' · ' + subjectName + ' · Week ' + week + ' · Term ' + term;
    }
    if (!learnersRows.length) {
      pieEl.style.background = 'rgba(100, 116, 139, 0.35)';
      legendEl.innerHTML = '';
      return;
    }
    const total = learnersRows.length;
    const res = await fetch(weeklyBandsUrl(term, week));
    const goalRes = await fetch(weeklyGoalUrl(term, week));
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
            const lbl = opt.label.length > 28 ? opt.label.slice(0, 26) + '…' : opt.label;
            return (
              '<div class="class-progress-legend-item"><span><span class="class-progress-dot" style="background:' +
              color +
              '"></span>' +
              escapeHtml(lbl) +
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

    const c = { strong: counts.strong || 0, average: counts.average || 0, weak: counts.weak || 0 };
    const d1 = total ? (c.strong / total) * 360 : 0;
    const d2 = d1 + (total ? (c.average / total) * 360 : 0);
    const d3 = d2 + (total ? (c.weak / total) * 360 : 0);
    pieEl.style.background =
      'conic-gradient(rgba(20,184,166,0.88) 0deg ' +
      d1 +
      'deg,rgba(234,179,8,0.88) ' +
      d1 +
      'deg ' +
      d2 +
      'deg,rgba(239,68,68,0.88) ' +
      d2 +
      'deg ' +
      d3 +
      'deg,rgba(100,116,139,0.5) ' +
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

  async function renderWeeklyLearnerTable(term, week) {
    if (!elBody) return;
    const pick = parsePick();
    if (!pick) {
      elBody.innerHTML = '<tr><td colspan="4">Choose a class first.</td></tr>';
      return;
    }
    if (!learnersRows.length) {
      elBody.innerHTML = '<tr><td colspan="4">No learners in this class yet.</td></tr>';
      return;
    }

    const weekRes = await fetch(weeklyBandsUrl(term, week));
    const allRes = await fetch(weeklyBandsUrl(term));
    const goalsRes = await fetch(weeklyGoalsUrl(term));
    const weekRows = weekRes.ok ? await weekRes.json().catch(function () { return []; }) : [];
    const allRows = allRes.ok ? await allRes.json().catch(function () { return []; }) : [];
    const goalsRows = goalsRes.ok ? await goalsRes.json().catch(function () { return []; }) : [];
    const ratingOptionsEl = document.getElementById('spwk-rating-options');
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

    elBody.innerHTML = '';
    const ratingPack = getEffectiveRatingOptions(currentOptions);
    const ratingHint = document.getElementById('spwk-rating-hint');
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
      elBody.appendChild(tr);
    });

    elBody.querySelectorAll('select[data-sid]').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        const payload = {
          student_id: Number(sel.getAttribute('data-sid')),
          subject: subjectName,
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
        renderWeeklyProgressChart(term, week);
        renderWeeklyLearnerTable(term, week);
        window.dispatchEvent(
          new CustomEvent('ocean-weekly-bands-updated', {
            detail: { student_id: payload.student_id, subject: subjectName, term: term },
          })
        );
      });
    });
  }

  async function loadWeeklyPanel() {
    if (!elTerm || !elWeek || !elBody) return;
    if (!parsePick()) {
      elBody.innerHTML = '<tr><td colspan="4">Choose a class first.</td></tr>';
      return;
    }
    const term = Number(elTerm.value || 1);
    const week = Number(elWeek.value || 1);
    await loadStudents();
    await loadWeeklyGoalsEditor(term, week);
    await renderWeeklyLearnerTable(term, week);
    await renderWeeklyProgressChart(term, week);
  }

  if (elClass) elClass.addEventListener('change', function () { wkGoalsContextKey = ''; loadWeeklyPanel(); });
  if (elTerm) elTerm.addEventListener('change', loadWeeklyPanel);
  if (elWeek) elWeek.addEventListener('change', loadWeeklyPanel);

  const termGoalSave = document.getElementById('spwk-term-goal-save');
  if (termGoalSave) {
    termGoalSave.addEventListener('click', async function () {
      const pick = parsePick();
      const goalEl = document.getElementById('spwk-term-goal');
      const metaEl = document.getElementById('spwk-term-goal-meta');
      if (!pick) return;
      const term = Number(elTerm.value || 1);
      if (metaEl) metaEl.textContent = 'Saving…';
      try {
        const res = await fetch('/api/class-term-goal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classLevel: pick.classLevel,
            stream: pick.stream || '',
            subject: subjectName,
            term: term,
            goal_text: goalEl ? goalEl.value : '',
          }),
        });
        const raw = await res.text();
        let data = {};
        try { data = JSON.parse(raw); } catch (_) {}
        if (!res.ok) throw new Error(weeklyGoalsApiError(res, data.error || 'Could not save term goal'));
        if (metaEl) metaEl.textContent = 'Saved ' + new Date(data.updated_at || Date.now()).toLocaleString();
        flash('Term goal saved.', true);
      } catch (err) {
        if (metaEl) metaEl.textContent = err.message || 'Could not save term goal.';
        flash(err.message || 'Could not save term goal.', false);
      }
    });
  }

  const suggestBtn = document.getElementById('spwk-suggest-ratings');
  if (suggestBtn) {
    suggestBtn.addEventListener('click', function () {
      const weeklyGoalEl = document.getElementById('spwk-weekly-goal');
      const ratingOptionsEl = document.getElementById('spwk-rating-options');
      const suggestions = suggestRatingOptionsFromGoal(weeklyGoalEl ? weeklyGoalEl.value : '');
      if (!suggestions.length) {
        flash('Type a weekly goal first.', false);
        return;
      }
      if (ratingOptionsEl) ratingOptionsEl.value = suggestions.join('\n');
      renderWeeklyLearnerTable(Number(elTerm.value || 1), Number(elWeek.value || 1));
    });
  }

  const weeklyGoalSave = document.getElementById('spwk-weekly-goal-save');
  if (weeklyGoalSave) {
    weeklyGoalSave.addEventListener('click', async function () {
      const pick = parsePick();
      const weeklyGoalEl = document.getElementById('spwk-weekly-goal');
      const ratingOptionsEl = document.getElementById('spwk-rating-options');
      const metaEl = document.getElementById('spwk-weekly-goal-meta');
      if (!pick) return;
      const term = Number(elTerm.value || 1);
      const week = Number(elWeek.value || 1);
      const ratingOptions = parseRatingOptionsText(ratingOptionsEl ? ratingOptionsEl.value : '');
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
            classLevel: pick.classLevel,
            stream: pick.stream || '',
            subject: subjectName,
            term: term,
            week: week,
            goal_text: weeklyGoalEl ? weeklyGoalEl.value : '',
            rating_options: ratingOptions,
          }),
        });
        const raw = await res.text();
        let data = {};
        try { data = JSON.parse(raw); } catch (_) {}
        if (!res.ok) throw new Error(weeklyGoalsApiError(res, data.error || 'Could not save week goal'));
        if (metaEl) metaEl.textContent = 'Saved ' + new Date(data.updated_at || Date.now()).toLocaleString();
        flash('Week goal saved.', true);
        wkGoalsContextKey = '';
        loadWeeklyPanel();
      } catch (err) {
        if (metaEl) metaEl.textContent = err.message || 'Could not save week goal.';
        flash(err.message || 'Could not save week goal.', false);
      }
    });
  }

  const ratingOptionsEl = document.getElementById('spwk-rating-options');
  if (ratingOptionsEl) {
    let timer = null;
    ratingOptionsEl.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        renderWeeklyLearnerTable(Number(elTerm.value || 1), Number(elWeek.value || 1));
      }, 250);
    });
  }

  window.__oceanSkillProgressInit = function () {
    loadWeeklyPanel();
  };
})();
