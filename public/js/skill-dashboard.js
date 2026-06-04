(function () {
  const SKILL_MAP = {
    computer: { subject: 'Computer', label: 'Computer' },
    salon: { subject: 'Salon', label: 'Salon' },
    bakery: { subject: 'Bakery', label: 'Bakery' },
    fashion: { subject: 'Fashion and Design', label: 'Fashion and Design' },
    music: { subject: 'Music', label: 'Music' },
  };

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

  const params = new URLSearchParams(window.location.search);
  const skillKey = (params.get('skill') || '').toLowerCase();
  const meta = SKILL_MAP[skillKey];

  if (!meta || !window.OCEAN_CLASSES) {
    window.location.href = '/classes.html';
    return;
  }

  const auth = window.OceanStaffAuth;
  if (auth) {
    if (
      !auth.validateSessionFreshness({
        loginViaClasses: true,
        classesKind: 'skill',
        loginPath: '/login-skill.html',
      })
    ) {
      return;
    }
    const TOKEN_KEY = auth.TOKEN_KEY;
    const staff = auth.getStoredStaff();
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token || !staff) {
      const next = window.location.pathname + window.location.search;
      window.location.href =
        '/classes.html?signin=skill&next=' + encodeURIComponent(next);
      return;
    }
    if (['skill_teacher', 'head_teacher', 'director', 'system_admin'].indexOf(staff.role) < 0) {
      window.location.href =
        '/classes.html?signin=skill&next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    if (!auth.assertSkillScope(staff, skillKey)) return;
    if (
      (staff.role === 'director' || staff.role === 'head_teacher') &&
      staff.role !== 'system_admin' &&
      staff.role !== 'ghost'
    ) {
      if (!auth.consumeClassWorkspaceEntry()) {
        const next = window.location.pathname + window.location.search;
        window.location.href = auth.classWorkspaceSignInHref(next, 'skill');
        return;
      }
      document.querySelectorAll('[data-tab="skill-messages"]').forEach(function (el) {
        el.style.display = 'none';
      });
      const msgPanel = document.getElementById('panel-skill-messages');
      if (msgPanel) msgPanel.remove();
    }
    auth.startIdleWatch({
      loginViaClasses: true,
      classesKind: 'skill',
      loginPath: '/login-skill.html',
    });
    const barName = document.getElementById('profile-bar-name');
    if (barName && staff.display_name) barName.textContent = staff.display_name;
  }

  const subjectName = meta.subject;

  function isPrimaryLike(cl) {
    return String(cl || '').toLowerCase().indexOf('primary') === 0;
  }

  function classCatalogForReports() {
    return (window.OCEAN_CLASSES || []).filter(function (c) {
      return c && c.id && c.id !== 'skills' && !c.needsSkillPick;
    });
  }

  function buildDashboardCtx(classLevel, stream) {
    const cl = auth && auth.normalizeClassLevelSlug ? auth.normalizeClassLevelSlug(classLevel) : classLevel;
    const st = String(stream || '').trim().toLowerCase();
    const displayTitle = titles[cl] || cl;
    const streamPart = st ? ' · ' + (streamLabels[st] || st) : '';
    return {
      classLevel: cl,
      stream: st,
      displayTitle: displayTitle,
      streamPart: streamPart,
      streamLabels: streamLabels,
      titles: titles,
      isPrimary: isPrimaryLike(cl),
      subjects: (window.OCEAN_SUBJECTS && window.OCEAN_SUBJECTS[cl]) || [],
      skillOnlySubjects: window.OCEAN_SKILL_SUBJECTS || [],
      flash: flash,
    };
  }

  const reportCatalog = classCatalogForReports();
  const defaultClass = reportCatalog[0] || { id: 'baby', streams: [{ id: 'waves' }] };
  const defaultStream =
    defaultClass.needsStream && defaultClass.streams && defaultClass.streams.length
      ? defaultClass.streams[0].id
      : '';

  function findReportClassConfig(classId) {
    return reportCatalog.find(function (c) {
      return c.id === classId;
    });
  }

  function syncSkillReportClassContext() {
    const classEl = document.getElementById('sk-rp-class');
    const streamWrap = document.getElementById('sk-rp-stream-wrap');
    const streamEl = document.getElementById('sk-rp-stream');
    if (!classEl || !window.__oceanDashboard) return;
    const cfg = findReportClassConfig(classEl.value) || defaultClass;
    const needsStream = !!cfg.needsStream;
    if (streamWrap) streamWrap.style.display = needsStream ? '' : 'none';
    if (streamEl && needsStream) {
      const prev = streamEl.value;
      streamEl.innerHTML = '';
      (cfg.streams || []).forEach(function (s) {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.label || s.id;
        streamEl.appendChild(o);
      });
      if (prev && streamEl.querySelector('option[value="' + prev + '"]')) streamEl.value = prev;
      else if (cfg.streams && cfg.streams[0]) streamEl.value = cfg.streams[0].id;
    }
    const streamVal = needsStream && streamEl ? streamEl.value : '';
    const next = buildDashboardCtx(cfg.id, streamVal);
    if (!window.__oceanDashboard) window.__oceanDashboard = next;
    else Object.assign(window.__oceanDashboard, next);
    window.__oceanDashboard.flash = flash;
    if (typeof switchToTab === 'function') window.__oceanDashboard.switchToTab = switchToTab;
  }

  function refreshSkillReportPreview() {
    syncSkillReportClassContext();
    const btn = document.getElementById('rp-refresh');
    if (btn) btn.click();
  }

  function initSkillReportClassPickers() {
    const classEl = document.getElementById('sk-rp-class');
    if (!classEl || classEl.dataset.bound) return;
    classEl.dataset.bound = '1';
    classEl.innerHTML = '';
    reportCatalog.forEach(function (c) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.title || c.id;
      classEl.appendChild(o);
    });
    classEl.value = defaultClass.id;
    syncSkillReportClassContext();
    classEl.addEventListener('change', refreshSkillReportPreview);
    const streamEl = document.getElementById('sk-rp-stream');
    if (streamEl) streamEl.addEventListener('change', refreshSkillReportPreview);
  }

  window.__oceanSkill = { subjectName: subjectName, label: meta.label };

  document.getElementById('skill-dash-title').textContent = meta.label + ' — skill teacher';
  document.getElementById('skill-dash-sub').textContent =
    'Notes · Learner comments · Report templates · All children · Weekly progress · Settings';
  document.getElementById('skill-name-repeat').textContent = meta.label;
  document.getElementById('skill-name-progress').textContent = meta.label;
  const scLab = document.getElementById('sc-subject-label');
  if (scLab) scLab.textContent = meta.label;
  const topbar = document.getElementById('skill-topbar-title');
  if (topbar) topbar.textContent = meta.label + ' — skill';

  if (window.OceanWelcomeBanner) {
    window.OceanWelcomeBanner.updateContext(meta.label);
  }

  const notifKey = 'ocean_skill_notify_' + skillKey;
  const activityKey = 'ocean_skill_activity_' + skillKey;

  function flash(msg, ok) {
    const el = document.getElementById('flash');
    el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + msg + '</div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 5000);
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function pushActivity(message) {
    let list = [];
    try {
      list = JSON.parse(sessionStorage.getItem(activityKey) || '[]');
    } catch (_) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    list.unshift({ t: Date.now(), m: message });
    sessionStorage.setItem(activityKey, JSON.stringify(list.slice(0, 20)));
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

  function formatDocDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return '—';
    }
  }

  function labelClass(cl, st) {
    const t = titles[cl] || cl;
    if (st) return t + ' — ' + (streamLabels[st] || st);
    return t;
  }

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

  const CLASS_ROWS = buildClassRows();

  const elClassesStat = document.getElementById('stat-skill-classes');
  if (elClassesStat) elClassesStat.textContent = String(CLASS_ROWS.length);

  let cachedSkillDocs = [];

  async function loadSkillDocsData() {
    try {
      const u = new URL('/api/skill-documents', window.location.origin);
      u.searchParams.set('subject', subjectName);
      const res = await fetch(u);
      if (!res.ok) throw new Error();
      cachedSkillDocs = await res.json();
    } catch (_) {
      cachedSkillDocs = [];
    }
    const elU = document.getElementById('stat-skill-uploads');
    if (elU) {
      elU.textContent = String(
        cachedSkillDocs.filter(function (d) {
          return d.doc_type !== 'note';
        }).length
      );
    }
    updateSkillSidebarFromRaw(cachedSkillDocs);
    return cachedSkillDocs;
  }

  function updateSkillSidebarFromRaw(rawRows) {
    const totalEl = document.getElementById('skill-sum-total');
    const termEl = document.getElementById('skill-sum-term');
    const lastEl = document.getElementById('skill-sum-last');
    const recentUl = document.getElementById('skill-recent-list');
    const uploadRows = rawRows.filter(function (d) {
      return d.doc_type !== 'note';
    });
    const n = uploadRows.length;
    if (totalEl) totalEl.textContent = String(n);
    const ft = document.getElementById('filter-term') ? document.getElementById('filter-term').value : '';
    if (termEl) {
      if (!ft) termEl.textContent = String(n);
      else {
        const c = uploadRows.filter(function (d) {
          return String(d.term) === String(ft);
        }).length;
        termEl.textContent = String(c);
      }
    }
    const sorted = uploadRows
      .slice()
      .sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    if (lastEl) {
      lastEl.textContent = sorted.length ? formatDocDate(sorted[0].created_at) : '—';
    }
    if (recentUl) {
      recentUl.innerHTML = '';
      sorted.slice(0, 5).forEach(function (d) {
        const li = document.createElement('li');
        const title = escapeHtml(d.title || 'Untitled');
        const cls = labelClass(d.class_level, d.stream || '');
        const meta =
          escapeHtml(cls) +
          ' · Term ' +
          d.term +
          ' · ' +
          formatDocDate(d.created_at);
        li.innerHTML = '<span class="skill-recent-title">' + title + '</span><span class="skill-recent-meta">' + meta + '</span>';
        recentUl.appendChild(li);
      });
      if (!sorted.length) {
        const li = document.createElement('li');
        li.style.border = 'none';
        li.style.color = 'var(--muted)';
        li.textContent = 'No uploads yet for this subject.';
        recentUl.appendChild(li);
      }
    }
  }

  async function refreshSkillStats() {
    const elL = document.getElementById('stat-skill-learners');
    try {
      const res = await fetch('/api/students/count-summary');
      if (res.ok) {
        const rows = await res.json();
        let sum = 0;
        rows.forEach(function (r) {
          sum += r.count;
        });
        if (elL) elL.textContent = String(sum);
      } else if (elL) elL.textContent = '—';
    } catch (_) {
      if (elL) elL.textContent = '—';
    }
  }

  const noteClassPick = document.getElementById('note-class-pick');
  const childrenClassPick = document.getElementById('children-class-pick');
  CLASS_ROWS.forEach(function (r) {
    const o1 = document.createElement('option');
    o1.value = r.classLevel + '|' + (r.stream || '');
    o1.textContent = r.label;
    noteClassPick.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = r.classLevel + '|' + (r.stream || '');
    o2.textContent = r.label;
    childrenClassPick.appendChild(o2);
  });

  function parsePick(val) {
    if (!val || val === '__view_all__' || val === '__all__') return null;
    const parts = val.split('|');
    return { classLevel: parts[0], stream: parts[1] != null ? parts[1] : '' };
  }

  function updateUploadUi() {
    const v = noteClassPick.value;
    const uploadEl = document.getElementById('upload-actions');
    const hint = document.getElementById('upload-hint');
    if (v === '__view_all__') {
      uploadEl.style.display = 'none';
      hint.style.display = 'block';
      hint.textContent = 'Viewing every upload for this subject. Pick a specific class above to add files.';
    } else if (!v) {
      uploadEl.style.display = 'none';
      hint.style.display = 'block';
      hint.textContent = 'Select a class to enable uploads.';
    } else {
      uploadEl.style.display = 'block';
      hint.style.display = 'none';
    }
  }

  noteClassPick.addEventListener('change', function () {
    updateUploadUi();
    loadDocuments();
  });

  function docMatchesPick(d, pick) {
    if (!pick) return false;
    if (d.document_scope === 'all_classes') return false;
    const st = d.stream || '';
    const pk = pick.stream || '';
    return d.class_level === pick.classLevel && st === pk;
  }

  function appendSkillDocListItem(list, d, opts) {
    opts = opts || {};
    const li = document.createElement('li');
    const classTag = labelClass(d.class_level, d.stream || '');
    const scopeBadge =
      opts.showScopeBadge && d.document_scope === 'all_classes'
        ? '<span class="badge" title="School-wide">School-wide</span> '
        : '';
    const left = document.createElement('span');
    left.innerHTML =
      scopeBadge +
      (opts.showClassTag !== false
        ? '<span class="badge">' + escapeHtml(classTag) + '</span> '
        : '') +
      '<span class="badge">Term ' +
      d.term +
      '</span> ' +
      (opts.showType
        ? escapeHtml(d.doc_type === 'scheme' ? 'Scheme' : d.doc_type === 'work' ? 'Work' : d.doc_type) + ' · '
        : '') +
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
      if (!confirm('Remove this file?')) return;
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

  function renderSkillDocList(listEl, rows, emptyMsg, opts) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.innerHTML = '<li style="color: var(--muted)">' + emptyMsg + '</li>';
      return;
    }
    rows.forEach(function (d) {
      appendSkillDocListItem(listEl, d, opts);
    });
  }

  async function loadDocuments() {
    const list = document.getElementById('doc-list');
    const typedList = document.getElementById('typed-notes-list');
    if (list) list.innerHTML = '';
    if (typedList) typedList.innerHTML = '';
    const pick = parsePick(noteClassPick.value);
    await loadSkillDocsData();
    let rows = cachedSkillDocs.slice();
    const ft = document.getElementById('filter-term').value;
    const typedFtEl = document.getElementById('typed-notes-filter');
    const typedFt = typedFtEl ? typedFtEl.value : '';
    if (ft) {
      rows = rows.filter(function (d) {
        return String(d.term) === String(ft);
      });
    }
    let typedRows = cachedSkillDocs.slice();
    if (typedFt) {
      typedRows = typedRows.filter(function (d) {
        return String(d.term) === String(typedFt);
      });
    }
    if (noteClassPick.value === '__view_all__') {
      /* show per-class + any legacy school-wide rows */
    } else if (noteClassPick.value) {
      rows = rows.filter(function (d) {
        return docMatchesPick(d, pick);
      });
      typedRows = typedRows.filter(function (d) {
        return docMatchesPick(d, pick);
      });
    } else {
      rows = [];
      typedRows = [];
    }

    const classDocs = rows.filter(function (d) {
      return d.doc_type !== 'note';
    });
    const typedNotes = typedRows.filter(function (d) {
      return d.doc_type === 'note';
    });

    renderSkillDocList(
      list,
      classDocs,
      'No schemes or work yet for this filter. Pick a class (or “View all”) and add uploads.',
      { showScopeBadge: true, showType: true }
    );
    renderSkillDocList(
      typedList,
      typedNotes,
      noteClassPick.value ? 'No typed notes saved yet for this class.' : 'Select a class to see typed notes.',
      { showScopeBadge: false, showType: false, showClassTag: noteClassPick.value === '__view_all__' }
    );
  }

  function getUploadTarget() {
    const pick = parsePick(noteClassPick.value);
    if (!pick) {
      flash('Select a class before uploading.', false);
      return null;
    }
    return pick;
  }

  document.getElementById('btn-scheme').addEventListener('click', async function () {
    const target = getUploadTarget();
    if (!target) return;
    const file = document.getElementById('scheme-file').files[0];
    if (!file) {
      flash('Choose a file first.', false);
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_scope', 'class');
    fd.append('class_level', target.classLevel);
    fd.append('stream', target.stream || '');
    fd.append('subject', subjectName);
    fd.append('term', document.getElementById('note-term').value);
    fd.append('title', document.getElementById('scheme-title').value || file.name);
    try {
      const res = await fetch('/api/documents/scheme', { method: 'POST', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      flash('Scheme saved for ' + labelClass(target.classLevel, target.stream) + '.', true);
      pushActivity('Uploaded scheme for ' + labelClass(target.classLevel, target.stream) + '.');
      addNotification('Scheme uploaded for ' + meta.label + '.');
      document.getElementById('scheme-file').value = '';
      loadDocuments();
    } catch (err) {
      flash(err.message || 'Upload failed', false);
    }
  });

  document.getElementById('btn-work-photo').addEventListener('click', async function () {
    const target = getUploadTarget();
    if (!target) return;
    const file = document.getElementById('work-photo').files[0];
    if (!file) {
      flash('Choose a photo (JPEG or PNG).', false);
      return;
    }
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('document_scope', 'class');
    fd.append('class_level', target.classLevel);
    fd.append('stream', target.stream || '');
    fd.append('subject', subjectName);
    fd.append('term', document.getElementById('note-term').value);
    fd.append('title', document.getElementById('scheme-title').value || 'Work from photo');
    try {
      const res = await fetch('/api/documents/work-from-photo', { method: 'POST', body: fd });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      flash('PDF saved for ' + labelClass(target.classLevel, target.stream) + '.', true);
      pushActivity('Created work PDF for ' + labelClass(target.classLevel, target.stream) + '.');
      addNotification('Work PDF added for ' + meta.label + '.');
      document.getElementById('work-photo').value = '';
      loadDocuments();
    } catch (err) {
      flash(err.message || 'Could not create PDF', false);
    }
  });

  document.getElementById('filter-term').addEventListener('change', loadDocuments);
  const typedNotesFilter = document.getElementById('typed-notes-filter');
  if (typedNotesFilter) typedNotesFilter.addEventListener('change', loadDocuments);

  async function loadChildrenOverview() {
    const tbody = document.getElementById('children-body');
    const countEl = document.getElementById('children-count');
    tbody.innerHTML = '';
    const v = childrenClassPick.value;
    if (v === '__all__') {
      countEl.textContent = '';
      try {
        const res = await fetch('/api/students/count-summary');
        if (!res.ok) throw new Error();
        const rows = await res.json();
        let total = 0;
        rows.forEach(function (r) {
          total += r.count;
        });
        countEl.textContent = 'Total learners (all classes): ' + total;
        rows.forEach(function (r) {
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>—</td><td>—</td><td>—</td><td>' +
            escapeHtml(labelClass(r.class_level, r.stream)) +
            ' · <strong>' +
            r.count +
            '</strong></td>';
          tbody.appendChild(tr);
        });
      } catch {
        countEl.textContent = 'Could not load counts.';
      }
      return;
    }
    const pick = parsePick(v);
    if (!pick) return;
    countEl.textContent = 'Loading…';
    try {
      const u = new URL('/api/students', window.location.origin);
      u.searchParams.set('classLevel', pick.classLevel);
      if (pick.stream) u.searchParams.set('stream', pick.stream);
      const res = await fetch(u);
      if (!res.ok) throw new Error();
      const rows = await res.json();
      countEl.textContent =
        labelClass(pick.classLevel, pick.stream) + ': ' + rows.length + ' learner(s)';
      if (!rows.length) {
        tbody.innerHTML =
          '<tr><td colspan="4" style="color: var(--muted)">No learners registered in this class yet.</td></tr>';
        return;
      }
      rows.forEach(function (r) {
        const tr = document.createElement('tr');
        const img = r.passport_path
          ? '<img class="thumb" src="' + r.passport_path + '" alt="" />'
          : '<span class="badge">—</span>';
        tr.innerHTML =
          '<td>' +
          img +
          '</td><td>' +
          escapeHtml(r.full_name) +
          '</td><td>' +
          escapeHtml(r.reg_no) +
          '</td><td>' +
          escapeHtml(labelClass(pick.classLevel, pick.stream)) +
          '</td>';
        tbody.appendChild(tr);
      });
    } catch {
      countEl.textContent = 'Could not load learners.';
    }
  }

  childrenClassPick.addEventListener('change', loadChildrenOverview);

  async function loadProgressGrid() {
    if (window.__oceanSkillProgressInit) {
      return window.__oceanSkillProgressInit();
    }
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

  async function loadSkillWorkspaceNotes() {
    const ed = document.getElementById('skill-notes-editor');
    const status = document.getElementById('skill-notes-status');
    if (!ed) return;
    ed.innerHTML = '<p></p>';
    if (status) status.textContent = 'Notes ready.';
  }

  async function saveSkillWorkspaceNotes() {
    const ed = document.getElementById('skill-notes-editor');
    const status = document.getElementById('skill-notes-status');
    if (!ed) return;
    const html = ed.innerHTML || '';
    if (!noteEditorHasContent(html)) {
      flash('Type something before saving.', false);
      return;
    }
    const target = getUploadTarget();
    if (!target) return;
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
          document_scope: 'class',
          class_level: target.classLevel,
          stream: target.stream || '',
          subject: subjectName,
          term: document.getElementById('note-term').value,
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

  const TOKEN_KEY = 'ocean_staff_token';

  function switchToTab(name) {
    if (window.__oceanLeaderMessagesPause) window.__oceanLeaderMessagesPause();
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.add('active');
    if (name === 'children') loadChildrenOverview();
    if (name === 'notes') loadSkillWorkspaceNotes();
    if (name === 'progress') loadProgressGrid();
    if (name === 'skill-comments' && window.__oceanSkillCommentsInit) {
      window.__oceanSkillCommentsInit();
    }
    if (name === 'skill-reports') {
      syncSkillReportClassContext();
      if (window.__oceanReportsInit) window.__oceanReportsInit();
    }
    if (name === 'skill-messages' && window.__oceanLeaderMessagesInit) {
      window.__oceanLeaderMessagesInit();
    }
    if (name === 'settings' && window.OceanSettings) {
      window.OceanSettings.syncProfileBar();
      window.OceanSettings.applyTipsVisibility();
    }
  }

  window.__oceanSkill.switchToTab = switchToTab;
  window.__oceanSkill.addNotification = addNotification;

  window.__oceanDashboard = buildDashboardCtx(defaultClass.id, defaultStream);
  window.__oceanDashboard.switchToTab = switchToTab;
  window.__oceanDashboard.flash = flash;

  document.querySelectorAll('.tab').forEach(function (tab) {
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

  function qa(id, tab) {
    const b = document.getElementById(id);
    if (b)
      b.addEventListener('click', function () {
        switchToTab(tab);
      });
  }
  qa('qa-skill-notes', 'notes');
  qa('qa-skill-children', 'children');
  qa('qa-skill-progress', 'progress');
  qa('qa-skill-comments', 'skill-comments');
  qa('qa-skill-messages', 'skill-messages');
  qa('qa-skill-settings', 'settings');
  const recentBtn = document.getElementById('skill-recent-view-tab');
  if (recentBtn) recentBtn.addEventListener('click', function () {
    switchToTab('notes');
  });

  updateUploadUi();
  bindNotesToolbar('skill-notes-toolbar', 'skill-notes-editor');
  const skillNotesSaveBtn = document.getElementById('skill-notes-save');
  if (skillNotesSaveBtn) skillNotesSaveBtn.addEventListener('click', saveSkillWorkspaceNotes);
  updateNotifUi();
  refreshSkillStats().then(function () {
    return loadDocuments();
  });
  loadSkillWorkspaceNotes();
  initSkillReportClassPickers();

  setTimeout(function () {
    const staffDm = auth && auth.getStoredStaff ? auth.getStoredStaff() : null;
    if (
      (!staffDm || (staffDm.role !== 'director' && staffDm.role !== 'head_teacher')) &&
      window.__oceanLeaderMessagesStartUnreadWatch
    ) {
      window.__oceanLeaderMessagesStartUnreadWatch();
    }
  }, 1200);
})();
