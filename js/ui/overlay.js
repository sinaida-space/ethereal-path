// overlay.js — in-journey text layer (#10): questions materialize when a ray
// is taken, movement cues drift through the lower third, a mute toggle sits
// in the corner, and sessionEnd hands control back to the splash.

import { events } from '../events.js';

export function initOverlay({ audio, splash }) {
  const root = document.getElementById('overlay');

  const live = document.createElement('div');
  live.setAttribute('aria-live', 'polite');
  live.className = 'overlay-live';
  root.appendChild(live);

  const questionEl = document.createElement('p');
  questionEl.className = 'question-text text-plate';
  live.appendChild(questionEl);

  const cueEl = document.createElement('p');
  cueEl.className = 'cue-text text-plate';
  live.appendChild(cueEl);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'corner-pill mute-btn';
  muteBtn.textContent = '◦ sound';
  muteBtn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    muteBtn.textContent = audio.muted ? '◦ muted' : '◦ sound';
  });
  root.appendChild(muteBtn);

  let questionTimers = [];
  let cueTimers = [];
  const clearTimers = (arr) => { arr.forEach(clearTimeout); arr.length = 0; };

  // fade-in 1.5s, hold 9s, fade 4s
  events.on('rayTaken', ({ question }) => {
    clearTimers(questionTimers);
    questionEl.textContent = question;
    questionEl.classList.add('visible');
    questionTimers.push(setTimeout(() => {
      questionEl.classList.remove('visible');
    }, 1500 + 9000));
  });

  // fade-in 1s, hold 5s, fade 2s
  events.on('cue', ({ text }) => {
    clearTimers(cueTimers);
    cueEl.textContent = text;
    cueEl.classList.add('visible');
    cueTimers.push(setTimeout(() => {
      cueEl.classList.remove('visible');
    }, 1000 + 5000));
  });

  events.on('sessionEnd', () => {
    setTimeout(() => splash.showEnd(), 4000);
  });
}
