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
  Meta: { EffectiveForces: { Wind: Vector } };
}
interface PhysicsModel {
  man: { parameters: { id: string; min: number; max: number; default: number }[] };
  paramIndex: Map<string, number>;
  getParameter(id: string): number | undefined;
  setParameter(id: string, value: number): void;
}
interface Particle { x: number; y: number; vx: number; vy: number; gravity: Vector }

function normalize(value: number, parameter: PhysicsModel['man']['parameters'][number], range: Normalization) {
  const clamped = Math.max(parameter.min, Math.min(parameter.max, value));
  const middle = (parameter.min + parameter.max) / 2;
  return clamped >= middle
    ? range.Default + (clamped - middle) / (parameter.max - middle || 1) * (range.Maximum - range.Default)
    : range.Default + (clamped - middle) / (middle - parameter.min || 1) * (range.Default - range.Minimum);
}

export class PhysicsPlayer {
  private particles: Particle[][];
  private outputs = new Map<string, number>();
  private accumulated = 0;
  private data: CompanionPhysics;
  private wind: Vector;
  private windSettings: Set<string> | null;

  constructor(data: CompanionPhysics, windSettings?: readonly string[]) {
    this.data = data;
    this.wind = { ...data.Meta.EffectiveForces.Wind };
    this.windSettings = windSettings ? new Set(windSettings) : null;
    this.particles = data.PhysicsSettings.map(setting => setting.Vertices.map(vertex => ({
      x: vertex.Position.X, y: vertex.Position.Y, vx: 0, vy: 0, gravity: { X: 0, Y: 1 },
    })));
  }

  setWind(wind: Vector) {
    this.wind = { ...wind };
  }

  update(model: PhysicsModel, delta: number) {
    this.accumulated += Math.max(0, Math.min(delta, 0.1));
    while (this.accumulated >= 1 / 30) {
      this.step(model, 1 / 30);
      this.accumulated -= 1 / 30;
    }
    this.applyOutputs(model);
  }

  settle(model: PhysicsModel) {
    this.accumulated = 0;
    for (let iteration = 0; iteration < 120; iteration++) this.step(model, 1 / 30);
    this.applyOutputs(model);
  }

  private applyOutputs(model: PhysicsModel) {
    for (const [id, value] of this.outputs) model.setParameter(id, value);
  }

  private step(model: PhysicsModel, delta: number) {
    for (const [settingIndex, setting] of this.data.PhysicsSettings.entries()) {
      const wind = !this.windSettings || this.windSettings.has(setting.Id)
        ? this.wind : this.data.Meta.EffectiveForces.Wind;
      let translationX = 0;
      let translationY = 0;
      let angle = 0;
      for (const input of setting.Input) {
        const index = model.paramIndex.get(input.Source.Id);
        if (index === undefined) continue;
        const value = normalize(model.getParameter(input.Source.Id) ?? 0, model.man.parameters[index],
          input.Type === 'Angle' ? setting.Normalization.Angle : setting.Normalization.Position)
          * input.Weight / 100 * (input.Reflect ? -1 : 1);
        if (input.Type === 'Angle') angle += value;
        else if (input.Type === 'X') translationX += value;
        else if (input.Type === 'Y') translationY += value;
      }
      const radians = angle * Math.PI / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const gravity = { X: -sine, Y: cosine };
      const particles = this.particles[settingIndex];
      particles[0].x = translationX * cosine - translationY * sine;
      particles[0].y = translationX * sine + translationY * cosine;
      for (let index = 1; index < particles.length; index++) {
        const particle = particles[index];
        const parent = particles[index - 1];
        const vertex = setting.Vertices[index];
        const delay = vertex.Delay * delta * 30;
        const previousX = particle.x;
        const previousY = particle.y;
        const rotation = Math.atan2(particle.gravity.X * gravity.Y - particle.gravity.Y * gravity.X,
          particle.gravity.X * gravity.X + particle.gravity.Y * gravity.Y) / 5;
        const directionX = previousX - parent.x;
        const directionY = previousY - parent.y;
        particle.x = parent.x + directionX * Math.cos(rotation) - directionY * Math.sin(rotation)
          + particle.vx * delay + (gravity.X * vertex.Acceleration + wind.X) * delay ** 2;
        particle.y = parent.y + directionX * Math.sin(rotation) + directionY * Math.cos(rotation)
          + particle.vy * delay + (gravity.Y * vertex.Acceleration + wind.Y) * delay ** 2;
        const length = Math.hypot(particle.x - parent.x, particle.y - parent.y) || 1;
        particle.x = parent.x + (particle.x - parent.x) / length * vertex.Radius;
        particle.y = parent.y + (particle.y - parent.y) / length * vertex.Radius;
        if (delay > 0) {
          particle.vx = (particle.x - previousX) / delay * vertex.Mobility;
          particle.vy = (particle.y - previousY) / delay * vertex.Mobility;
        }
        particle.gravity = gravity;
      }
      for (const output of setting.Output) {
        const index = output.VertexIndex;
        if (index < 1 || index >= particles.length) continue;
        const directionX = particles[index].x - particles[index - 1].x;
        const directionY = particles[index].y - particles[index - 1].y;
        const parentX = index > 1 ? particles[index - 1].x - particles[index - 2].x : 0;
        const parentY = index > 1 ? particles[index - 1].y - particles[index - 2].y : 1;
        let value = output.Type === 'X' ? directionX : output.Type === 'Y' ? directionY
          : Math.atan2(parentX * directionY - parentY * directionX, parentX * directionX + parentY * directionY);
        value *= output.Scale * (output.Reflect ? -1 : 1);
        const id = output.Destination.Id;
        const weight = output.Weight / 100;
        value = (model.getParameter(id) ?? 0) * (1 - weight) + value * weight;
        model.setParameter(id, value);
        this.outputs.set(id, model.getParameter(id) ?? value);
      }
    }
  }
}
