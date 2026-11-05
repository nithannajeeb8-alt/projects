/* PocketWise supplied rolling-glyph word animation. Offline-safe fallback included. */
(function () {
  'use strict';
  var boot = document.getElementById('pocketwise-boot-splash');
  var word = document.getElementById('pw-splash-wordmark');
  var GLYPHS = '0123456789₹$€£%+=−×÷';
  var TEXT = 'PocketWise';
  var ROLL_MS = 1300;
  var FIRST_DELAY_MS = 200;
  var STAGGER_MS = 75;
  var done = false;
  var finishTimer = 0;

  function finish() {
    if (done) return;
    done = true;
    window.clearTimeout(finishTimer);
    if (word) {
      word.querySelectorAll('.pw-roll').forEach(function (roll) {
        var count = Number(roll.parentNode.getAttribute('data-count')) || 0;
        roll.style.animation = 'none';
        roll.style.transform = 'translateY(calc(var(--pw-count)*var(--pw-row)*-1))';
        roll.style.color = 'var(--pw-money-green)';
      });
      word.querySelectorAll('.pw-char').forEach(function (char) { char.style.opacity = '1'; });
    }
    window.__pwSplashAnimationDone = true;
    window.dispatchEvent(new Event('pocketwise:splash-animation-finished'));
  }

  window.__pwSplashAnimationDone = false;
  if (!boot || !word) { finish(); return; }

  function build() {
    word.textContent = '';
    var fragment = document.createDocumentFragment();
    TEXT.split('').forEach(function (character, index) {
      var count = 6 + index;
      var delay = (FIRST_DELAY_MS + index * STAGGER_MS) / 1000;
      var column = document.createElement('span');
      column.className = 'pw-char ' + (index < 6 ? 'pw-light' : 'pw-bold');
      column.setAttribute('data-count', String(count));
      column.style.setProperty('--pw-count', String(count));
      column.style.setProperty('--pw-delay', delay.toFixed(3) + 's');

      var finalGlyph = document.createElement('span');
      finalGlyph.className = 'pw-final';
      finalGlyph.textContent = character;
      column.appendChild(finalGlyph);

      var roll = document.createElement('span');
      roll.className = 'pw-roll';
      for (var row = 0; row < count; row += 1) {
        var glyph = document.createElement('i');
        glyph.textContent = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
        roll.appendChild(glyph);
      }
      var settled = document.createElement('i');
      settled.textContent = character;
      roll.appendChild(settled);
      column.appendChild(roll);
      fragment.appendChild(column);
    });
    word.appendChild(fragment);
  }

  function play() {
    var reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}

    function startAnimation() {
      build();
      if (reduced) { finish(); return; }
      // Font metrics are settled before the vertical columns enter the layout.
      var lastDelay = FIRST_DELAY_MS + (TEXT.length - 1) * STAGGER_MS;
      var total = lastDelay + ROLL_MS + 80;
      finishTimer = window.setTimeout(finish, total);
    }

    if (reduced) { startAnimation(); return; }
    // Wait briefly for the supplied Bricolage Grotesque face; never block offline startup.
    var fontReady = (document.fonts && document.fonts.load)
      ? Promise.race([
          document.fonts.load('800 1em "Bricolage Grotesque"').catch(function () {}),
          new Promise(function (resolve) { window.setTimeout(resolve, 700); })
        ])
      : Promise.resolve();
    fontReady.then(startAnimation, startAnimation);
  }

  play();
})();
