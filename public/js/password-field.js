/**
 * Adds show/hide toggle to password inputs across login and settings forms.
 */
(function (global) {
  function enhancePasswordInput(input) {
    if (!input || input.type !== 'password' || input.dataset.passwordEnhanced === '1') return;
    const parent = input.parentElement;
    if (!parent) return;
    if (parent.classList.contains('password-field-wrap')) return;

    input.dataset.passwordEnhanced = '1';
    const wrap = document.createElement('div');
    wrap.className = 'password-field-wrap';
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle-btn';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Show';
    btn.addEventListener('click', function () {
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    });
    wrap.appendChild(btn);
  }

  function enhanceAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('input[type="password"]').forEach(enhancePasswordInput);
  }

  global.OceanPasswordField = {
    enhanceAll: enhanceAll,
    enhancePasswordInput: enhancePasswordInput,
  };

  function boot() {
    enhanceAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('input[type="password"]')) {
          enhancePasswordInput(node);
        } else if (node.querySelectorAll) {
          enhanceAll(node);
        }
      });
    });
  }) : null;

  if (observer && document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})(typeof window !== 'undefined' ? window : global);
