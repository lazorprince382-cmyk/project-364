(function () {
  const params = new URLSearchParams(window.location.search);
  const classLevel = params.get('class');
  const stream = params.get('stream') || '';
  const subjectName = params.get('subject');

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
  function isPrimaryLike(cl) {
    return String(cl || '').toLowerCase().indexOf('primary') === 0;
  }

  if (!classLevel || (!titles[classLevel] && !isPrimaryLike(classLevel)) || !subjectName) {
    window.location.href = '/classes.html';
    return;
  }

  const needsStream = classLevel === 'baby' || classLevel === 'middle';
  if (needsStream && !stream) {
    window.location.href = '/classes.html';
    return;
  }

  const displayClass = titles[classLevel] || classLevel.replace(/^primary/i, 'Primary ');
  const streamPart = stream ? ' · ' + (streamLabels[stream] || stream) : '';

  const back = document.getElementById('back-dash');
  const backUrl = new URL('/dashboard.html', window.location.origin);
  backUrl.searchParams.set('class', classLevel);
  if (stream) backUrl.searchParams.set('stream', stream);
  back.href = backUrl.toString();

  document.getElementById('subj-title').textContent = subjectName;
  document.getElementById('subj-meta').textContent = displayClass + streamPart + ' · Work and learner standing';

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

  function absUrl(filePath) {
    return new URL(filePath, window.location.origin).href;
  }

  function fileExt(filePath) {
    const m = /\.([^.]+)$/.exec(filePath || '');
    return m ? m[1].toLowerCase() : '';
  }

  function downloadFilename(doc) {
    const extMatch = (doc.file_path || '').match(/(\.[^./]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    const raw = (doc.title || 'document').replace(/[<>:"/\\|?*]+/g, '').trim().slice(0, 120);
    return (raw || 'document') + ext;
  }

  let lastDocRows = [];
  let selectedDoc = null;
  let onlyOfficeEditor = null;

  const previewWrap = document.getElementById('subject-doc-preview-wrap');
  const previewBody = document.getElementById('subject-doc-preview-body');
  const previewHeading = document.getElementById('subject-doc-preview-heading');
  const previewMeta = document.getElementById('subject-doc-preview-meta');
  const previewExpand = document.getElementById('subject-doc-preview-expand');
  const previewClose = document.getElementById('subject-doc-preview-close');
  const titleInput = document.getElementById('subject-doc-title-input');
  const saveTitleBtn = document.getElementById('subject-doc-save-title');
  const replaceFileInput = document.getElementById('subject-doc-replace-file');
  const replaceTrigger = document.getElementById('subject-doc-replace-trigger');
  const replaceStatus = document.getElementById('subject-doc-replace-status');

  function destroyOnlyOfficeEditor() {
    if (onlyOfficeEditor && typeof onlyOfficeEditor.destroyEditor === 'function') {
      try {
        onlyOfficeEditor.destroyEditor();
      } catch (_) {}
    }
    onlyOfficeEditor = null;
  }

  function loadOnlyOfficeScript(serverUrl) {
    const base = String(serverUrl || '').replace(/\/$/, '');
    if (!base) return Promise.reject(new Error('missing OnlyOffice URL'));
    if (typeof DocsAPI !== 'undefined') {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.async = true;
      s.src = base + '/web-apps/apps/api/documents/api.js';
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('OnlyOffice script failed to load'));
      };
      document.head.appendChild(s);
    });
  }

  function hidePreview() {
    destroyOnlyOfficeEditor();
    selectedDoc = null;
    if (previewWrap) {
      previewWrap.setAttribute('hidden', '');
      previewWrap.classList.remove('subject-doc-preview-expanded');
    }
    if (previewExpand) {
      previewExpand.textContent = 'Expand';
      previewExpand.setAttribute('aria-expanded', 'false');
    }
    if (previewBody) {
      previewBody.innerHTML = '';
    }
    if (replaceStatus) replaceStatus.textContent = '';
    if (replaceFileInput) replaceFileInput.value = '';
  }

  async function renderPreviewContent(doc) {
    if (!previewBody) return;
    previewBody.innerHTML = '<p class="preview-fallback">Loading preview…</p>';
    const url = absUrl(doc.file_path);
    const ext = fileExt(doc.file_path);

    if (ext === 'pdf') {
      const iframe = document.createElement('iframe');
      iframe.title = 'Document preview';
      iframe.src = url;
      previewBody.innerHTML = '';
      previewBody.appendChild(iframe);
      return;
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].indexOf(ext) !== -1) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = doc.title || 'Uploaded image';
      previewBody.innerHTML = '';
      previewBody.appendChild(img);
      return;
    }

    const wordish = ['doc', 'docx', 'docm', 'dotx', 'rtf', 'odt'].indexOf(ext) !== -1;
    if (wordish) {
      try {
        const cfgRes = await fetch('/api/documents/' + doc.id + '/onlyoffice-config');
        const oc = await cfgRes.json();
        if (oc.enabled && oc.documentServerUrl && oc.config && oc.config.document) {
          await loadOnlyOfficeScript(oc.documentServerUrl);
          if (typeof DocsAPI !== 'undefined') {
            destroyOnlyOfficeEditor();
            previewBody.innerHTML = '';
            const mount = document.createElement('div');
            mount.id = 'onlyoffice-editor-mount';
            mount.className = 'onlyoffice-mount';
            previewBody.appendChild(mount);
            onlyOfficeEditor = new DocsAPI.DocEditor('onlyoffice-editor-mount', oc.config);
            return;
          }
        }
      } catch (err) {
        console.warn('OnlyOffice unavailable:', err);
      }

      if (ext !== 'docx') {
        previewBody.innerHTML =
          '<p class="preview-fallback">For <strong>Word-accurate</strong> layout and editing, enable <strong>OnlyOffice</strong> (see <code>.env.example</code> and run <code>docker compose up -d</code>). The lightweight preview here supports <strong>.docx</strong> only — use <strong>Download</strong> or <strong>Open</strong> for this file type.</p>';
        return;
      }

      if (typeof mammoth === 'undefined') {
        previewBody.innerHTML =
          '<p class="preview-fallback">Preview library not loaded. Use <strong>Download</strong> or <strong>Open</strong> in a new tab.</p>';
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        const buf = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        const div = document.createElement('div');
        div.className = 'mammoth-preview';
        div.innerHTML = result.value;
        previewBody.innerHTML = '';
        previewBody.appendChild(div);
        const note = document.createElement('p');
        note.className = 'preview-fallback';
        note.style.marginTop = '0.5rem';
        note.innerHTML =
          'This is an approximate preview — spacing and alignment may differ from Microsoft Word. For a <strong>pixel-accurate</strong> view and edits that save back, configure <strong>OnlyOffice</strong> (Docker) as in <code>.env.example</code>.';
        previewBody.appendChild(note);
      } catch (e) {
        previewBody.innerHTML =
          '<p class="preview-fallback">Could not preview this Word file in the browser. Use <strong>Download</strong> or edit locally and <strong>Replace with new file</strong>.</p>';
      }
      return;
    }

    previewBody.innerHTML =
      '<p class="preview-fallback">No built-in preview for this file type. Use <strong>Download</strong> or <a href="' +
      escapeHtml(url) +
      '" target="_blank" rel="noopener">Open in new tab</a>.</p>';
  }

  function showPreview(doc) {
    selectedDoc = doc;
    if (!previewWrap || !previewHeading || !previewMeta || !titleInput) return;
    previewWrap.removeAttribute('hidden');
    previewHeading.textContent = doc.title || 'Untitled';
    previewMeta.textContent =
      (doc.doc_type || '') + ' · Term ' + doc.term + ' · ' + (doc.document_scope === 'all_classes' ? 'School-wide' : displayClass + streamPart);
    titleInput.value = doc.title || '';
    renderPreviewContent(doc);
  }

  function apiDocsUrl() {
    const u = new URL('/api/documents', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    u.searchParams.set('subject', subjectName);
    const ft = document.getElementById('work-term-filter').value;
    if (ft) u.searchParams.set('term', ft);
    return u.toString();
  }

  function apiBandsUrl() {
    const u = new URL('/api/subject-bands', window.location.origin);
    u.searchParams.set('classLevel', classLevel);
    if (stream) u.searchParams.set('stream', stream);
    u.searchParams.set('subject', subjectName);
    return u.toString();
  }

  let pieChart;
  let barChart;

  const COLORS = {
    strong: 'rgba(94, 234, 212, 0.85)',
    average: 'rgba(251, 191, 36, 0.9)',
    weak: 'rgba(248, 113, 113, 0.9)',
    unset: 'rgba(100, 116, 139, 0.75)',
  };

  function countsFromStudents(students) {
    const c = { strong: 0, average: 0, weak: 0, unset: 0 };
    students.forEach(function (r) {
      if (r.band === 'strong') c.strong += 1;
      else if (r.band === 'average') c.average += 1;
      else if (r.band === 'weak') c.weak += 1;
      else c.unset += 1;
    });
    return c;
  }

  function renderCharts(students) {
    const c = countsFromStudents(students);
    const labels = ['Strong', 'Average', 'Weak', 'Not rated'];
    const data = [c.strong, c.average, c.weak, c.unset];
    const bg = [COLORS.strong, COLORS.average, COLORS.weak, COLORS.unset];

    if (typeof Chart === 'undefined') {
      return;
    }

    const pieCtx = document.getElementById('chart-pie');
    const barCtx = document.getElementById('chart-bar');

    if (pieChart) pieChart.destroy();
    if (barChart) barChart.destroy();

    pieChart = new Chart(pieCtx.getContext('2d'), {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: bg,
            borderColor: 'rgba(10, 22, 40, 0.9)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9cb4c8' } },
        },
      },
    });

    barChart = new Chart(barCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Learners',
            data: data,
            backgroundColor: bg,
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#9cb4c8' },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
          y: {
            ticks: { color: '#9cb4c8' },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  async function loadDocuments() {
    const list = document.getElementById('subject-doc-list');
    list.innerHTML = '';
    let rows;
    try {
      const res = await fetch(apiDocsUrl());
      if (!res.ok) throw new Error();
      rows = await res.json();
    } catch {
      list.innerHTML = '<li>Could not load documents.</li>';
      lastDocRows = [];
      return;
    }
    lastDocRows = rows;
    if (!rows.length) {
      list.innerHTML =
        '<li style="color: var(--muted)">No schemes or work yet for this subject. Upload from the dashboard <strong>Notes</strong> tab.</li>';
      return;
    }
    rows.forEach(function (d) {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.className = 'doc-list-main';
      const scopeBadge =
        d.document_scope === 'all_classes'
          ? '<span class="badge" title="From Skills dashboard">School-wide</span> '
          : '';
      left.innerHTML =
        scopeBadge +
        '<span class="badge">Term ' +
        d.term +
        '</span> ' +
        escapeHtml(d.doc_type) +
        ' · ' +
        escapeHtml(d.title || 'Untitled');

      const actions = document.createElement('div');
      actions.className = 'doc-list-actions';

      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn btn-sm';
      btnView.textContent = 'View';
      btnView.addEventListener('click', function () {
        showPreview(d);
      });

      const aOpen = document.createElement('a');
      aOpen.href = d.file_path;
      aOpen.target = '_blank';
      aOpen.rel = 'noopener';
      aOpen.className = 'btn btn-sm';
      aOpen.textContent = 'Open';

      const aDl = document.createElement('a');
      aDl.href = absUrl(d.file_path);
      aDl.download = downloadFilename(d);
      aDl.className = 'btn btn-sm';
      aDl.textContent = 'Download';

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn btn-sm danger';
      btnDel.textContent = 'Delete';
      btnDel.addEventListener('click', async function () {
        if (!window.confirm('Delete this document from the workspace? The file will be removed from the server.')) {
          return;
        }
        try {
          const res = await fetch('/api/documents/' + d.id, { method: 'DELETE' });
          const out = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(out.error || res.statusText);
          if (selectedDoc && selectedDoc.id === d.id) hidePreview();
          flash('Document deleted.', true);
          await loadDocuments();
        } catch (e) {
          flash(e.message || 'Delete failed', false);
        }
      });

      actions.appendChild(btnView);
      actions.appendChild(aOpen);
      actions.appendChild(aDl);
      actions.appendChild(btnDel);

      li.appendChild(left);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  async function loadBandsAndTable() {
    const tbody = document.getElementById('band-body');
    tbody.innerHTML = '';
    let data;
    try {
      const res = await fetch(apiBandsUrl());
      if (!res.ok) throw new Error();
      data = await res.json();
    } catch {
      tbody.innerHTML =
        '<tr><td colspan="3">Could not load learners. Check database connection.</td></tr>';
      return;
    }
    const students = data.students || [];

    if (!students.length) {
      tbody.innerHTML =
        '<tr><td colspan="3" style="color: var(--muted)">No learners registered in this class yet.</td></tr>';
      renderCharts([]);
      return;
    }

    students.forEach(function (r) {
      const tr = document.createElement('tr');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Standing for ' + r.full_name);
      ;[
        { v: '', t: 'Not rated' },
        { v: 'strong', t: 'Strong' },
        { v: 'average', t: 'Average' },
        { v: 'weak', t: 'Weak' },
      ].forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.t;
        if ((r.band || '') === opt.v) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', async function () {
        const band = sel.value;
        try {
          if (!band) {
            const delUrl =
              '/api/subject-bands/' +
              r.id +
              '?subject=' +
              encodeURIComponent(subjectName);
            const res = await fetch(delUrl, { method: 'DELETE' });
            const out = await res.json().catch(function () {
              return {};
            });
            if (!res.ok) throw new Error(out.error || res.statusText);
            r.band = null;
            flash('Cleared standing for ' + r.full_name + '.', true);
            renderCharts(students);
            return;
          }
          const res = await fetch('/api/subject-bands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              student_id: r.id,
              subject: subjectName,
              band: band,
            }),
          });
          const out = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(out.error || res.statusText);
          r.band = band;
          flash('Saved standing for ' + r.full_name + '.', true);
          renderCharts(students);
        } catch (e) {
          flash(e.message || 'Could not save', false);
          sel.value = r.band || '';
        }
      });

      tr.innerHTML =
        '<td>' +
        escapeHtml(r.full_name) +
        '</td><td>' +
        escapeHtml(r.reg_no) +
        '</td><td></td>';
      tr.lastChild.appendChild(sel);
      tbody.appendChild(tr);
    });

    renderCharts(students);
  }

  function bindPreviewChrome() {
    if (previewClose) {
      previewClose.addEventListener('click', hidePreview);
    }
    if (previewExpand && previewWrap) {
      previewExpand.addEventListener('click', function () {
        const expanded = previewWrap.classList.toggle('subject-doc-preview-expanded');
        previewExpand.textContent = expanded ? 'Collapse' : 'Expand';
        previewExpand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
    }
    if (saveTitleBtn) {
      saveTitleBtn.addEventListener('click', async function () {
        if (!selectedDoc) return;
        const title = (titleInput && titleInput.value.trim()) || '';
        if (!title) {
          flash('Enter a title.', false);
          return;
        }
        try {
          const res = await fetch('/api/documents/' + selectedDoc.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title }),
          });
          const out = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(out.error || res.statusText);
          selectedDoc.title = out.title;
          if (previewHeading) previewHeading.textContent = out.title || 'Untitled';
          flash('Title saved.', true);
          await loadDocuments();
        } catch (e) {
          flash(e.message || 'Could not save title', false);
        }
      });
    }
    if (replaceTrigger && replaceFileInput) {
      replaceTrigger.addEventListener('click', function () {
        replaceFileInput.click();
      });
      replaceFileInput.addEventListener('change', async function () {
        if (!selectedDoc || !replaceFileInput.files || !replaceFileInput.files[0]) return;
        if (replaceStatus) replaceStatus.textContent = 'Uploading…';
        const fd = new FormData();
        fd.append('file', replaceFileInput.files[0]);
        try {
          const res = await fetch('/api/documents/' + selectedDoc.id + '/file', {
            method: 'PUT',
            body: fd,
          });
          const out = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(out.error || res.statusText);
          selectedDoc.file_path = out.file_path;
          selectedDoc.title = out.title;
          if (titleInput) titleInput.value = out.title || '';
          if (previewHeading) previewHeading.textContent = out.title || 'Untitled';
          replaceFileInput.value = '';
          if (replaceStatus) replaceStatus.textContent = 'File replaced.';
          flash('File updated. Preview refreshed.', true);
          await loadDocuments();
          renderPreviewContent(selectedDoc);
        } catch (e) {
          if (replaceStatus) replaceStatus.textContent = '';
          flash(e.message || 'Upload failed', false);
        }
      });
    }
  }

  document.getElementById('work-term-filter').addEventListener('change', async function () {
    await loadDocuments();
    if (selectedDoc && !lastDocRows.some(function (r) {
      return r.id === selectedDoc.id;
    })) {
      hidePreview();
    }
  });

  function boot() {
    bindPreviewChrome();
    loadDocuments();
    loadBandsAndTable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
