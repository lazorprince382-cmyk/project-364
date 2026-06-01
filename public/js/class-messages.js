(function () {
  let pollTimer = null;
  let lastSeenMessageIds = new Set();
  let messagesPollPrimed = false;
  let markSeenTimer = null;
  let bgWatchTimer = null;
  let lastBgStaffIds = new Set();
  let bgStaffSkipOnce = true;
  const DESTINATION_VERSION = '5';
  const DASH = function () {
    return window.__oceanDashboard || null;
  };

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function teacherLabel() {
    try {
      const d = DASH();
      const suffix =
        d && d.classLevel
          ? '_' +
            String(d.classLevel || '')
              .trim()
              .toLowerCase() +
            '_' +
            (String(d.stream || '')
              .trim()
              .toLowerCase() || '_')
          : '';
      const n = (suffix && localStorage.getItem('ocean_displayName' + suffix)) || localStorage.getItem('ocean_displayName');
      return n && String(n).trim() ? String(n).trim() : 'Teacher';
    } catch (_) {
      return 'Teacher';
    }
  }

  function showFeedback(text, ok) {
    const el = document.getElementById('messages-feedback');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'class-messages-feedback' + (text ? (ok ? ' ok' : ' err') : '');
  }

  function currentClassPick() {
    const d = DASH();
    if (!d || !d.classLevel) return null;
    return { classLevel: d.classLevel, stream: d.stream || '' };
  }

  function sameRoom(a, b) {
    if (!a || !b) return false;
    return a.classLevel === b.classLevel && (a.stream || '') === (b.stream || '');
  }

  function labelRoom(classLevel, stream) {
    const d = DASH();
    const titles = (d && d.titles) || {};
    const streamLabels = (d && d.streamLabels) || {};
    const t = titles[classLevel] || classLevel;
    if (stream) return t + ' — ' + (streamLabels[stream] || stream);
    return t;
  }

  function classContextDisplayText() {
    const cur = currentClassPick();
    if (!cur) return '';
    return labelRoom(cur.classLevel, cur.stream);
  }

  function staffSeenStorageKey() {
    const d = DASH();
    if (!d || !d.classLevel) return 'ocean_staff_seen___';
    const who = teacherLabel();
    return (
      'ocean_staff_seen_' +
      String(d.classLevel || '') +
      '_' +
      String(d.stream || '_') +
      '_' +
      String(who || '').trim().toLowerCase().replace(/\s+/g, '_')
    );
  }

  function readLastSeenStaffId() {
    try {
      const n = Number(localStorage.getItem(staffSeenStorageKey()) || '0');
      return Number.isFinite(n) ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function writeLastSeenStaffId(idNum) {
    const n = Number(idNum || 0);
    if (!Number.isFinite(n) || n <= 0) return;
    try {
      localStorage.setItem(staffSeenStorageKey(), String(Math.floor(n)));
    } catch (_) {}
  }

  function rowNumericId(r) {
    const n = Number(r && r.id);
    return Number.isFinite(n) ? n : 0;
  }

  function syncClassContextUi() {
    const el = document.getElementById('messages-class-context');
    if (!el) return;
    const txt = classContextDisplayText();
    el.textContent = txt || '—';
  }

  function resetMessagePollState() {
    lastSeenMessageIds = new Set();
    messagesPollPrimed = false;
  }

  function isClassMessagesPanelActive() {
    const p = document.getElementById('panel-messages');
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
    if (!isClassMessagesPanelActive() || document.visibilityState !== 'visible') return;
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
    const preview =
      (String(first.body || '').trim().slice(0, 160) ||
        (first.attachment_path ? 'Sent an attachment' : 'New message')) +
      (newOthers.length > 1 ? ' (+' + (newOthers.length - 1) + ' more)' : '');
    const summary =
      newOthers.length === 1
        ? 'Staff message from ' + (first.sender_label || 'colleague')
        : String(newOthers.length) + ' new staff messages';
    N.notifyIncoming(summary, preview);
  }

  function notifyPendingMessagesOnSignIn(rows) {
    const N = window.OceanMessageNotify;
    if (!N || !Array.isArray(rows) || !rows.length) return;
    const me = teacherLabel();
    const lastSeenId = readLastSeenStaffId();
    const pending = rows.filter(function (r) {
      return rowNumericId(r) > lastSeenId && String(r.sender_label || '').trim() !== me;
    });
    if (!pending.length) {
      const maxOnly = rows.reduce(function (m, r) {
        return Math.max(m, rowNumericId(r));
      }, 0);
      writeLastSeenStaffId(maxOnly);
      return;
    }
    const first = pending[0];
    const preview =
      (String(first.body || '').trim().slice(0, 160) ||
        (first.attachment_path ? 'Sent an attachment' : 'New message')) +
      (pending.length > 1 ? ' (+' + (pending.length - 1) + ' more)' : '');
    const summary =
      pending.length === 1
        ? 'Unread staff message from ' + (first.sender_label || 'colleague')
        : String(pending.length) + ' unread staff messages';
    N.notifyIncoming(summary, preview + ' — All staff (this class)');
    if (window.__oceanDashboard && typeof window.__oceanDashboard.addNotification === 'function') {
      window.__oceanDashboard.addNotification(summary + ': ' + preview);
    }
    const maxId = rows.reduce(function (m, r) {
      return Math.max(m, rowNumericId(r));
    }, 0);
    writeLastSeenStaffId(maxId);
  }

  function skillSubjectsList() {
    const OCEAN_CLASSES = window.OCEAN_CLASSES || [];
    const skills = OCEAN_CLASSES.find(function (c) {
      return c.id === 'skills';
    });
    return skills && skills.skills ? skills.skills : [];
  }

  /** Other class dashboards (staff inbox), excluding the current dashboard. */
  function otherClassDestinations() {
    const rows = [];
    const OCEAN_CLASSES = window.OCEAN_CLASSES || [];
    const cur = currentClassPick();
    if (!cur) return rows;
    OCEAN_CLASSES.forEach(function (cfg) {
      if (cfg.id === 'skills') return;
      if (cfg.needsStream && cfg.streams) {
        cfg.streams.forEach(function (s) {
          const r = { classLevel: cfg.id, stream: s.id };
          if (sameRoom(r, cur)) return;
          rows.push(r);
        });
      } else {
        const r = { classLevel: cfg.id, stream: '' };
        if (sameRoom(r, cur)) return;
        rows.push(r);
      }
    });
    return rows;
  }

  /**
   * Destination room for API (where the message is stored / which thread we load).
   * Values: staff | skill:Subject | class:level|stream
   */
  function getMessageRoomFromSelect() {
    const sel = document.getElementById('messages-destination');
    if (!sel) return null;
    const val = String(sel.value);
    const dash = currentClassPick();
    if (!dash) return null;
    if (val === 'staff') {
      return { classLevel: dash.classLevel, stream: dash.stream || '', skillSubject: '' };
    }
    if (val.indexOf('skill:') === 0) {
      let subj = '';
      try {
        subj = decodeURIComponent(val.slice(6));
      } catch (_) {
        subj = val.slice(6);
      }
      return { classLevel: dash.classLevel, stream: dash.stream || '', skillSubject: subj };
    }
    if (val.indexOf('class:') === 0) {
      const rest = val.slice(6);
      const pipe = rest.indexOf('|');
      const cl = pipe === -1 ? rest : rest.slice(0, pipe);
      const st = pipe === -1 ? '' : rest.slice(pipe + 1);
      return { classLevel: cl, stream: st, skillSubject: '' };
    }
    return null;
  }

  function populateDestinationSelect() {
    const sel = document.getElementById('messages-destination');
    if (!sel) return;
    if (sel.dataset.filled === DESTINATION_VERSION) return;
    sel.dataset.filled = DESTINATION_VERSION;
    sel.innerHTML = '';

    const oStaff = document.createElement('option');
    oStaff.value = 'staff';
    oStaff.textContent = 'All staff (this class)';
    sel.appendChild(oStaff);

    otherClassDestinations().forEach(function (r) {
      const o = document.createElement('option');
      o.value = 'class:' + r.classLevel + '|' + (r.stream || '');
      o.textContent = labelRoom(r.classLevel, r.stream) + ' — staff inbox';
      sel.appendChild(o);
    });

    skillSubjectsList().forEach(function (sk) {
      const o = document.createElement('option');
      o.value = 'skill:' + encodeURIComponent(sk.subject);
      o.textContent = sk.label + ' (this class skill inbox)';
      sel.appendChild(o);
    });
  }

  function populateMessagingUi() {
    if (!DASH()) return;
    syncClassContextUi();
    populateDestinationSelect();
    updateChannelLabel();
  }

  function updateChannelLabel() {
    const dest = document.getElementById('messages-destination');
    const el = document.getElementById('messages-channel-label');
    if (!el || !dest) return;
    const fromPart = classContextDisplayText();
    if (!fromPart) {
      el.textContent = '';
      return;
    }
    const opt = dest.options[dest.selectedIndex];
    const toPart = opt ? opt.textContent : '—';
    el.textContent = 'From: ' + fromPart + ' → To: ' + toPart;
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

  async function loadMessages() {
    const thread = document.getElementById('messages-thread');
    if (!thread) return;
    const room = getMessageRoomFromSelect();
    if (!room || !room.classLevel) {
      thread.innerHTML =
        '<p class="class-messages-empty">Choose a destination or open this tab from a class dashboard.</p>';
      return;
    }
    const u = new URL('/api/class-messages', window.location.origin);
    u.searchParams.set('classLevel', room.classLevel);
    if (room.stream) u.searchParams.set('stream', room.stream);
    if (room.skillSubject) u.searchParams.set('skillSubject', room.skillSubject);
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
    if (!room.skillSubject) {
      const dashRoom = currentClassPick();
      if (dashRoom && sameRoom(room, dashRoom)) {
        const maxId = rows.reduce(function (m, r) {
          return Math.max(m, rowNumericId(r));
        }, 0);
        writeLastSeenStaffId(maxId);
      }
    }

    if (!rows.length) {
      thread.innerHTML =
        '<p class="class-messages-empty">No messages yet in this channel. Say hello or share a file below.</p>';
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
      const ocl = m.origin_class_level != null ? String(m.origin_class_level).trim() : '';
      const ost = m.origin_stream != null ? String(m.origin_stream).trim() : '';
      if (ocl || ost) {
        const tag = document.createElement('div');
        tag.className = 'class-msg-skill-tag';
        tag.textContent = 'Sent from: ' + labelRoom(ocl || '', ost);
        div.appendChild(tag);
      }
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

  function stopBackgroundWatch() {
    if (bgWatchTimer) {
      clearInterval(bgWatchTimer);
      bgWatchTimer = null;
    }
  }

  async function runStaffBackgroundPoll() {
    const panel = document.getElementById('panel-messages');
    if (!panel || panel.classList.contains('active')) return;
    const dash = window.__oceanDashboard;
    if (!dash || !dash.classLevel) return;
    const u = new URL('/api/class-messages', window.location.origin);
    u.searchParams.set('classLevel', dash.classLevel);
    if (dash.stream) u.searchParams.set('stream', dash.stream);
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
    if (bgStaffSkipOnce) {
      bgStaffSkipOnce = false;
      notifyPendingMessagesOnSignIn(rows);
      lastBgStaffIds = new Set(ids);
      return;
    }
    const N = window.OceanMessageNotify;
    if (N) {
      const newOthers = rows.filter(function (r) {
        return !lastBgStaffIds.has(r.id) && String(r.sender_label || '').trim() !== me;
      });
      if (newOthers.length) {
        const first = newOthers[0];
        const preview =
          (String(first.body || '').trim().slice(0, 160) ||
            (first.attachment_path ? 'Sent an attachment' : 'New message')) +
          (newOthers.length > 1 ? ' (+' + (newOthers.length - 1) + ' more)' : '');
        const summary =
          newOthers.length === 1
            ? 'Staff message from ' + (first.sender_label || 'colleague')
            : String(newOthers.length) + ' new staff messages';
        N.notifyIncoming(summary, preview + ' — All staff (this class)');
        if (window.__oceanDashboard && typeof window.__oceanDashboard.addNotification === 'function') {
          window.__oceanDashboard.addNotification(summary + ': ' + preview);
        }
      }
    }
    lastBgStaffIds = new Set(ids);
  }

  window.__oceanMessagesStartBackgroundWatch = function () {
    stopBackgroundWatch();
    const panel = document.getElementById('panel-messages');
    if (!panel || panel.classList.contains('active')) return;
    if (!window.__oceanDashboard || !window.__oceanDashboard.classLevel) return;
    bgStaffSkipOnce = true;
    bgWatchTimer = setInterval(runStaffBackgroundPoll, 36000);
    setTimeout(runStaffBackgroundPoll, 900);
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
        const msg =
          (out.data && out.data.error) ||
          'Could not delete (HTTP ' + out.status + ').';
        showFeedback(msg, false);
        if (window.__oceanDashboard && window.__oceanDashboard.flash) {
          window.__oceanDashboard.flash(msg, false);
        }
        return false;
      }
      return true;
    } catch (e) {
      showFeedback(e.message || 'Network error', false);
      return false;
    }
  }

  function bindForm() {
    const form = document.getElementById('form-class-message');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      showFeedback('', true);
      const dash = currentClassPick();
      const room = getMessageRoomFromSelect();
      if (!dash || !room || !room.classLevel) {
        showFeedback('Class context missing.', false);
        return;
      }
      const bodyEl = document.getElementById('messages-body');
      const fileEl = document.getElementById('messages-attachment');
      const body = bodyEl ? bodyEl.value.trim() : '';
      const file = fileEl && fileEl.files ? fileEl.files[0] : null;
      if (!body && !file) {
        showFeedback('Type a message or attach a file.', false);
        if (window.__oceanDashboard && window.__oceanDashboard.flash) {
          window.__oceanDashboard.flash('Type a message or attach a file.', false);
        }
        return;
      }
      let originClass = '';
      let originStream = '';
      if (!room.skillSubject && !sameRoom(room, dash)) {
        originClass = dash.classLevel;
        originStream = dash.stream || '';
      }
      const sendBtn = form.querySelector('[type="submit"]');
      if (sendBtn) sendBtn.disabled = true;
      const fd = new FormData();
      fd.append('class_level', room.classLevel);
      fd.append('stream', room.stream || '');
      fd.append('skill_subject', room.skillSubject || '');
      fd.append('origin_class_level', originClass);
      fd.append('origin_stream', originStream);
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
          if (window.__oceanDashboard && window.__oceanDashboard.flash) {
            window.__oceanDashboard.flash(msg, false);
          }
          return;
        }
        if (bodyEl) bodyEl.value = '';
        if (fileEl) fileEl.value = '';
        showFeedback('Message sent.', true);
        if (window.__oceanDashboard && window.__oceanDashboard.flash) {
          window.__oceanDashboard.flash('Message sent.', true);
        }
        await loadMessages();
      } catch (err) {
        const msg = err.message || 'Network error while sending.';
        showFeedback(msg, false);
        if (window.__oceanDashboard && window.__oceanDashboard.flash) {
          window.__oceanDashboard.flash(msg, false);
        }
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    });
  }

  function initOnce() {
    populateMessagingUi();
    bindForm();
    const dest = document.getElementById('messages-destination');
    if (dest && !dest.dataset.changeBound) {
      dest.dataset.changeBound = '1';
      dest.addEventListener('change', function () {
        resetMessagePollState();
        updateChannelLabel();
        showFeedback('');
        loadMessages();
      });
    }
    const ref = document.getElementById('messages-refresh');
    if (ref && !ref.dataset.bound) {
      ref.dataset.bound = '1';
      ref.addEventListener('click', function () {
        showFeedback('');
        loadMessages();
      });
    }
  }

  window.__oceanMessagesInit = function () {
    if (!document.getElementById('panel-messages')) return;
    stopBackgroundWatch();
    if (window.OceanMessageNotify) {
      window.OceanMessageNotify.attachPanelAskOnce('panel-messages');
    }
    initOnce();
    showFeedback('');
    resetMessagePollState();
    loadMessages();
    startPolling();
  };

  window.__oceanMessagesPause = function () {
    pausePolling();
    stopBackgroundWatch();
  };
})();
