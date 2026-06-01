/**
 * Voice notes: tap mic to record, pause/resume while recording, preview, then send.
 */
(function () {
  let mediaRecorder = null;
  let mediaStream = null;
  let recordChunks = [];
  let recordStartedAt = 0;
  let recordPausedTotalMs = 0;
  let recordPauseStartedAt = 0;
  let recordPaused = false;
  let timerInterval = null;
  let recordCancelled = false;
  let recordedMime = 'audio/webm';
  let isRecording = false;
  let previewBlob = null;
  let previewUrl = null;
  let previewAudio = null;
  let getReadOnly = function () {
    return false;
  };
  let onSendVoice = null;
  let onShareVoice = null;

  const supportsRecordPause =
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.prototype.pause === 'function' &&
    typeof MediaRecorder.prototype.resume === 'function';

  function formatVoiceDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  function audioEffectiveDuration(audio) {
    if (!audio) return 0;
    const d = audio.duration;
    if (d && isFinite(d) && d > 0) return d;
    try {
      if (audio.seekable && audio.seekable.length > 0) {
        const end = audio.seekable.end(audio.seekable.length - 1);
        if (end && isFinite(end) && end > 0) return end;
      }
    } catch (_) {}
    try {
      if (audio.buffered && audio.buffered.length > 0) {
        const end = audio.buffered.end(audio.buffered.length - 1);
        if (end && isFinite(end) && end > 0) return end;
      }
    } catch (_) {}
    return 0;
  }

  function probeAudioDuration(audio) {
    const quick = audioEffectiveDuration(audio);
    if (quick > 0) return Promise.resolve(quick);
    return new Promise(function (resolve) {
      let settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(audioEffectiveDuration(audio));
      }
      function cleanup() {
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onMeta);
        audio.removeEventListener('durationchange', onMeta);
        audio.removeEventListener('canplaythrough', onMeta);
      }
      function onMeta() {
        if (audioEffectiveDuration(audio) > 0) finish();
      }
      const timer = setTimeout(finish, 4000);
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('durationchange', onMeta);
      audio.addEventListener('canplaythrough', onMeta);
      if (audio.readyState >= 1) onMeta();
    });
  }

  function isPlaybackLocked() {
    const root = document.getElementById('leader-messages-thread');
    if (!root) return false;
    const audios = root.querySelectorAll('.dm-voice-audio');
    for (let i = 0; i < audios.length; i++) {
      const a = audios[i];
      if (a.ended) continue;
      if (!a.paused) return true;
      if ((a.currentTime || 0) > 0.05) return true;
    }
    return false;
  }

  function pauseAllPlayback() {
    document.querySelectorAll('.dm-voice-audio').forEach(function (a) {
      try {
        a.pause();
      } catch (_) {}
    });
  }

  function wireVoicePlayback(audio, ui) {
    let knownDuration = 0;

    function updateProgress() {
      const d = knownDuration || audioEffectiveDuration(audio);
      const t = audio.currentTime || 0;
      if (d > 0) {
        ui.fill.style.width = Math.min(100, (t / d) * 100) + '%';
        if (audio.paused && !audio.ended && t > 0) {
          ui.timeEl.textContent = formatVoiceDuration(t) + ' / ' + formatVoiceDuration(d);
        } else if (!audio.paused) {
          ui.timeEl.textContent = formatVoiceDuration(t);
        } else if (audio.ended) {
          ui.timeEl.textContent = formatVoiceDuration(d);
          ui.fill.style.width = '100%';
        } else {
          ui.timeEl.textContent = formatVoiceDuration(d);
        }
      } else if (t > 0) {
        ui.timeEl.textContent = formatVoiceDuration(t);
        const bufEnd =
          audio.buffered && audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0;
        if (bufEnd > 0) ui.fill.style.width = Math.min(100, (t / bufEnd) * 100) + '%';
      }
    }

    function syncTransport(playing) {
      if (ui.playBtn) ui.playBtn.hidden = !!playing;
      if (ui.pauseBtn) ui.pauseBtn.hidden = !playing;
    }

    function ensureDuration() {
      if (knownDuration > 0) return Promise.resolve(knownDuration);
      return probeAudioDuration(audio).then(function (d) {
        knownDuration = d;
        if (d > 0 && audio.paused && !audio.ended) {
          ui.timeEl.textContent = formatVoiceDuration(d);
        }
        return d;
      });
    }

    audio.addEventListener('loadedmetadata', function () {
      const d = audioEffectiveDuration(audio);
      if (d > 0) {
        knownDuration = d;
        if (audio.paused) ui.timeEl.textContent = formatVoiceDuration(d);
      }
    });
    audio.addEventListener('durationchange', function () {
      const d = audioEffectiveDuration(audio);
      if (d > 0) knownDuration = d;
      updateProgress();
    });
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', function () {
      syncTransport(false);
      updateProgress();
    });
    audio.addEventListener('pause', function () {
      if (!audio.ended) {
        syncTransport(false);
        updateProgress();
      }
    });
    audio.addEventListener('play', function () {
      syncTransport(true);
      updateProgress();
    });

    if (ui.bar) {
      ui.bar.style.cursor = 'pointer';
      ui.bar.setAttribute('role', 'slider');
      ui.bar.setAttribute('aria-label', 'Voice playback position');
      ui.bar.addEventListener('click', function (e) {
        const d = knownDuration || audioEffectiveDuration(audio);
        if (!d) return;
        const rect = ui.bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = pct * d;
        updateProgress();
      });
    }

    if (ui.playBtn) {
      ui.playBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.dm-voice-audio').forEach(function (other) {
          if (other !== audio) other.pause();
        });
        ensureDuration().then(function () {
          return audio.play();
        }).catch(function () {
          alert('Could not play this voice note.');
          syncTransport(false);
        });
      });
    }
    if (ui.pauseBtn) {
      ui.pauseBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        audio.pause();
        syncTransport(false);
        updateProgress();
      });
    }

    syncTransport(false);
    audio.load();

    return { updateProgress: updateProgress, syncTransport: syncTransport, audio: audio };
  }

  function isAudioAttachment(path, name) {
    const s = (String(path || '') + ' ' + String(name || '')).toLowerCase();
    return /voice-note|\.(webm|ogg|m4a|mp3|wav|aac|opus)(\?|$)/i.test(s);
  }

  function pickRecorderMime() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ];
    for (let i = 0; i < types.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return 'audio/webm';
  }

  function voiceExtension(mime) {
    if (/ogg/i.test(mime)) return '.ogg';
    if (/mp4|m4a/i.test(mime)) return '.m4a';
    return '.webm';
  }

  function el(id) {
    return document.getElementById(id);
  }

  function stopMediaStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (_) {}
      });
      mediaStream = null;
    }
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /** idle | recording | preview — only one bar visible at a time */
  function setVoiceMode(mode) {
    const panel = el('dm-voice-recording');
    const active = el('dm-voice-recording-active');
    const preview = el('dm-voice-preview');
    const compose = el('form-leader-message');
    const micBtn = el('dm-voice-btn');
    if (panel) panel.hidden = mode === 'idle';
    if (active) active.hidden = mode !== 'recording';
    if (preview) preview.hidden = mode !== 'preview';
    if (compose) compose.classList.toggle('dm-voice-active', mode !== 'idle');
    if (micBtn) micBtn.classList.toggle('is-recording', mode === 'recording');
    if (micBtn && mode === 'idle') {
      micBtn.setAttribute('title', 'Tap to record voice note');
      micBtn.setAttribute('aria-label', 'Record voice note');
    } else if (micBtn && mode === 'recording') {
      micBtn.setAttribute('title', 'Tap to finish recording');
      micBtn.setAttribute('aria-label', 'Finish recording');
    }
  }

  function getRecordElapsedMs() {
    if (!recordStartedAt) return 0;
    let pausedExtra = recordPausedTotalMs;
    if (recordPaused && recordPauseStartedAt) {
      pausedExtra += Date.now() - recordPauseStartedAt;
    }
    return Math.max(0, Date.now() - recordStartedAt - pausedExtra);
  }

  function updateRecordTimer() {
    const timer = el('dm-voice-timer');
    if (!timer) return;
    timer.textContent = formatVoiceDuration(getRecordElapsedMs() / 1000);
  }

  function syncRecordingTransportUi() {
    const pauseBtn = el('dm-voice-rec-pause');
    const resumeBtn = el('dm-voice-rec-resume');
    const paused = mediaRecorder && mediaRecorder.state === 'paused';
    const recording = mediaRecorder && mediaRecorder.state === 'recording';
    const hint = el('dm-voice-rec-hint');
    if (pauseBtn) {
      pauseBtn.hidden = !supportsRecordPause || !recording;
      pauseBtn.disabled = !recording;
    }
    if (resumeBtn) {
      resumeBtn.hidden = !supportsRecordPause || !paused;
      resumeBtn.disabled = !paused;
    }
    if (hint) {
      if (paused) hint.textContent = 'Paused — tap ▶ to continue or Done to finish';
      else if (recording) {
        hint.textContent = supportsRecordPause
          ? '❚❚ Pause · Done when finished · 🎤 to finish'
          : 'Tap Done or 🎤 when finished';
      }
    }
    const pulse = document.querySelector('#dm-voice-recording-active .dm-voice-pulse');
    if (pulse) pulse.hidden = !!paused;
  }

  function syncPreviewPlaybackUi(playing) {
    const playBtn = el('dm-voice-preview-play');
    const pauseBtn = el('dm-voice-preview-pause');
    if (playBtn) {
      playBtn.disabled = !!playing;
      playBtn.classList.toggle('is-disabled', !!playing);
    }
    if (pauseBtn) {
      pauseBtn.hidden = !playing;
      pauseBtn.disabled = !playing;
    }
  }

  function clearPreview() {
    if (previewAudio) {
      try {
        previewAudio.pause();
      } catch (_) {}
      previewAudio = null;
    }
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch (_) {}
      previewUrl = null;
    }
    previewBlob = null;
    syncPreviewPlaybackUi(false);
  }

  function showRecordingUi() {
    clearPreview();
    recordPaused = false;
    recordPausedTotalMs = 0;
    recordPauseStartedAt = 0;
    setVoiceMode('recording');
    const hint = el('dm-voice-rec-hint');
    if (hint) {
      hint.textContent = supportsRecordPause
        ? '❚❚ Pause · Done when finished · 🎤 to finish'
        : 'Tap Done or 🎤 when finished';
    }
    updateRecordTimer();
    syncRecordingTransportUi();
  }

  function showPreviewUi(blob) {
    isRecording = false;
    recordPaused = false;
    stopTimer();
    stopMediaStream();
    mediaRecorder = null;
    recordChunks = [];
    previewBlob = blob;
    previewUrl = URL.createObjectURL(blob);
    const hint = el('dm-voice-preview-hint');
    const timer = el('dm-voice-preview-timer');
    setVoiceMode('preview');
    if (hint) hint.textContent = '▶ Play · ❚❚ Pause · send when ready';
    if (timer) timer.textContent = '0:00';
    previewAudio = new Audio(previewUrl);
    previewAudio.preload = 'auto';
    previewAudio.addEventListener('loadedmetadata', function () {
      if (previewAudio.duration && isFinite(previewAudio.duration) && timer) {
        timer.textContent = formatVoiceDuration(previewAudio.duration);
      }
    });
    previewAudio.addEventListener('durationchange', function () {
      if (previewAudio.duration && isFinite(previewAudio.duration) && timer) {
        timer.textContent = formatVoiceDuration(previewAudio.duration);
      }
    });
    const previewBar = el('dm-voice-preview-bar');
    const previewFill = el('dm-voice-preview-bar-fill');
    if (previewBar && previewFill) {
      wireVoicePlayback(previewAudio, {
        playBtn: el('dm-voice-preview-play'),
        pauseBtn: el('dm-voice-preview-pause'),
        bar: previewBar,
        fill: previewFill,
        timeEl: timer,
      });
    } else {
      previewAudio.addEventListener('timeupdate', function () {
        if (timer) timer.textContent = formatVoiceDuration(previewAudio.currentTime || 0);
      });
      previewAudio.addEventListener('ended', function () {
        syncPreviewPlaybackUi(false);
      });
      previewAudio.addEventListener('pause', function () {
        if (previewAudio.ended) return;
        syncPreviewPlaybackUi(false);
      });
      previewAudio.addEventListener('play', function () {
        syncPreviewPlaybackUi(true);
      });
      previewAudio.load();
      syncPreviewPlaybackUi(false);
    }
  }

  function playPreview() {
    if (!previewAudio || !previewUrl) return;
    const p = previewAudio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () {
        alert('Could not play preview. Try recording again.');
      });
    }
  }

  function pausePreview() {
    if (!previewAudio) return;
    try {
      previewAudio.pause();
    } catch (_) {}
  }

  function discardAll() {
    recordCancelled = true;
    isRecording = false;
    recordPaused = false;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (_) {}
    }
    mediaRecorder = null;
    recordChunks = [];
    stopTimer();
    stopMediaStream();
    clearPreview();
    setVoiceMode('idle');
  }

  function pauseRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    if (!supportsRecordPause) {
      alert('Pause while recording is not supported in this browser. Use Done to finish.');
      return;
    }
    try {
      mediaRecorder.pause();
      recordPaused = true;
      recordPauseStartedAt = Date.now();
      syncRecordingTransportUi();
    } catch (_) {
      alert('Could not pause recording.');
    }
  }

  function resumeRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'paused') return;
    try {
      mediaRecorder.resume();
      recordPausedTotalMs += Date.now() - recordPauseStartedAt;
      recordPauseStartedAt = 0;
      recordPaused = false;
      syncRecordingTransportUi();
    } catch (_) {
      alert('Could not resume recording.');
    }
  }

  async function startRecording() {
    if (getReadOnly()) return;
    if (isRecording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Voice notes need a microphone. Try Chrome or Edge on this device.');
      return;
    }
    discardAll();
    recordCancelled = false;
    recordChunks = [];
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      recordedMime = pickRecorderMime();
      const options = {};
      if (recordedMime) options.mimeType = recordedMime;
      mediaRecorder = new MediaRecorder(mediaStream, options);
      if (mediaRecorder.mimeType) recordedMime = mediaRecorder.mimeType;

      mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) recordChunks.push(e.data);
      };

      mediaRecorder.onstop = function () {
        stopMediaStream();
        stopTimer();
        isRecording = false;
        recordPaused = false;

        if (recordCancelled) {
          recordChunks = [];
          setVoiceMode('idle');
          return;
        }

        const mime = recordedMime || 'audio/webm';
        const blob = new Blob(recordChunks, { type: mime });
        recordChunks = [];
        const dur = getRecordElapsedMs() / 1000;

        if (blob.size < 400 || dur < 0.35) {
          alert('Recording was too short. Tap the microphone and speak, then tap Done.');
          setVoiceMode('idle');
          return;
        }

        showPreviewUi(blob);
      };

      mediaRecorder.start();
      isRecording = true;
      recordStartedAt = Date.now();
      showRecordingUi();
      timerInterval = setInterval(function () {
        updateRecordTimer();
        if (getRecordElapsedMs() > 5 * 60 * 1000) stopRecording();
      }, 200);
    } catch (err) {
      alert(
        err && err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow the mic in browser settings to record voice notes.'
          : 'Could not start recording.'
      );
      discardAll();
    }
  }

  function stopRecording() {
    if (!mediaRecorder) return;
    const state = mediaRecorder.state;
    if (state !== 'recording' && state !== 'paused') return;
    recordCancelled = false;
    try {
      if (state === 'paused' && typeof mediaRecorder.resume === 'function') {
        try {
          mediaRecorder.resume();
        } catch (_) {}
      }
      if (typeof mediaRecorder.requestData === 'function') mediaRecorder.requestData();
      mediaRecorder.stop();
    } catch (_) {
      discardAll();
    }
  }

  function toggleRecording() {
    if (getReadOnly()) return;
    if (previewBlob) return;
    if (isRecording) stopRecording();
    else startRecording();
  }

  function sendPreview() {
    if (!previewBlob || getReadOnly()) return;
    const ext = voiceExtension(recordedMime);
    const file = new File([previewBlob], 'voice-note-' + Date.now() + ext, {
      type: previewBlob.type || recordedMime || 'audio/webm',
    });
    discardAll();
    if (typeof onSendVoice === 'function') onSendVoice(file);
  }

  function shareVoice(path, name) {
    if (getReadOnly()) return;
    if (typeof onShareVoice === 'function') {
      onShareVoice(path, name);
      return;
    }
    const url = new URL(path, window.location.origin).href;
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'voice-note.webm';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function appendVoicePlayer(div, m) {
    const path = m.attachment_path;
    const name = m.attachment_original_name || 'voice-note.webm';
    const wrap = document.createElement('div');
    wrap.className = 'dm-voice-note';
    if (m.id != null) wrap.dataset.messageId = String(m.id);
    const audio = document.createElement('audio');
    audio.className = 'dm-voice-audio';
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.src = path;
    const controls = document.createElement('div');
    controls.className = 'dm-voice-controls';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'dm-voice-play';
    playBtn.setAttribute('aria-label', 'Play voice message');
    playBtn.innerHTML = '<span class="dm-voice-play-icon" aria-hidden="true">▶</span>';
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'dm-voice-pause dm-voice-msg-pause';
    pauseBtn.setAttribute('aria-label', 'Pause voice message');
    pauseBtn.hidden = true;
    pauseBtn.innerHTML = '<span class="dm-voice-pause-icon" aria-hidden="true">❚❚</span>';
    const bar = document.createElement('div');
    bar.className = 'dm-voice-bar';
    const fill = document.createElement('div');
    fill.className = 'dm-voice-bar-fill';
    bar.appendChild(fill);
    const timeEl = document.createElement('span');
    timeEl.className = 'dm-voice-time';
    timeEl.textContent = '0:00';
    controls.appendChild(playBtn);
    controls.appendChild(pauseBtn);
    controls.appendChild(bar);
    controls.appendChild(timeEl);
    const actions = document.createElement('div');
    actions.className = 'dm-voice-actions';
    if (!getReadOnly() && typeof onShareVoice === 'function') {
      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'dm-voice-share';
      shareBtn.textContent = 'Share';
      shareBtn.addEventListener('click', function () {
        shareVoice(path, name);
      });
      actions.appendChild(shareBtn);
    }
    const dl = document.createElement('a');
    dl.href = path;
    dl.className = 'dm-voice-download';
    dl.download = name;
    dl.textContent = 'Save';
    dl.rel = 'noopener';
    actions.appendChild(dl);
    wrap.appendChild(controls);
    wrap.appendChild(actions);
    div.appendChild(wrap);

    wireVoicePlayback(audio, {
      playBtn: playBtn,
      pauseBtn: pauseBtn,
      bar: bar,
      fill: fill,
      timeEl: timeEl,
    });
  }

  function bindVoice(opts) {
    if (opts) {
      if (typeof opts.isReadOnly === 'function') getReadOnly = opts.isReadOnly;
      if (typeof opts.onSendVoice === 'function') onSendVoice = opts.onSendVoice;
      if (typeof opts.onShareVoice === 'function') onShareVoice = opts.onShareVoice;
    }
    const btn = el('dm-voice-btn');
    const cancelBtn = el('dm-voice-cancel');
    const discardBtn = el('dm-voice-discard');
    const sendBtn = el('dm-voice-send');
    const previewPlay = el('dm-voice-preview-play');
    const previewPause = el('dm-voice-preview-pause');
    const recPause = el('dm-voice-rec-pause');
    const recResume = el('dm-voice-rec-resume');
    const recDone = el('dm-voice-rec-done');
    if (!btn || btn.dataset.voiceBound) return;
    btn.dataset.voiceBound = '1';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleRecording();
    });

    function bindOnce(node, handler) {
      if (!node || node.dataset.voiceBound) return;
      node.dataset.voiceBound = '1';
      node.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handler();
      });
    }

    bindOnce(cancelBtn, discardAll);
    bindOnce(discardBtn, discardAll);
    bindOnce(sendBtn, sendPreview);
    bindOnce(recPause, pauseRecording);
    bindOnce(recResume, resumeRecording);
    bindOnce(recDone, stopRecording);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (isRecording || previewBlob)) discardAll();
    });
  }

  function syncVoiceUi(readOnly) {
    const btn = el('dm-voice-btn');
    if (btn) {
      btn.disabled = !!readOnly;
      btn.hidden = !!readOnly;
    }
    if (readOnly) discardAll();
  }

  window.OceanDmVoice = {
    isAudioAttachment: isAudioAttachment,
    appendVoicePlayer: appendVoicePlayer,
    bindVoice: bindVoice,
    syncVoiceUi: syncVoiceUi,
    cancelRecording: discardAll,
    isPlaybackLocked: isPlaybackLocked,
    pauseAllPlayback: pauseAllPlayback,
  };
})();
