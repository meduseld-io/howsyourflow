/**
 * A slow sea behind the hero, and a night sky behind that.
 *
 * The alternative was a looping MP4, which at realistic bitrates would have
 * been 1 to 5MB against a 76KB page, made the video 96% of the download, and
 * still needed a poster image because iOS refuses to autoplay in Low Power
 * Mode. This draws the same idea for a few kilobytes, costs almost nothing to
 * decode, and scales to any viewport without pixelating.
 *
 * Colours come from the stylesheet rather than being carried here, so the theme
 * toggle recolours everything without being told about either theme.
 */

const canvas = document.getElementById('hero-wave');
if (canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * Wavelength is given in crests rather than radians per pixel. A fixed
   * radian figure puts four crests on a desktop and barely one on a phone,
   * which is why the sea looked like a flat diagonal band on mobile; stated as
   * crests it keeps its shape at every width.
   *
   * Dark gets its own alphas. The same values that read as a translucent sea on
   * white turned into solid slabs of navy against near-black, because there is
   * nothing underneath for them to be translucent against.
   */
  /*
   * The canvas covers the whole hero so there is sky to put stars in, but the
   * water must not stretch with it, so each layer's baseline is measured in
   * pixels up from the bottom instead of as a fraction of the canvas. SEA is
   * the depth of that band and matches the figure the stylesheet fades over.
   */
  const SEA = 430;
  const LAYERS = [
    { crests: 1.6, amp: 30, speed: 0.00042, up: 232, light: 0.16, dark: 0.1, stop: 0 },
    { crests: 2.4, amp: 24, speed: -0.00062, up: 163, light: 0.2, dark: 0.13, stop: 1 },
    { crests: 3.5, amp: 17, speed: 0.00092, up: 95, light: 0.24, dark: 0.16, stop: 2 },
  ];
  const baseline = (layer) => height - layer.up;

  /*
   * Stars, in the dark only. Positions are derived from the index rather than
   * Math.random, so they stay put across resizes and theme switches instead of
   * leaping about every time the canvas is refitted.
   */
  const STARS = Array.from({ length: 170 }, (_, i) => {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12345.6789;
    return {
      x: a - Math.floor(a),
      y: b - Math.floor(b),
      r: 0.6 + ((i * 7) % 10) / 9,
      phase: (i * 1.7) % (Math.PI * 2),
      rate: 0.0006 + ((i * 3) % 7) * 0.00018,
    };
  });

  let width = 0;
  let height = 0;
  let colours = [];
  let dark = false;
  let running = false;
  let frame = null;

  /* Backing store scaled to the display, or the curves render soft. Capped at
     2, past which the extra pixels cost more than they show. */
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let sky = '';

  /*
   * Whether the page is actually rendering dark, rather than whether the
   * toggle says it ought to be.
   *
   * An extension that forces dark mode on every site, such as Noir or Dark
   * Reader, rewrites the stylesheet but cannot touch canvas pixels. A canvas
   * that trusts data-theme therefore paints a bright sky onto a page the
   * extension has just turned black, which is exactly what those visitors
   * see. Reading the colour the body actually ended up with follows whichever
   * side won, so the water matches the page either way.
   */
  function rendersDark() {
    const parts = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
    // No colour, or a fully transparent one, leaves nothing to judge, so fall
    // back to the attribute the toggle sets.
    if (!parts || parts.length < 3 || (parts.length > 3 && Number(parts[3]) === 0)) {
      return document.documentElement.dataset.theme === 'dark';
    }
    const [r, g, b] = parts.map(Number);
    // Rec. 601 luma, which is ample for "is this a dark surface or a light one".
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    colours = ['--wave-1', '--wave-2', '--wave-3'].map((n) => style.getPropertyValue(n).trim());
    sky = style.getPropertyValue('--sky').trim();
    dark = rendersDark();
  }

  /*
   * Where the sea begins: the crest of the highest wave, not a fixed fraction.
   *
   * Stars were being placed in the top 55% while the first wave starts at 46%,
   * and because the water is translucent they showed straight through it. The
   * horizon has to come from the waves themselves, or the two drift apart again
   * the next time a layer is retuned.
   */
  function horizon() {
    const top = LAYERS.reduce(
      (highest, layer) => Math.min(highest, baseline(layer) - layer.amp),
      height,
    );
    return Math.max(top, 0);
  }

  /*
   * How far down the sky the stars are allowed. Short of the horizon rather
   * than right down to it, so there is open water between the lowest star and
   * the first crest instead of them crowding the waterline.
   */
  const STAR_CEILING = 0.86;

  function drawStars(time) {
    if (!dark) return;
    const sky = horizon() * STAR_CEILING;
    ctx.fillStyle = colours[2];
    for (const star of STARS) {
      // Clear of the highest crest, so none of them end up underwater.
      const y = star.y * sky;
      const twinkle = 0.35 + 0.3 * Math.sin(time * star.rate + star.phase);
      ctx.globalAlpha = twinkle;
      ctx.beginPath();
      ctx.arc(star.x * width, y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);

    /*
     * Daylight, bounded by the sea rather than by a straight line.
     *
     * Filling a rectangle down to the highest crest leaves a visible horizontal
     * edge wherever the wave dips below it, so the sky is filled to the first
     * wave's own curve and the two meet exactly.
     *
     * Flat rather than a gradient, because the canvas is already masked to fade
     * out towards its top edge, so one fill arrives as page white overhead
     * easing into blue at the waterline.
     *
     * Light theme only: the dark one has a night sky, and filling it would put
     * a slab of colour behind the stars.
     */
    if (!dark && sky) {
      const first = LAYERS[0];
      const base = baseline(first);
      const len = (first.crests * Math.PI * 2) / Math.max(width, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, base + Math.sin(time * first.speed) * first.amp);
      for (let x = 0; x <= width; x += 6) {
        ctx.lineTo(x, base + Math.sin(x * len + time * first.speed) * first.amp);
      }
      ctx.lineTo(width, 0);
      ctx.closePath();
      ctx.fillStyle = sky;
      ctx.fill();
    }

    drawStars(time);

    for (const layer of LAYERS) {
      const base = baseline(layer);
      const len = (layer.crests * Math.PI * 2) / Math.max(width, 1);
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, base + Math.sin(time * layer.speed) * layer.amp);

      /* 6px steps rather than per-pixel: at these wavelengths the difference is
         invisible and it is six times less work per frame. */
      for (let x = 0; x <= width; x += 6) {
        ctx.lineTo(x, base + Math.sin(x * len + time * layer.speed) * layer.amp);
      }

      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.globalAlpha = dark ? layer.dark : layer.light;
      ctx.fillStyle = colours[layer.stop];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function tick(time) {
    draw(time);
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (running || still.matches) return;
    running = true;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = null;
  }

  function reset() {
    fit();
    readTheme();
    draw(performance.now());
  }

  reset();
  if (still.matches) {
    // One frame and no loop: the shape is the point, the motion is decoration.
    draw(0);
  } else {
    start();
  }

  window.addEventListener('resize', reset);

  /* Nothing to animate for someone who is not looking at it. */
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries[0].isIntersecting ? start() : stop();
    }).observe(canvas);
  }

  /* The theme toggle rewrites the custom properties and decides whether there
     are stars, so both are reread rather than captured once at load. */
  new MutationObserver(() => {
    readTheme();
    if (!running) draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  still.addEventListener('change', () => (still.matches ? (stop(), draw(0)) : start()));
}
