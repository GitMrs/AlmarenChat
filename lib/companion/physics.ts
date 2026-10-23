import { type KoroModel, stepClothSprings, stepPendantSprings } from '@/lib/companion/vendor/koro-core.js';

interface Vector { X: number; Y: number }
interface Normalization { Minimum: number; Default: number; Maximum: number }
interface PhysicsVertex {
  Position: Vector;
  Mobility: number;
  Delay: number;
  Acceleration: number;
  Radius: number;
}
interface PhysicsSetting {
  Id: string;
  Input: { Source: { Id: string }; Weight: number; Type: string; Reflect: boolean }[];
  Output: { Destination: { Id: string }; VertexIndex: number; Scale: number; Weight: number; Type: string; Reflect: boolean }[];
  Vertices: PhysicsVertex[];
  Normalization: { Position: Normalization; Angle: Normalization };
}
export interface CompanionPhysics {
  PhysicsSettings: PhysicsSetting[];
  Meta?: { Fps?: number; EffectiveForces?: { Wind?: Vector } };
}

const GRAVITY_ROT_DIVISOR = 5;
const WEIGHT_SCALE = 100;
const SNAP_THRESHOLD = 0.001;
const MAX_REMAIN = 5;

function normalizeInput(
  val: number,
  pMin: number,
  pMax: number,
  nMin: number,
  nMax: number,
  nDef: number,
  reflect: boolean
): number {
  const hi = Math.max(pMin, pMax);
  const lo = Math.min(pMin, pMax);
  val = Math.min(hi, Math.max(lo, val));
  const outMin = Math.min(nMin, nMax);
  const outMax = Math.max(nMin, nMax);
  const mid = lo + (hi - lo) / 2;
  const diff = val - mid;
  let result = 0;
  if (diff > 0) {
    const span = hi - mid;
    if (span !== 0) result = diff * ((outMax - nDef) / span) + nDef;
  } else if (diff < 0) {
    const span = lo - mid;
    if (span !== 0) result = diff * ((outMin - nDef) / span) + nDef;
  } else {
    result = nDef;
  }
  return reflect ? result : -result;
}

