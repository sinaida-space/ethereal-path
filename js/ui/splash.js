// splash.js — the artwork's front door (#10): intro, credit, performance
// check, quality picker, camera choice, calibration, and the end screen.
// Text floating in the dark; the world is the interface.

const QUALITY_LABELS = { full: 'Full', light: 'Light', potato: 'Eco' };

// The 5-second promise, then how it works, then privacy — in that order.
const PROMISE_COPY =
  'a short movement ritual for people who live at their screens';
const HOW_COPY =
  'luminous rings gate the path. each ring closes when your body actually ' +
  'moves — a neck turn, a shoulder roll, a reach. minutes later you surface, warmer.';
const PRIVACY_COPY =
  'the camera (if you allow it) verifies movement on this device only — ' +
  'nothing is recorded, nothing leaves.';

// Deck ids must match data/decks.json.
const TOUCH = 'ontouchstart' in window;

// Wordmark letters as individual spans so the goo filter can merge them
// while they drift on offset phases — text behaving like water.
function wordmarkHTML(text) {
  return [...text].map((ch, i) =>
    ch === ' '
      ? '<span class="wm-gap"></span>'
      : `<span class="wm-l" style="--i:${i}">${ch}</span>`
  ).join('');
}

export function initSplash({ renderer, tracking, begin }) {
  const root = document.getElementById('splash');
  root.className = 'splash';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Ethereal Path introduction');

  root.innerHTML = `
    <div class="splash-inner glass">
      <h1 class="wordmark" aria-label="ethereal path">${wordmarkHTML('ethereal path')}</h1>
      <p class="splash-subtitle">${PROMISE_COPY}</p>
      <hr class="hairline">
      <p class="splash-intro">${HOW_COPY}</p>
      <p class="splash-privacy">${PRIVACY_COPY}</p>
      <div class="deck-picker" role="radiogroup" aria-label="choose your practice">
        <button class="deck-card selected" data-deck="desk-reset" role="radio" aria-checked="true">
          <span class="deck-title">desk reset</span>
          <span class="deck-sub">5 minutes · seated</span>
        </button>
        <button class="deck-card" data-deck="full-surface" role="radio" aria-checked="false">
          <span class="deck-title">full surface</span>
          <span class="deck-sub">8 minutes · you will rise</span>
        </button>
      </div>
      <p class="splash-bench shimmer">measuring this machine's light&hellip;</p>
      <p class="splash-quality" hidden>
        quality:
        <select class="quality-select" aria-label="rendering quality">
          <option value="full">Full</option>
          <option value="light">Light</option>
          <option value="potato">Eco</option>
        </select>
      </p>
      <p class="splash-eco-note" hidden>a gentler version has been prepared for this machine</p>
      <div class="splash-buttons">
        <button class="btn btn-camera" disabled>begin with camera</button>
        <button class="btn btn-plain" disabled>begin without camera</button>
      </div>
      <p class="splash-fallback-note" hidden>the camera didn't answer — guiding by hand instead</p>
      <p class="splash-credit">
        created by <a href="https://sinaida.eu" target="_blank" rel="noopener">Sinaida Krivchenko — sinaida.eu</a>
      </p>
    </div>
    <div class="calibration" hidden>
      <div class="cal-circle"></div>
      <p class="cal-text">sit comfortably — rest your eyes on the circle</p>
    </div>
  `;

  const el = (sel) => root.querySelector(sel);
  const benchLine = el('.splash-bench');
  const qualityLine = el('.splash-quality');
  const qualitySelect = el('.quality-select');
  const ecoNote = el('.splash-eco-note');
  const btnCamera = el('.btn-camera');
  const btnPlain = el('.btn-plain');
  const fallbackNote = el('.splash-fallback-note');
  const calibration = el('.calibration');
  const calText = el('.cal-text');

  qualitySelect.addEventListener('change', () => {
    renderer.setQuality(qualitySelect.value);
  });

  // Deck picker: single-select radio behaviour.
  let deckId = 'desk-reset';
  root.querySelectorAll('.deck-card').forEach((card) => {
    card.addEventListener('click', () => {
      deckId = card.dataset.deck;
      root.querySelectorAll('.deck-card').forEach((c) => {
        const on = c === card;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    });
  });

  function showHint() {
    const overlay = document.getElementById('overlay');
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = TOUCH
      ? 'drag to drift — press and hold to reach'
      : 'move your mouse to drift — click and hold to reach for the light';
    overlay.appendChild(hint);
    requestAnimationFrame(() => hint.classList.add('visible'));
    setTimeout(() => {
      hint.classList.remove('visible');
      setTimeout(() => hint.remove(), 1200);
    }, 3500);
  }

  function dismiss() {
    root.classList.add('fading');
    setTimeout(() => { root.style.display = 'none'; root.classList.remove('fading'); }, 1600);
  }

  function startPlain() {
    // begin() synchronously inside the click chain (AudioContext gesture rule).
    begin({ deckId });
    dismiss();
    showHint();
  }

  async function startCamera() {
    btnCamera.disabled = true;
    btnPlain.disabled = true;
    await tracking.start({ camera: true });
    if (tracking.mode === 'fallback') {
      fallbackNote.hidden = false;
      begin({ deckId });
      setTimeout(() => { dismiss(); showHint(); }, 2200);
      return;
    }
    // Calibration: circle, settle, recalibrate, promise of parallax.
    el('.splash-inner').style.display = 'none';
    calibration.hidden = false;
    begin({ deckId }); // clock + audio start under the fading-in world
    setTimeout(() => {
      tracking.recalibrate();
      calText.textContent = 'when you lean, the world will lean with you';
      setTimeout(dismiss, 2000);
    }, 3000);
  }

  btnPlain.addEventListener('click', startPlain);
  btnCamera.addEventListener('click', startCamera);

  return {
    setBenchmark(tier, median) {
      benchLine.classList.remove('shimmer');
      benchLine.textContent = `this machine measured ${median}ms per frame`;
      qualityLine.hidden = false;
      qualitySelect.value = tier;
      if (tier === 'potato') ecoNote.hidden = false;
      btnCamera.disabled = false;
      btnPlain.disabled = false;
    },
    showEnd() {
      root.style.display = '';
      root.classList.add('fading-in');
      root.innerHTML = `
        <div class="splash-inner splash-end">
          <h1 class="splash-title">you're back</h1>
          <p class="splash-subtitle">the path remains — return when your shoulders ask for it</p>
          <div class="splash-buttons">
            <button class="btn btn-again">begin again</button>
          </div>
          <p class="splash-credit">made by <a href="https://sinaida.eu" target="_blank" rel="noopener">Sinaida Krivchenko · sinaida.eu</a></p>
        </div>`;
      root.querySelector('.btn-again').addEventListener('click', () => location.reload());
    },
  };
}
