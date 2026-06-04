/**
 * Crop image before upload — pick a file, adjust crop, tap Done.
 */
(function (global) {
  const CROPPER_CSS = 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css';
  const CROPPER_JS = 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js';

  let modalEl = null;
  let imgEl = null;
  let cropper = null;
  let objectUrl = null;
  let activeCallbacks = null;
  let assetsPromise = null;

  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = function () {
        resolve();
      };
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    if (global.Cropper) return Promise.resolve();
    const existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
      return new Promise(function (resolve, reject) {
        if (global.Cropper) return resolve();
        existing.addEventListener('load', function () {
          resolve();
        });
        existing.addEventListener('error', reject);
      });
    }
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.onload = function () {
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadCropperAssets() {
    if (!assetsPromise) {
      assetsPromise = loadCss(CROPPER_CSS).then(function () {
        return loadScript(CROPPER_JS);
      });
    }
    return assetsPromise;
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'ocean-image-crop-modal';
    modalEl.className = 'ocean-image-crop-modal';
    modalEl.innerHTML =
      '<div class="ocean-image-crop-backdrop" data-crop-close></div>' +
      '<div class="ocean-image-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="ocean-image-crop-title">' +
      '<h3 id="ocean-image-crop-title">Crop photo</h3>' +
      '<p class="ocean-image-crop-hint">Drag to position. Pinch or scroll to zoom. Tap <strong>Done</strong> when ready.</p>' +
      '<div class="ocean-image-crop-stage"><img id="ocean-image-crop-img" alt="Crop preview" /></div>' +
      '<div class="ocean-image-crop-actions">' +
      '<button type="button" class="btn" data-crop-cancel>Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-crop-done>Done</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
    imgEl = modalEl.querySelector('#ocean-image-crop-img');

    modalEl.querySelector('[data-crop-cancel]').addEventListener('click', closeCancel);
    modalEl.querySelector('[data-crop-close]').addEventListener('click', closeCancel);
    modalEl.querySelector('[data-crop-done]').addEventListener('click', finishCrop);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && modalEl.classList.contains('is-open')) closeCancel();
    });

    return modalEl;
  }

  function destroyCropper() {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    if (imgEl) {
      imgEl.removeAttribute('src');
    }
  }

  function closeCancel() {
    const cb = activeCallbacks && activeCallbacks.onCancel;
    destroyCropper();
    if (modalEl) modalEl.classList.remove('is-open');
    activeCallbacks = null;
    if (typeof cb === 'function') cb();
  }

  function finishCrop() {
    if (!cropper || !activeCallbacks) return;
    const opts = activeCallbacks;
    const aspect = opts.aspectRatio > 0 ? opts.aspectRatio : 1;
    let outW = opts.maxWidth || 640;
    let outH = Math.round(outW / aspect);
    if (opts.maxHeight && outH > opts.maxHeight) {
      outH = opts.maxHeight;
      outW = Math.round(outH * aspect);
    }
    const canvas = cropper.getCroppedCanvas({
      width: outW,
      height: outH,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    if (!canvas) {
      alert('Could not crop this image. Try another photo.');
      return;
    }
    const mime = opts.mimeType || 'image/jpeg';
    const quality = opts.quality != null ? opts.quality : 0.9;
    const doneBtn = modalEl.querySelector('[data-crop-done]');
    if (doneBtn) {
      doneBtn.disabled = true;
      doneBtn.textContent = 'Saving…';
    }
    canvas.toBlob(
      function (blob) {
        if (doneBtn) {
          doneBtn.disabled = false;
          doneBtn.textContent = 'Done';
        }
        if (!blob) {
          alert('Could not prepare the cropped image.');
          return;
        }
        const ext = mime === 'image/png' ? '.png' : '.jpg';
        const fileName = (opts.fileName || 'photo') + ext;
        const file =
          typeof File !== 'undefined'
            ? new File([blob], fileName, { type: mime })
            : blob;
        file.name = fileName;
        const onDone = opts.onDone;
        destroyCropper();
        modalEl.classList.remove('is-open');
        activeCallbacks = null;
        if (typeof onDone === 'function') onDone(file, blob);
      },
      mime,
      quality
    );
  }

  /**
   * @param {{ file: File, aspectRatio?: number, title?: string, maxWidth?: number, maxHeight?: number, mimeType?: string, quality?: number, fileName?: string, onDone: function(File), onCancel?: function }} opts
   */
  function open(opts) {
    const file = opts && opts.file;
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      alert('Please choose an image file.');
      return;
    }

    loadCropperAssets()
      .then(function () {
        ensureModal();
        destroyCropper();

        const title = opts.title || 'Crop photo';
        const titleEl = modalEl.querySelector('#ocean-image-crop-title');
        if (titleEl) titleEl.textContent = title;

        activeCallbacks = {
          aspectRatio: opts.aspectRatio > 0 ? opts.aspectRatio : 1,
          maxWidth: opts.maxWidth || 640,
          maxHeight: opts.maxHeight || 0,
          mimeType: opts.mimeType || 'image/jpeg',
          quality: opts.quality != null ? opts.quality : 0.9,
          fileName: opts.fileName || 'photo',
          onDone: opts.onDone,
          onCancel: opts.onCancel,
        };

        objectUrl = URL.createObjectURL(file);
        imgEl.src = objectUrl;
        modalEl.classList.add('is-open');

        imgEl.onload = function () {
          if (cropper) cropper.destroy();
          cropper = new global.Cropper(imgEl, {
            aspectRatio: activeCallbacks.aspectRatio,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 0.92,
            responsive: true,
            background: false,
            guides: true,
            movable: true,
            zoomable: true,
            scalable: false,
            rotatable: false,
          });
        };
      })
      .catch(function () {
        alert('Could not load the crop tool. Check your internet connection and try again.');
        if (typeof opts.onCancel === 'function') opts.onCancel();
      });
  }

  global.OceanImageCrop = {
    open: open,
    AVATAR: 1,
    PASSPORT: 37 / 44,
  };
})(window);
