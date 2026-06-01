(function () {
  let pollTimer = null;
  let lastSeenMessageIds = new Set();
  let messagesPollPrimed = false;
  let markSeenTimer = null;
  let skillBgTimer = null;
  let lastSkillBgIds = new Set();
  let skillBgSkipOnce = true;
  const PICKER_VERSION = '1';

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function teacherLabel() {
    try {
      const n = localStorage.getItem('ocean_displayName');
      return n && String(n).trim() ? String(n).trim() : 'Teacher';
    } catch (_) {
      return 'Teacher';
    }
  }

  function subjectName() {
    return (window.__oceanSkill && window.__oceanSkill.subjectName) || '';
  }

  function showFeedback(text, ok) {
    const el = document.getElementById('skill-messages-feedback');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'class-messages-feedback' + (text ? (ok ? ' ok' : ' err') : '');
  }

  function flash(msg, ok) {
    const el = document.getElementById('flash');
    if (!el) return;
    el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + escapeHtml(msg) + '</div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 5000);
  }

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
    const OCEAN_CLASSES = window.OCEAN_CLASSES || [];
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

  function parsePick(val) {
    if (!val) return null;
    const parts = String(val).split('|');
    return {
      classLevel: parts[0] || '',
      stream: parts[1] != null ? parts[1] : '',
    };
  }

  function resetMessagePollState() {
    lastSeenMessageIds = new Set();
    messagesPollPrimed = false;
  }

  function isSkillMessagesPanelActive() {
    const p = document.getElementById('panel-skill-messages');
    return p && p.classList.contains('active');
  }

  function appendReceiptTicks(div, tick) {
    if (tick == null || tick < 1) return;
    const span = document.createElement('span');
    span.className = 'class-msg-ticks';
    span.setAttribute('data-tick', String(tick));
    span.setAttribute('aria-label', tick === 3 ? 'Seen' : tick === 2 ? 'Delivered' : 'Sent');
    span.textContent = tick === 1 ? '✓' : '✓✓';
    div.appendChild(span);
  }

  function scheduleMarkSeenForRows(rows) {
    const v = teacherLabel();
    const ids = rows
      .filter(function (m) {
        return String(m.sender_label || '').trim() !== v;
      })
      .map(function (m) {
        return m.id;
      });
    if (!ids.length) return;
    if (!isSkillMessagesPanelActive() || document.visibilityState !== 'visible') return;
    clearTimeout(markSeenTimer);
    markSeenTimer = setTimeout(function () {
      fetch('/api/class-messages/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerLabel: v, messageIds: ids }),
      }).catch(function () {});
    }, 500);
  }

  function detectAndNotifyNewMessages(rows) {
    const N = window.OceanMessageNotify;
    if (!N || !messagesPollPrimed) return;
    const me = teacherLabel();
    const newOthers = rows.filter(function (r) {
      return !lastSeenMessageIds.has(r.id) && String(r.sender_label || '').trim() !== me;
    });
    if (!newOthers.length) return;
    const first = newOthers[0];
    const subj = subjectName() || 'subject';
    const preview =
      (String(first.body || '').trim().slice(0, 160) ||
        (first.attachment_path ? 'Sent an attachment' : 'New message')) +
      (newOthers.length > 1 ? ' (+' + (newOthers.length - 1) + ' more)' : '');
    const summary =
      newOthers.length === 1
        ? 'Staff message for ' + subj + ' from ' + (first.sender_label || 'colleague')
        : String(newOthers.length) + ' new messages for ' + subj;
    N.notifyIncoming(summary, preview);
  }

  function populateClassPick() {
    const sel = document.getElementById('skill-messages-class-pick');
    if (!sel) return;
    if (sel.dataset.filled === PICKER_VERSION) return;
    sel.dataset.filled = PICKER_VERSION;
    sel.innerHTML = '';
    buildClassRows().forEach(function (r) {
      const o = document.createElement('option');
      o.value = r.classLevel + '|' + (r.stream || '');
      o.textContent = r.label;
      sel.appendChild(o);
    });
  }

  async function parseResponse(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data, text: text };
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (_) {
      return '';
    }
  }

  async function loadMessages() {
    const thread = document.getElementById('skill-messages-thread');
    const subj = subjectName();
    if (!thread || !subj) return;
    const u = new URL('/api/class-messages', window.location.origin);
    u.searchParams.set('skillSubject', subj);
    u.searchParams.set('viewerLabel', teacherLabel());
    let rows;
    try {
      const res = await fetch(u);
      const out = await parseResponse(res);
      if (!out.ok) {
        const msg =
          (out.data && out.data.error) ||
          (out.text && out.text.length < 400 ? out.text : '') ||
          'Could not load messages (HTTP ' + out.status + ').';
        thread.innerHTML = '<p class="class-messages-empty">' + escapeHtml(msg) + '</p>';
        return;
      }
      rows = Array.isArray(out.data) ? out.data : [];
    } catch (e) {
      thread.innerHTML =
        '<p class="class-messages-empty">Network error. Check the server is running.</p>';
      return;
    }

    const ids = rows.map(function (r) {
      return r.id;
    });
    detectAndNotifyNewMessages(rows);
    lastSeenMessageIds = new Set(ids);
    messagesPollPrimed = true;

    if (!rows.length) {
      thread.innerHTML =
        '<p class="class-messages-empty">No messages routed to this subject yet. Class teachers choose this subject as the destination from their class dashboard.</p>';
      scheduleMarkSeenForRows(rows);
      return;
    }
    thread.innerHTML = '';
    const me = teacherLabel();
    rows.forEach(function (m) {
      const div = document.createElement('div');
      div.className = 'class-msg-bubble';
      if (String(m.sender_label || '').trim() === me) {
        div.classList.add('is-own');
      }
      const from = document.createElement('div');
      from.className = 'class-msg-skill-tag';
      from.textContent = 'From: ' + labelClass(m.class_level, m.stream || '');
      div.appendChild(from);
      const meta = document.createElement('div');
      meta.className = 'class-msg-meta';
      meta.innerHTML =
        '<strong>' + escapeHtml(m.sender_label || 'Teacher') + '</strong> · ' + escapeHtml(formatTime(m.created_at));
      div.appendChild(meta);
      if (m.body) {
        const b = document.createElement('div');
        b.className = 'class-msg-body';
        b.textContent = m.body;
        div.appendChild(b);
      }
      if (m.attachment_path) {
        const aWrap = document.createElement('div');
        aWrap.className = 'class-msg-attach';
        const a = document.createElement('a');
        a.href = m.attachment_path;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '📎 ' + (m.attachment_original_name || 'Attachment');
        aWrap.appendChild(a);
        div.appendChild(aWrap);
      }
      if (String(m.sender_label || '').trim() === me) {
        appendReceiptTicks(div, m.receipt_tick != null ? Number(m.receipt_tick) : 1);
        const row = document.createElement('div');
        row.className = 'class-msg-own-actions';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'class-msg-delete';
        del.textContent = 'Delete';
        del.setAttribute('aria-label', 'Delete your message');
        del.addEventListener('click', async function () {
          if (!window.confirm('Delete this message for everyone?')) return;
          if (await deleteOwnMessage(m.id)) {
            showFeedback('Message deleted.', true);
            flash('Message deleted.', true);
            await loadMessages();
          }
        });
        row.appendChild(del);
        div.appendChild(row);
      }
      thread.appendChild(div);
    });
    thread.scrollTop = thread.scrollHeight;
    scheduleMarkSeenForRows(rows);
  }

  function stopSkillBackgroundWatch() {
    if (skillBgTimer) {
      clearInterval(skillBgTimer);
      skillBgTimer = null;
    }
  }

  async function runSkillBackgroundPoll() {
    const panel = document.getElementById('panel-skill-messages');
    if (!panel || panel.classList.contains('active')) return;
    const subj = subjectName();
    if (!subj) return;
    const u = new URL('/api/class-messages', window.location.origin);
    u.searchParams.set('skillSubject', subj);
    u.searchParams.set('viewerLabel', teacherLabel());
    let rows = [];
    try {
      const res = await fetch(u);
      const out = await parseResponse(res);
      if (!out.ok || !Array.isArray(out.data)) return;
      rows = out.data;
    } catch (_) {
      return;
    }
    const me = teacherLabel();
    const ids = rows.map(function (r) {
      return r.id;
    });
    if (skillBgSkipOnce) {
      skillBgSkipOnce = false;
      lastSkillBgIds = new Set(ids);
      return;
    }
    const N = window.OceanMessageNotify;
    if (N) {
      const newOthers = rows.filter(function (r) {
        return !lastSkillBgIds.has(r.id) && String(r.sender_label || '').trim() !== me;
      });
      if (newOthers.length) {
        const first = newOthers[0];
        const preview =
          (String(first.body || '').trim().slice(0, 160) ||
            (first.attachment_path ? 'Sent an attachment' : 'New message')) +
          (newOthers.length > 1 ? ' (+' + (newOthers.length - 1) + ' more)' : '');
        const summary =
          newOthers.length === 1
            ? 'Staff message for ' + subj + ' from ' + (first.sender_label || 'colleague')
            : String(newOthers.length) + ' new messages for ' + subj;
        N.notifyIncoming(summary, preview);
      }
    }
    lastSkillBgIds = new Set(ids);
  }

  window.__oceanSkillMessagesStartBackgroundWatch = function () {
    stopSkillBackgroundWatch();
    const panel = document.getElementById('panel-skill-messages');
    if (!panel || panel.classList.contains('active')) return;
    if (!subjectName()) return;
    skillBgSkipOnce = true;
    skillBgTimer = setInterval(runSkillBackgroundPoll, 36000);
    setTimeout(runSkillBackgroundPoll, 900);
  };

  function pausePolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    pausePolling();
    pollTimer = setInterval(loadMessages, 18000);
  }

  async function deleteOwnMessage(id) {
    const me = teacherLabel();
    const u =
      '/api/class-messages/' +
      encodeURIComponent(String(id)) +
      '?viewerLabel=' +
      encodeURIComponent(me);
    try {
      const res = await fetch(u, { method: 'DELETE' });
      const out = await parseResponse(res);
      if (!out.ok) {
        const msg = (out.data && out.data.error) || 'Could not delete (HTTP ' + out.status + ').';
        showFeedback(msg, false);
        flash(msg, false);
        return false;
      }
      return true;
    } catch (e) {
      showFeedback(e.message || 'Network error', false);
      return false;
    }
  }

  function bindForm() {
    const form = document.getElementById('form-skill-message');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const subj = subjectName();
      if (!subj) {
        showFeedback('Subject not loaded.', false);
        return;
      }
      showFeedback('', true);
      const pick = parsePick(document.getElementById('skill-messages-class-pick').value);
      if (!pick || !pick.classLevel) {
        showFeedback('Choose which class this note is about.', false);
        return;
      }
      const bodyEl = document.getElementById('skill-messages-body');
      const fileEl = document.getElementById('skill-messages-attachment');
      const body = bodyEl ? bodyEl.value.trim() : '';
      const file = fileEl && fileEl.files ? fileEl.files[0] : null;
      if (!body && !file) {
        showFeedback('Type a message or attach a file.', false);
        flash('Type a message or attach a file.', false);
        return;
      }
      const sendBtn = form.querySelector('[type="submit"]');
      if (sendBtn) sendBtn.disabled = true;
      const fd = new FormData();
      fd.append('class_level', pick.classLevel);
      fd.append('stream', pick.stream || '');
      fd.append('skill_subject', subj);
      fd.append('sender_label', teacherLabel());
      fd.append('body', body);
      if (file) fd.append('attachment', file);
      try {
        const res = await fetch('/api/class-messages', { method: 'POST', body: fd });
        const out = await parseResponse(res);
        if (!out.ok) {
          const msg =
            (out.data && out.data.error) ||
            'Send failed (HTTP ' + out.status + '). Run npm run db:init if the database is new.';
          showFeedback(msg, false);
          flash(msg, false);
          return;
        }
        if (bodyEl) bodyEl.value = '';
        if (fileEl) fileEl.value = '';
        showFeedback('Message sent.', true);
        flash('Message sent.', true);
        await loadMessages();
      } catch (err) {
        const msg = err.message || 'Network error while sending.';
        showFeedback(msg, false);
        flash(msg, false);
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    });
  }

  window.__oceanSkillMessagesInit = function () {
    if (!document.getElementById('panel-skill-messages')) return;
    stopSkillBackgroundWatch();
    if (window.OceanMessageNotify) {
      window.OceanMessageNotify.attachPanelAskOnce('panel-skill-messages');
    }
    const lab = document.getElementById('skill-messages-subject-label');
    if (lab) lab.textContent = subjectName() || 'this subject';
    populateClassPick();
    bindForm();
    const sel = document.getElementById('skill-messages-class-pick');
    if (sel && !sel.dataset.changeBound) {
      sel.dataset.changeBound = '1';
      sel.addEventListener('change', function () {
        showFeedback('');
      });
    }
    const ref = document.getElementById('skill-messages-refresh');
    if (ref && !ref.dataset.bound) {
      ref.dataset.bound = '1';
      ref.addEventListener('click', function () {
        showFeedback('');
        loadMessages();
      });
    }
    showFeedback('');
    resetMessagePollState();
    loadMessages();
    startPolling();
  };

  window.__oceanSkillMessagesPause = function () {
    pausePolling();
    stopSkillBackgroundWatch();
  };
})();
