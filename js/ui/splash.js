// splash.js — the artwork's front door (#10, reworked in v1.2 for clarity):
// intro, then three sequential glass steps — quality, camera, path — each a
// row of tiles where clicking IS the action (no separate "continue" button).
// Text floating in the dark; the world is the interface.

// The 5-second promise, then how it works, then privacy — in that order.
const PROMISE_COPY =
  'a short movement ritual for people who live at their screens';
const HOW_COPY =
  'luminous rings gate the path. each ring closes when your body actually ' +
  'moves — a neck turn, a shoulder roll, a reach. minutes later you surface, warmer.';
const PRIVACY_COPY =
  'the camera (if you allow it) verifies movement on this device only — ' +
  'nothing is recorded, nothing leaves.';
const PLAYLIST_URL = 'https://open.spotify.com/playlist/394UQrjBknxawNXIY8miep';

const TOUCH = 'ontouchstart' in window;

// Plain text — the wordmark used to be individual goo-filtered letter spans,
// but that broke word-wrap on narrow screens and mangled legibility. The
// .psy ripple/chroma treatment (css/main.css) now carries the "alive" feel.
function escapeHTML(text) {
  return text.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function initSplash({ renderer, tracking, begin }) {
  const root = document.getElementById('splash');
  root.className = 'splash';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Ethereal Path introduction');

  root.innerHTML = `
    <div class="splash-inner glass">
      <h1 class="wordmark">${escapeHTML('ethereal path')}</h1>
      <p class="splash-subtitle">${PROMISE_COPY}</p>
      <hr class="hairline">
      <p class="splash-intro">${HOW_COPY}</p>
      <p class="splash-privacy">${PRIVACY_COPY}</p>
      <div class="step-area"></div>
      <p class="splash-credit">
        created by <a href="https://sinaida.eu" target="_blank" rel="noopener">Sinaida Krivchenko — sinaida.eu</a>
      </p>
    </div>
    <div class="calibration" hidden>
      <div class="cal-plate glass">
        <div class="cal-circle"></div>
        <p class="cal-text">sit comfortably — rest your eyes on the circle</p>
      </div>
    </div>
  `;

  const el = (sel) => root.querySelector(sel);
  const stepArea = el('.step-area');
  const calibration = el('.calibration');
  const calText = el('.cal-text');

  let deckId = 'desk-reset';
  let benchmarkReady = false;
  let benchTier = 'full';
  let benchMedian = '0';

  // Swap the step panel with a short fade; content is rebuilt each time so
  // event listeners never go stale.
  // `bind` runs right after the new panel is actually in the DOM — the
  // mount itself is deferred (fade-out delay) whenever an old panel exists,
  // so binding listeners synchronously after calling renderStep() would
  // attach them to a NodeList queried before the new markup ever landed.
  function renderStep(html, bind) {
    const old = stepArea.querySelector('.step-panel');
    const mount = () => {
      stepArea.innerHTML = `<div class="step-panel">${html}</div>`;
      if (bind) bind();
      requestAnimationFrame(() => stepArea.querySelector('.step-panel').classList.remove('step-out'));
    };
    if (old) {
      old.classList.add('step-out');
      setTimeout(mount, 260);
    } else {
      mount();
    }
  }

  // Every step past the first offers a way back to the top of the flow.
  function backPillHTML() {
    return '<button class="step-back" data-back>&larr; main menu</button>';
  }
  function bindBackPill() {
    const back = stepArea.querySelector('[data-back]');
    if (back) back.addEventListener('click', showQualityStep);
  }

  // ---- Step 1: quality (Full or Light only — Eco added noise without ----
  // ---- adding a real choice most people needed) ----
  function showQualityStep() {
    const effectiveTier = benchTier === 'potato' ? 'light' : benchTier;
    if (benchTier === 'potato') renderer.setQuality('light');
    renderStep(`
      <p class="step-label">this machine measured ${benchMedian}ms per frame</p>
      <div class="tile-row">
        <button class="tile${effectiveTier === 'full' ? ' selected' : ''}" data-q="full">Full</button>
        <button class="tile${effectiveTier === 'light' ? ' selected' : ''}" data-q="light">Light</button>
      </div>
    `, () => {
      stepArea.querySelectorAll('[data-q]').forEach((tile) => {
        tile.addEventListener('click', () => {
          renderer.setQuality(tile.dataset.q);
          stepArea.querySelectorAll('[data-q]').forEach((t) => t.classList.toggle('selected', t === tile));
          setTimeout(showCameraStep, 350);
        });
      });
    });
  }

  // ---- Step 2: camera ----
  function showCameraStep() {
    renderStep(`
      ${backPillHTML()}
      <p class="step-label">choose how you'd like to be seen</p>
      <div class="tile-row">
        <button class="tile" data-cam="yes">with camera</button>
        <button class="tile" data-cam="no">without camera</button>
      </div>
    `, () => {
      bindBackPill();
      const camTiles = stepArea.querySelectorAll('[data-cam]');
      camTiles.forEach((tile) => {
        tile.addEventListener('click', async () => {
          camTiles.forEach((t) => (t.disabled = true));
          if (tile.dataset.cam === 'no') {
            showPathStep();
            return;
          }
          await tracking.start({ camera: true });
          if (tracking.mode === 'fallback') {
            renderStep(`
              <p class="step-label">choose how you'd like to be seen</p>
              <p class="splash-fallback-note">the camera didn't answer — guiding by hand instead</p>
            `);
            setTimeout(showPathStep, 1800);
            return;
          }
          runCalibration();
        });
      });
    });
  }

  function runCalibration() {
    root.querySelector('.splash-inner').style.display = 'none';
    calibration.hidden = false;
    calText.textContent = 'sit comfortably — rest your eyes on the circle';
    setTimeout(() => {
      tracking.recalibrate();
      calText.textContent = 'when you lean, the world will lean with you';
      setTimeout(() => {
        calibration.hidden = true;
        root.querySelector('.splash-inner').style.display = '';
        showPathStep();
      }, 2000);
    }, 3000);
  }

  // ---- Step 3: path (clicking a deck begins the session) ----
  function showPathStep() {
    renderStep(`
      ${backPillHTML()}
      <p class="step-label">choose your path</p>
      <div class="tile-row">
        <button class="tile deck-tile" data-deck="desk-reset">
          <span class="deck-title">desk reset</span>
          <span class="deck-sub">5 minutes · seated</span>
        </button>
        <button class="tile deck-tile" data-deck="full-surface">
          <span class="deck-title">full surface</span>
          <span class="deck-sub">8 minutes · you'll need to stand up</span>
        </button>
      </div>
    `, () => {
      bindBackPill();
      stepArea.querySelectorAll('[data-deck]').forEach((tile) => {
        tile.addEventListener('click', () => {
          deckId = tile.dataset.deck;
          stepArea.querySelectorAll('[data-deck]').forEach((t) => (t.disabled = true));
          tile.classList.add('selected');
          begin({ deckId });
          dismiss();
          showHint();
        });
      });
    });
  }

  function showHint() {
    const overlay = document.getElementById('overlay');
    const hint = document.createElement('p');
    hint.className = 'hint text-plate';
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

  return {
    setBenchmark(tier, median) {
      benchmarkReady = true;
      benchTier = tier;
      benchMedian = median;
      showQualityStep();
    },
    async showEnd() {
      root.style.display = '';
      root.classList.add('fading-in');
      let quote = 'thank you for the five minutes you gave your body.';
      try {
        const data = await (await fetch('data/mantras.json')).json();
        const list = Array.isArray(data.mantras) ? data.mantras : [];
        if (list.length) quote = list[Math.floor(Math.random() * list.length)];
      } catch (err) { /* keep the fallback line */ }
      root.innerHTML = `
        <div class="splash-inner splash-end glass">
          <h1 class="wordmark">${escapeHTML('you\'re back')}</h1>
          <p class="splash-subtitle">thank you — the path remains, return when your shoulders ask for it</p>
          <p class="end-quote">${escapeHTML(quote)}</p>
          <div class="tile-row">
            <a class="tile" href="${PLAYLIST_URL}" target="_blank" rel="noopener">unwind with a playlist</a>
            <button class="tile btn-again">begin again</button>
          </div>
          <p class="splash-credit">made by <a href="https://sinaida.eu" target="_blank" rel="noopener">Sinaida Krivchenko · sinaida.eu</a></p>
        </div>`;
      root.querySelector('.btn-again').addEventListener('click', () => location.reload());
    },
  };
}
