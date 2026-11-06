// One Euro filter (Casiez et al., CHI 2012): low jitter while standing still, little lag when moving.
import type { Landmark } from "./layout";

export class OneEuroFilter {
  private prev: number | null = null;
  private dPrev = 0;
  private tPrev = 0;
  constructor(
    private minCutoff = 1.5,
    private beta = 8,
    private dCutoff = 1,
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** `t` in seconds. */
  filter(x: number, t: number): number {
    if (this.prev === null) {
      this.prev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const dx = (x - this.prev) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    this.dPrev = ad * dx + (1 - ad) * this.dPrev;
    const a = this.alpha(this.minCutoff + this.beta * Math.abs(this.dPrev), dt);
    this.prev = a * x + (1 - a) * this.prev;
    return this.prev;
  }

  reset() {
    this.prev = null;
    this.dPrev = 0;
  }
}

/** Smooths all landmarks of one pose (normalized 0..1 coordinates). */
export class LandmarkSmoother {
  private fx: OneEuroFilter[] = [];
  private fy: OneEuroFilter[] = [];
  private vis: number[] = [];

  smooth(lms: Landmark[], t: number): Landmark[] {
    return lms.map((l, i) => {
      this.fx[i] ??= new OneEuroFilter();
      this.fy[i] ??= new OneEuroFilter();
      this.vis[i] = this.vis[i] === undefined ? l.visibility : this.vis[i] * 0.6 + l.visibility * 0.4;
      return { x: this.fx[i].filter(l.x, t), y: this.fy[i].filter(l.y, t), visibility: this.vis[i] };
    });
  }

  reset() {
    this.fx = [];
    this.fy = [];
    this.vis = [];
  }
}
