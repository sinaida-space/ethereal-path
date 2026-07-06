export const QUALITY = {
  full:   { scale: 1.0,  steps: 96, bloom: 'full'  },
  light:  { scale: 0.6,  steps: 48, bloom: 'cheap' },
  potato: { scale: 0.45, steps: 32, bloom: 'none'  },
};
// Drift time only — the clock holds during exercise stations, so a full
// session lands around 5–6 minutes of wall time.
export const JOURNEY_DURATION_S = 150;
