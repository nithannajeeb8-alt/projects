/* PocketWise monoline wordmark animation. No external runtime dependencies. */
(function () {
  'use strict';

  const gate = document.getElementById('pocketwise-boot-splash');
  const wordmark = document.getElementById('pw-splash-wordmark');
  const paths = wordmark ? Array.from(wordmark.querySelectorAll('.pw-writing-stroke')) : [];
  window.__pwSplashAnimationDone = false;

  function finish() {
    paths.forEach(path => {
      path.style.strokeDasharray = 'none';
      path.style.strokeDashoffset = '0';
      path.style.opacity = '1';
    });
    window.__pwSplashAnimationDone = true;
    window.dispatchEvent(new Event('pocketwise:splash-animation-finished'));
  }

  if (!gate || !wordmark || paths.length === 0) {
    finish();
    return;
  }

  let reducedMotion = false;
  try {
    reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {}

  const supportsWebAnimations = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const lengths = [];
  try {
    paths.forEach(path => {
      const length = path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) throw new Error('Invalid monoline stroke length.');
      lengths.push(length);
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      path.style.opacity = '1';
    });
  } catch (_) {
    finish();
    return;
  }

  if (reducedMotion || !supportsWebAnimations) {
    finish();
    return;
  }

  const totalPenLift = paths.slice(1).reduce((sum, path, index) => {
    const previous = paths[index];
    return sum + (previous.dataset.glyph === path.dataset.glyph ? 16 : 36);
  }, 0);
  const targetDuration = 1250;
  const drawingDuration = Math.max(420, targetDuration - totalPenLift);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const animations = [];
  let delay = 0;

  try {
    paths.forEach((path, index) => {
      const duration = drawingDuration * (lengths[index] / totalLength);
      const animation = path.animate(
        [
          { strokeDashoffset: lengths[index] },
          { strokeDashoffset: 0 }
        ],
        {
          duration: Math.max(8, duration),
          delay,
          easing: 'linear',
          fill: 'forwards'
        }
      );
      animations.push(animation);
      delay += duration;
      if (index < paths.length - 1) {
        delay += paths[index].dataset.glyph === paths[index + 1].dataset.glyph ? 16 : 36;
      }
    });
  } catch (_) {
    animations.forEach(animation => { try { animation.cancel(); } catch (_) {} });
    finish();
    return;
  }

  Promise.all(animations.map(animation => animation.finished))
    .then(() => finish())
    .catch(() => finish());
})();
