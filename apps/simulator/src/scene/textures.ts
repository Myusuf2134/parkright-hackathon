/** Procedural textures, drawn from the seeded PRNG so every run looks identical. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { rng } from '../sim/prng.ts';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Concrete/asphalt: base colour with fine grain, a few stains and hairline cracks. */
export function surfaceTexture(base: [number, number, number], grain: number, key: string, repeat: number): CanvasTexture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rng(1, 'texture', key);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (r.next() - 0.5) * grain;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r.range(0.03, 0.08)})`;
    ctx.beginPath();
    ctx.ellipse(r.range(0, size), r.range(0, size), r.range(10, 60), r.range(8, 40), r.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    let x = r.range(0, size);
    let y = r.range(0, size);
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) ctx.lineTo((x += r.range(-25, 25)), (y += r.range(-25, 25)));
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Office facade: a grid of windows; `lit` picks which glow at night. */
export function facadeTexture(key: string, lit: boolean): CanvasTexture {
  const [c, ctx] = canvas(256);
  const r = rng(1, 'facade', key);
  ctx.fillStyle = lit ? '#000' : '#6f747a';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 8; y < 256; y += 21) {
    for (let x = 6; x < 256; x += 16) {
      if (lit) ctx.fillStyle = r.chance(0.35) ? `rgba(255,${r.int(200, 235)},${r.int(140, 190)},1)` : '#000';
      else ctx.fillStyle = r.chance(0.5) ? '#3c4651' : '#56606b';
      ctx.fillRect(x, y, 10, 13);
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}
