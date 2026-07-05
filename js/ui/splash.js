// splash.js — the artwork's front door (#10): intro, credit, performance
// check, quality picker, camera choice, calibration, and the end screen.
// Text floating in the dark; the world is the interface.

const QUALITY_LABELS = { full: 'Full', light: 'Light', potato: 'Eco' };

const INTRO_COPY =
  'This is a moving artwork — a window into water and stars. It watches ' +
  'how you lean and reach (if you allow the camera) and turns your movement ' +
  'into light. Nothing you do is recorded; nothing leaves this device. It ' +
  'asks only for five minutes, your shoulders, and one honest answer you ' +
  'never have to say out loud.';

const TOUCH = 'ontouchstart' in window;

export function initSplash({ renderer, tracking, begin }) {
  const root = document.getElementById('splash');
  root.className = 'splash';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Ethereal Path introduction');

  root.innerHTML = `
    <div class="splash-inner">
      <h1 class="splash-title">ETHEREAL PATH</h1>
      <p class="splash-subtitle">a five-minute descent for bodies that sit too long</p>
      <hr class="hairline">
      <p class="splash-intro">${INTRO_COPY}</p>
      <p class="splash-credit">
        created by <a href="https://sinaida.eu" target="_blank" rel="noopener">Sinaida Krivchenko — sinaida.eu</a>
      </p>
      <p class="splash-warning">&#9888; real-time graphics — this may run warm on older machines</p>
      <hr class="hairline">
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
    begin();
    dismiss();
    showHint();
  }

  async function startCamera() {
    btnCamera.disabled = true;
    btnPlain.disabled = true;
    await tracking.start({ camera: true });
    if (tracking.mode === 'fallback') {
      fallbackNote.hidden = false;
      begin();
      setTimeout(() => { dismiss(); showHint(); }, 2200);
      return;
    }
    // Calibration: circle, settle, recalibrate, promise of parallax.
    el('.splash-inner').style.display = 'none';
    calibration.hidden = false;
    begin(); // clock + audio start under the fading-in world
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
