/**
 * Dynamic welcome banner with rotating encouragement for all dashboards.
 */
(function (global) {
  const TOKEN_KEY = 'ocean_staff_token';
  const STAFF_KEY = 'ocean_staff_profile';
  const ROTATE_MS = 10000;
  const FADE_MS = 420;

  const POOLS = {
    class: [
      'Every learner you encourage today plants a seed for tomorrow.',
      'Small steps in your classroom become big leaps in life.',
      'Your patience and care shape more than marks — they shape character.',
      'One kind word from you can stay with a child for years.',
      'Teaching is love made visible. Keep showing up.',
      'Believe in each child — many will rise because you did.',
      'Progress is not always loud; your steady work still counts.',
      'You are building futures, one lesson and one smile at a time.',
    ],
    director: [
      'Strong schools are built by leaders who believe in their team.',
      'Your vision today becomes the culture learners feel tomorrow.',
      'Lead with clarity — your staff and learners are watching and learning.',
      'Great leadership lifts others higher than yourself.',
      'When you invest in teachers, you invest in every child here.',
      'Steady guidance turns good intentions into lasting excellence.',
      'Celebrate effort, expect growth, and the whole school rises.',
      'Your calm presence sets the tone for the entire community.',
    ],
    head: [
      'Quality begins in the classroom and grows through your review and care.',
      'Your feedback helps teachers grow — and learners thrive.',
      'Consistency in review builds excellence across every class group.',
      'You bridge classrooms and leadership — that work truly matters.',
      'Celebrate progress, guide with honesty, and standards rise.',
      'Every head comment you write carries a learner’s story forward.',
      'Strong review today means stronger reports tomorrow.',
      'Lead with encouragement — teachers give their best when they feel seen.',
    ],
    skill: [
      'Skills open doors that textbooks alone cannot.',
      'Hands-on learning stays with learners long after the lesson ends.',
      'Every practical lesson builds confidence and real-world pride.',
      'Your subject gives learners tools for life — keep inspiring them.',
      'Progress in skills is progress in independence.',
      'Celebrate effort in the workshop — mastery follows practice.',
      'You help learners discover talents they did not know they had.',
      'Practical excellence starts with a teacher who believes in the craft.',
    ],
    shared: [
      'Up with skills — up with excellence.',
      'The Ocean of Knowledge flows through every effort you make today.',
      'Today is another chance to make a difference.',
      'Excellence is built one thoughtful action at a time.',
      'You are part of something bigger — a school that believes in every child.',
    ],
  };

  let rotateTimer = null;
  let quoteIndex = 0;
  let activeMessages = [];

  function capitalizeName(name) {
    const w = String(name || '').trim();
    if (!w) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }

  function getDisplayName(fallback) {
    try {
      if (global.OceanSettings && typeof global.OceanSettings.getDisplayName === 'function') {
        const n = global.OceanSettings.getDisplayName();
        if (n && String(n).trim()) return capitalizeName(String(n).trim());
      }
      const raw = sessionStorage.getItem(STAFF_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st && st.display_name && String(st.display_name).trim()) {
          return capitalizeName(String(st.display_name).trim());
        }
      }
    } catch (_) {}
    return capitalizeName(fallback || 'Colleague');
  }

  function detectWorkspace() {
    if (document.body.classList.contains('app-director')) return 'director';
    if (document.body.classList.contains('app-head')) return 'head';
    const path = String(global.location.pathname || '').toLowerCase();
    if (path.indexOf('skill-dashboard') !== -1) return 'skill';
    if (path.indexOf('head-dashboard') !== -1) return 'head';
    if (path.indexOf('director-dashboard') !== -1) return 'director';
    return 'class';
  }

  function findTitleEl() {
    return (
      document.getElementById('dash-welcome-title') ||
      document.getElementById('dir-welcome-title')
    );
  }

  function findSubEl() {
    return (
      document.getElementById('dash-welcome-sub') ||
      document.getElementById('dir-welcome-sub')
    );
  }

  function buildMessages(workspace, context) {
    const base = (POOLS[workspace] || POOLS.class).slice();
    const shared = POOLS.shared.slice();
    const ctx = String(context || '').trim();
    if (ctx && (workspace === 'class' || workspace === 'skill')) {
      base.unshift('Great to have you here — keep ' + ctx + ' moving forward today.');
      base.unshift('Your work in ' + ctx + ' helps every learner feel seen and supported.');
    }
    const merged = base.concat(shared);
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = merged[i];
      merged[i] = merged[j];
      merged[j] = t;
    }
    return merged;
  }

  function setQuote(subEl, text) {
    if (!subEl) return;
    subEl.textContent = text;
  }

  function rotateQuote(subEl) {
    if (!subEl || activeMessages.length < 2) return;
    subEl.classList.add('is-fading');
    global.setTimeout(function () {
      quoteIndex = (quoteIndex + 1) % activeMessages.length;
      setQuote(subEl, activeMessages[quoteIndex]);
      subEl.classList.remove('is-fading');
    }, FADE_MS);
  }

  function stopRotation() {
    if (rotateTimer) {
      global.clearInterval(rotateTimer);
      rotateTimer = null;
    }
  }

  function startRotation(subEl) {
    stopRotation();
    if (!subEl || activeMessages.length < 2) return;
    rotateTimer = global.setInterval(function () {
      rotateQuote(subEl);
    }, ROTATE_MS);
  }

  function isClearOceanUi() {
    try {
      return document.documentElement.getAttribute('data-dash-ui') === 'clear-ocean';
    } catch (_) {
      return false;
    }
  }

  function greetingForTime() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function reportsTabForWorkspace(workspace) {
    if (workspace === 'director' || workspace === 'head') return 'reports';
    if (workspace === 'class' || workspace === 'skill') return 'reports';
    return '';
  }

  function ensureClearOceanWelcomeCta(workspace) {
    const banner = document.querySelector('[data-ocean-welcome]');
    if (!banner) return;
    const existing = banner.querySelector('.dash-welcome-cta');
    if (!isClearOceanUi()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const tab = reportsTabForWorkspace(workspace);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn dash-welcome-cta';
    btn.textContent = tab ? 'View reports →' : 'Open workspace →';
    btn.addEventListener('click', function () {
      if (tab && global.__oceanDirector && typeof global.__oceanDirector.switchToTab === 'function') {
        global.__oceanDirector.switchToTab(tab);
        return;
      }
      if (tab && global.__oceanHead && typeof global.__oceanHead.switchToTab === 'function') {
        global.__oceanHead.switchToTab(tab);
        return;
      }
      if (tab && global.__oceanDashboard && typeof global.__oceanDashboard.switchToTab === 'function') {
        global.__oceanDashboard.switchToTab(tab);
        return;
      }
      if (tab && global.__oceanSkill && typeof global.__oceanSkill.switchToTab === 'function') {
        global.__oceanSkill.switchToTab(tab);
        return;
      }
      const t = document.querySelector('.dash-tabs-wrap .tab[data-tab="' + tab + '"]');
      if (t) t.click();
    });
    banner.appendChild(btn);
  }

  function syncTitle(titleEl, fallback) {
    if (!titleEl) return;
    const name = getDisplayName(fallback);
    if (isClearOceanUi()) {
      titleEl.textContent = greetingForTime() + ', ' + name;
    } else {
      titleEl.textContent = 'Welcome, ' + name;
    }
  }

  function mount(opts) {
    const options = opts || {};
    const banner = document.querySelector('[data-ocean-welcome]');
    const workspace =
      options.workspace ||
      (banner && banner.getAttribute('data-ocean-welcome')) ||
      detectWorkspace();
    const titleEl = findTitleEl();
    const subEl = findSubEl();
    if (!titleEl || !subEl) return null;

    activeMessages = buildMessages(workspace, options.context);
    quoteIndex = 0;
    syncTitle(titleEl, options.fallbackName);
    setQuote(subEl, activeMessages[0]);
    ensureClearOceanWelcomeCta(workspace);
    startRotation(subEl);

    return { titleEl: titleEl, subEl: subEl, workspace: workspace };
  }

  function updateContext(context) {
    const subEl = findSubEl();
    const banner = document.querySelector('[data-ocean-welcome]');
    const workspace =
      (banner && banner.getAttribute('data-ocean-welcome')) || detectWorkspace();
    activeMessages = buildMessages(workspace, context);
    quoteIndex = 0;
    if (subEl) setQuote(subEl, activeMessages[0]);
    startRotation(subEl);
  }

  function refreshName(fallback) {
    syncTitle(findTitleEl(), fallback);
    const banner = document.querySelector('[data-ocean-welcome]');
    const workspace =
      (banner && banner.getAttribute('data-ocean-welcome')) || detectWorkspace();
    ensureClearOceanWelcomeCta(workspace);
  }

  function onDashUiChange() {
    const banner = document.querySelector('[data-ocean-welcome]');
    const workspace =
      (banner && banner.getAttribute('data-ocean-welcome')) || detectWorkspace();
    syncTitle(findTitleEl());
    ensureClearOceanWelcomeCta(workspace);
    const subEl = findSubEl();
    if (subEl) {
      subEl.style.display = isClearOceanUi() ? '' : '';
    }
  }

  global.OceanWelcomeBanner = {
    mount: mount,
    updateContext: updateContext,
    refreshName: refreshName,
    onDashUiChange: onDashUiChange,
    getDisplayName: getDisplayName,
    stopRotation: stopRotation,
  };

  function boot() {
    if (document.querySelector('[data-ocean-welcome]')) mount();
  }

  global.addEventListener('ocean-profile-updated', function () {
    refreshName();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : global);