function signedAngleBetween(x1: number, y1: number, x2: number, y2: number): number {
  let angle = Math.atan2(y2, x2) - Math.atan2(y1, x1);
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

interface InternalInput {
  id: string;
  type: string;
  weight: number;
  reflect: boolean;
  idx: number;
}

interface InternalOutput {
  id: string;
  type: string;
  vertex: number;
  angleScale: number;
  weight: number;
  reflect: boolean;
  idx: number;
}

interface InternalParticle {
  mobility: number;
  delay: number;
  acceleration: number;
  radius: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  vx: number;
  vy: number;
  lastGX: number;
  lastGY: number;
}

interface InternalSetting {
  id: string;
  inputs: InternalInput[];
  outputs: InternalOutput[];
  particles: InternalParticle[];
  normPos: { min: number; max: number; def: number };
  normAng: { min: number; max: number; def: number };
  curOut: number[];
  prevOut: number[];
}

export class PhysicsPlayer {
  private gravity = { x: 0, y: -1 };
  private wind = { x: 0, y: 0 };
  private fps: number;
  private settings: InternalSetting[];
  private windSettings: Set<string> | null;
  private remain = 0;
  private _caches: Float64Array | null = null;
  private _inputCaches: Float64Array | null = null;
  private _pm: KoroModel['man']['parameters'] = [];
  private _cMin: number[] = [];
  private _cMax: number[] = [];

  constructor(data: CompanionPhysics, windSettings?: readonly string[]) {
    this.fps = data.Meta?.Fps || 0;
    this.windSettings = windSettings && windSettings.length > 0 ? new Set(windSettings) : null;
    this.settings = (data.PhysicsSettings || []).map(s => ({
      id: s.Id,
      inputs: (s.Input || []).map(inp => ({
        id: inp.Source.Id,
        type: inp.Type,
        weight: inp.Weight,
        reflect: !!inp.Reflect,
        idx: -1,
      })),
      outputs: (s.Output || []).map(out => ({
        id: out.Destination.Id,
        type: out.Type,
        vertex: out.VertexIndex,
        angleScale: out.Scale,
        weight: out.Weight,
        reflect: !!out.Reflect,
        idx: -1,
      })),
      particles: (s.Vertices || []).map(v => ({
        mobility: v.Mobility,
        delay: v.Delay,
        acceleration: v.Acceleration,
        radius: v.Radius,
        x: 0,
        y: 0,
        lastX: 0,
        lastY: 0,
        vx: 0,
        vy: 0,
        lastGX: 0,
        lastGY: 1,
      })),
      normPos: {
        min: s.Normalization.Position.Minimum,
        max: s.Normalization.Position.Maximum,
        def: s.Normalization.Position.Default,
      },
      normAng: {
        min: s.Normalization.Angle.Minimum,
        max: s.Normalization.Angle.Maximum,
        def: s.Normalization.Angle.Default,
      },
      curOut: new Array((s.Output || []).length).fill(0),
      prevOut: new Array((s.Output || []).length).fill(0),
    }));

    for (const s of this.settings) {
      let x = 0;
      let y = 0;
      s.particles.forEach((p, idx) => {
        if (idx > 0) y += p.radius;
        p.x = p.lastX = x;
        p.y = p.lastY = y;
      });
    }
  }

  setWind(wind: Vector) {
    this.wind = { x: wind.X, y: wind.Y };
  }

  private _resolve(model: KoroModel) {
    for (const s of this.settings) {
      for (const inp of s.inputs) {
        if (inp.idx < 0) inp.idx = model.paramIndex.get(inp.id) ?? -1;
      }
      for (const out of s.outputs) {
        if (out.idx < 0) out.idx = model.paramIndex.get(out.id) ?? -1;
      }
    }
  }

  private _loadInputs(setting: InternalSetting, params: ArrayLike<number>) {
    let tx = 0;
    let ty = 0;
    let ang = 0;
    for (const inp of setting.inputs) {
      if (inp.idx < 0) continue;
      const w = inp.weight / WEIGHT_SCALE;
      const pm = this._pm[inp.idx];
      const d =
        normalizeInput(
          params[inp.idx],
          pm.min,
          pm.max,
          inp.type === 'Angle' ? setting.normAng.min : setting.normPos.min,
          inp.type === 'Angle' ? setting.normAng.max : setting.normPos.max,
          inp.type === 'Angle' ? setting.normAng.def : setting.normPos.def,
          inp.reflect
        ) * w;
      if (inp.type === 'X') tx += d;
      else if (inp.type === 'Y') ty += d;
      else ang += d;
    }
    const rad = (-ang * Math.PI) / 180;
    const rx = tx * Math.cos(rad) - ty * Math.sin(rad);
    const ry = rx * Math.sin(rad) + ty * Math.cos(rad);
    return { tx: rx, ty: ry, ang };
  }

  private _outputValue(out: InternalOutput, setting: InternalSetting): number {
    const p = setting.particles;
    const v = out.vertex;
    const dx = p[v].x - p[v - 1].x;
    const dy = p[v].y - p[v - 1].y;
    let val: number;
    if (out.type === 'X') {
      val = out.reflect ? -dx : dx;
    } else if (out.type === 'Y') {
      val = out.reflect ? -dy : dy;
    } else {
      let refX: number;
      let refY: number;
      if (v >= 2) {
        refX = p[v - 1].x - p[v - 2].x;
        refY = p[v - 1].y - p[v - 2].y;
      } else {
        refX = -this.gravity.x;
        refY = -this.gravity.y;
      }
      val = signedAngleBetween(refX, refY, dx, dy);
      if (out.reflect) val = -val;
    }
    return val;
  }

  private _writeOutput(out: InternalOutput, val: number, target: number[] | Float64Array) {
    if (out.idx < 0) return;
    let scaled = val * (out.type === 'Angle' ? out.angleScale : 0);
    const cMin = this._cMin[out.idx];
    const cMax = this._cMax[out.idx];
    if (scaled < cMin) scaled = cMin;
    else if (scaled > cMax) scaled = cMax;
    const w = out.weight / WEIGHT_SCALE;
    target[out.idx] = w >= 1 ? scaled : target[out.idx] * (1 - w) + scaled * w;
  }

  private _step(setting: InternalSetting, tx: number, ty: number, ang: number, dt: number, snapX: number) {
    const p = setting.particles;
    p[0].x = tx;
    p[0].y = ty;
    const rad = (ang * Math.PI) / 180;
    let gx = Math.sin(rad);
    let gy = Math.cos(rad);
    const gLen = Math.hypot(gx, gy) || 1;
    gx /= gLen;
    gy /= gLen;
    const useWind = this.windSettings !== null && this.windSettings.has(setting.id);
    const wx = useWind ? this.wind.x : 0;
    const wy = useWind ? this.wind.y : 0;

    for (let i = 1; i < p.length; i++) {
      const cur = p[i];
      const fx = gx * cur.acceleration + wx;
      const fy = gy * cur.acceleration + wy;
      cur.lastX = cur.x;
      cur.lastY = cur.y;
      const delay = cur.delay * dt * 30;
      let dx = cur.x - p[i - 1].x;
      let dy = cur.y - p[i - 1].y;
      const rot = signedAngleBetween(cur.lastGX, cur.lastGY, gx, gy) / GRAVITY_ROT_DIVISOR;
      const ndx = Math.cos(rot) * dx - dy * Math.sin(rot);
      const ndy = Math.sin(rot) * ndx + dy * Math.cos(rot);
      cur.x = p[i - 1].x + ndx + cur.vx * delay + fx * delay * delay;
      cur.y = p[i - 1].y + ndy + cur.vy * delay + fy * delay * delay;
      let rdx = cur.x - p[i - 1].x;
      let rdy = cur.y - p[i - 1].y;
      const rLen = Math.hypot(rdx, rdy) || 1;
      rdx /= rLen;
      rdy /= rLen;
      cur.x = p[i - 1].x + rdx * cur.radius;
      cur.y = p[i - 1].y + rdy * cur.radius;
      if (Math.abs(cur.x) < snapX) cur.x = 0;
      if (delay !== 0) {
        cur.vx = ((cur.x - cur.lastX) / delay) * cur.mobility;
        cur.vy = ((cur.y - cur.lastY) / delay) * cur.mobility;
      }
      cur.lastGX = gx;
      cur.lastGY = gy;
    }
  }

  settle(model: KoroModel) {
    model._rigidReset = true;
    model._rigidPendingDT = 0;
    this._resolve(model);
    this._pm = model.man.parameters;
    this._cMin = model.clampMin;
    this._cMax = model.clampMax;
    const params = model.params;
    this._caches = Float64Array.from(params);
    this._inputCaches = Float64Array.from(params);

    for (const s of this.settings) {
      const { tx, ty, ang } = this._loadInputs(s, params);
      const p = s.particles;
      p[0].x = tx;
      p[0].y = ty;
      const rad = (ang * Math.PI) / 180;
      const gx = Math.sin(rad);
      const gy = Math.cos(rad);
      for (let i = 1; i < p.length; i++) {
        const cur = p[i];
        const fx = gx * cur.acceleration;
        const fy = gy * cur.acceleration;
        cur.lastX = cur.x;
        cur.lastY = cur.y;
        cur.vx = cur.vy = 0;
        const fLen = Math.hypot(fx, fy) || 1;
        cur.x = p[i - 1].x + (fx / fLen) * cur.radius;
        cur.y = p[i - 1].y + (fy / fLen) * cur.radius;
        if (Math.abs(cur.x) < SNAP_THRESHOLD * s.normPos.max) cur.x = 0;
        cur.lastGX = gx;
        cur.lastGY = gy;
      }
      s.outputs.forEach((out, idx) => {
        if (out.vertex < 1 || out.vertex >= p.length) return;
        const val = this._outputValue(out, s);
        s.curOut[idx] = s.prevOut[idx] = val;
        this._writeOutput(out, val, params);
        if (out.idx >= 0) this._caches![out.idx] = params[out.idx];
      });
    }
    this.remain = 0;
    stepClothSprings(this, model, 0);
    stepPendantSprings(this, model, 0);
  }

  update(model: KoroModel, delta: number) {
    if (delta <= 0) return;
    if (delta > 0.1) model._rigidReset = true;
    model._rigidPendingDT = Math.min(0.05, (model._rigidPendingDT || 0) + delta);
    this._resolve(model);
    this._pm = model.man.parameters;
    this._cMin = model.clampMin;
    this._cMax = model.clampMax;
    const params = model.params;
    const count = params.length;
    if (!this._caches || this._caches.length !== count) {
      this._caches = Float64Array.from(params);
    }
    if (!this._inputCaches || this._inputCaches.length !== count) {
      this._inputCaches = Float64Array.from(params);
    }
    this.remain += delta;
    if (this.remain > MAX_REMAIN) this.remain = 0;
    const stepDt = this.fps > 0 ? 1 / this.fps : delta;

    while (this.remain >= stepDt) {
      for (const s of this.settings) {
        for (let i = 0; i < s.curOut.length; i++) s.prevOut[i] = s.curOut[i];
      }
      const alpha = stepDt / this.remain;
      for (let i = 0; i < count; i++) {
        this._caches[i] = this._inputCaches[i] * (1 - alpha) + params[i] * alpha;
        this._inputCaches[i] = this._caches[i];
      }
      for (const s of this.settings) {
        const { tx, ty, ang } = this._loadInputs(s, this._caches);
        this._step(s, tx, ty, ang, stepDt, SNAP_THRESHOLD * s.normPos.max);
        s.outputs.forEach((out, idx) => {
          if (out.vertex < 1 || out.vertex >= s.particles.length) return;
          const val = this._outputValue(out, s);
          s.curOut[idx] = val;
          this._writeOutput(out, val, this._caches!);
        });
      }
      this.remain -= stepDt;
    }

    const frac = this.remain / stepDt;
    for (const s of this.settings) {
      s.outputs.forEach((out, idx) => {
        if (out.idx < 0 || out.vertex < 1) return;
        this._writeOutput(out, s.prevOut[idx] * (1 - frac) + s.curOut[idx] * frac, params);
      });
    }
    stepClothSprings(this, model, delta);
    stepPendantSprings(this, model, delta);
  }
}
