// Draws one try-on frame: camera image → garments (triangle-mesh warps) → head and hands from the camera
// image on top, so the face stays in front of collars and hands in front of the shirt.
import { affineFromTriangles, dist, mid, norm, sub, triArea, type P } from "../../../shared/tryon/geometry";
import { bodyFromPose, layoutGarment, type Body, type Fit, type Landmark, type Tri } from "../../../shared/tryon/layout";
import type { PreparedGarment } from "./garment";

export interface PersonMask {
  data: Float32Array;
  width: number;
  height: number;
}

export interface RenderOptions {
  fit: Fit;
  /** Dim the garments to the room brightness and add a soft shadow. */
  lightMatch: boolean;
  /** Keep head and hands in front of the garments (needs the person mask). */
  occlusion: boolean;
  /** Mean luminance of the camera image (0..1). */
  sceneLuma: number;
}

export interface RenderReport {
  body: boolean;
  /** Garments that could not be placed, with the reason. */
  missing: { name: string; reason: string }[];
}

function drawTri(ctx: CanvasRenderingContext2D, img: CanvasImageSource, t: Tri, k: number) {
  const src = t.src.map((p) => ({ x: p.x * k, y: p.y * k })) as [P, P, P];
  if (Math.abs(triArea(t.dst)) < 0.5 || Math.abs(triArea(src)) < 0.5) return;
  const m = affineFromTriangles(src, t.dst);
  if (!m) return;
  // Grow the clip triangle by ~0.7 px so neighbouring triangles overlap instead of leaving hairline gaps.
  const c = { x: (t.dst[0].x + t.dst[1].x + t.dst[2].x) / 3, y: (t.dst[0].y + t.dst[1].y + t.dst[2].y) / 3 };
  const d = t.dst.map((p) => {
    const l = dist(p, c) || 1;
    return { x: c.x + ((p.x - c.x) * (l + 0.7)) / l, y: c.y + ((p.y - c.y) * (l + 0.7)) / l };
  });
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d[0].x, d[0].y);
  ctx.lineTo(d[1].x, d[1].y);
  ctx.lineTo(d[2].x, d[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  const x0 = Math.max(0, Math.floor(Math.min(src[0].x, src[1].x, src[2].x)) - 2);
  const y0 = Math.max(0, Math.floor(Math.min(src[0].y, src[1].y, src[2].y)) - 2);
  const x1 = Math.ceil(Math.max(src[0].x, src[1].x, src[2].x)) + 2;
  const y1 = Math.ceil(Math.max(src[0].y, src[1].y, src[2].y)) + 2;
  const iw = (img as HTMLCanvasElement).width;
  const ih = (img as HTMLCanvasElement).height;
  const w = Math.min(iw, x1) - x0;
  const h = Math.min(ih, y1) - y0;
  if (w > 0 && h > 0) ctx.drawImage(img, x0, y0, w, h, x0, y0, w, h);
  ctx.restore();
}

export class TryOnRenderer {
  private layer = document.createElement("canvas");
  private occ = document.createElement("canvas");
  private maskCanvas = document.createElement("canvas");

  render(ctx: CanvasRenderingContext2D, frame: CanvasImageSource, w: number, h: number, landmarks: Landmark[] | null, mask: PersonMask | null, garments: PreparedGarment[], opts: RenderOptions): RenderReport {
    ctx.drawImage(frame, 0, 0, w, h);
    const body = landmarks ? bodyFromPose(landmarks) : null;
    if (!body) return { body: false, missing: [] };

    for (const c of [this.layer, this.occ]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
    const lctx = this.layer.getContext("2d")!;
    lctx.clearRect(0, 0, w, h);
    const missing: RenderReport["missing"] = [];
    const sorted = [...garments].sort((a, b) => a.order - b.order);
    const late: PreparedGarment[] = [];
    for (const g of sorted) {
      // Headwear goes on after the head has been put back in front of the collar.
      if (g.kind === "head") {
        late.push(g);
        continue;
      }
      this.drawGarment(lctx, g, body, opts, missing);
    }

    ctx.save();
    if (opts.lightMatch) {
      const b = Math.max(0.72, Math.min(1.04, 0.62 + 0.8 * opts.sceneLuma));
      ctx.filter = `brightness(${b.toFixed(3)})`;
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = Math.max(4, 0.05 * body.T);
      ctx.shadowOffsetY = 0.012 * body.T;
    }
    ctx.drawImage(this.layer, 0, 0);
    ctx.restore();

    if (opts.occlusion && mask) this.drawOccluders(ctx, frame, w, h, body, mask);

    if (late.length) {
      lctx.clearRect(0, 0, w, h);
      for (const g of late) this.drawGarment(lctx, g, body, opts, missing);
      ctx.save();
      if (opts.lightMatch) ctx.filter = `brightness(${Math.max(0.72, Math.min(1.04, 0.62 + 0.8 * opts.sceneLuma)).toFixed(3)})`;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }
    return { body: true, missing };
  }

  private drawGarment(ctx: CanvasRenderingContext2D, g: PreparedGarment, body: Body, opts: RenderOptions, missing: RenderReport["missing"]) {
    const r = layoutGarment(g.shape, body, { size: opts.fit.size * g.sizeBoost, length: opts.fit.length }, { legCoverage: g.legCoverage });
    if (!r.ok) {
      missing.push({ name: g.name, reason: r.reason });
      return;
    }
    for (const p of r.pieces) {
      const img = g.pieces[p.piece] ?? g.image;
      for (const t of p.tris) drawTri(ctx, img, t, g.scale);
    }
  }

  /** Head (down to the chin) and hands from the camera frame, cut out by the person mask. */
  private drawOccluders(ctx: CanvasRenderingContext2D, frame: CanvasImageSource, w: number, h: number, b: Body, mask: PersonMask) {
    const mc = this.maskCanvas;
    if (mc.width !== mask.width || mc.height !== mask.height) {
      mc.width = mask.width;
      mc.height = mask.height;
    }
    const mctx = mc.getContext("2d")!;
    const img = mctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) img.data[i * 4 + 3] = Math.max(0, Math.min(255, (mask.data[i] * 1.5 - 0.25) * 255));
    mctx.putImageData(img, 0, 0);

    const o = this.occ.getContext("2d")!;
    o.save();
    o.clearRect(0, 0, w, h);
    o.globalCompositeOperation = "source-over";
    o.filter = `blur(${Math.max(2, 0.015 * b.T).toFixed(1)}px)`;
    o.fillStyle = "#fff";
    const eyes = b.eyeL && b.eyeR ? mid(b.eyeL, b.eyeR) : b.nose;
    if (eyes) {
      const span = b.earL && b.earR ? dist(b.earL, b.earR) : b.eyeL && b.eyeR ? dist(b.eyeL, b.eyeR) * 1.9 : 0.45 * b.D;
      const across = b.earL && b.earR ? norm(sub(b.earR, b.earL)) : b.shoulderDir;
      const up = { x: across.y, y: -across.x };
      const chin = b.mouth ? { x: b.mouth.x + (b.mouth.x - eyes.x) * 1.1, y: b.mouth.y + (b.mouth.y - eyes.y) * 1.1 } : { x: eyes.x - up.x * 0.75 * span, y: eyes.y - up.y * 0.75 * span };
      const top = { x: eyes.x + up.x * 1.0 * span, y: eyes.y + up.y * 1.0 * span };
      const c = mid(chin, top);
      o.beginPath();
      o.ellipse(c.x, c.y, 0.72 * span, dist(chin, top) / 2, Math.atan2(across.y, across.x), 0, Math.PI * 2);
      o.fill();
    }
    const r = 0.11 * b.D;
    for (const p of b.hands) {
      o.beginPath();
      o.arc(p.x, p.y, r, 0, Math.PI * 2);
      o.fill();
    }
    o.filter = "none";
    o.globalCompositeOperation = "destination-in";
    o.drawImage(mc, 0, 0, w, h);
    o.globalCompositeOperation = "source-in";
    o.drawImage(frame, 0, 0, w, h);
    o.restore();
    ctx.drawImage(this.occ, 0, 0);
  }
}

/** Mean luminance (0..1) of an image, sampled on a tiny canvas. */
export function measureLuma(src: CanvasImageSource, probe: HTMLCanvasElement): number {
  probe.width = 24;
  probe.height = 18;
  const p = probe.getContext("2d", { willReadFrequently: true })!;
  p.drawImage(src, 0, 0, 24, 18);
  const d = p.getImageData(0, 0, 24, 18).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4) / 255;
}
