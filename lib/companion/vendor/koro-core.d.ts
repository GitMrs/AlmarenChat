export interface KoroMesh {
  _world: Float32Array;
  _opacity: number;
  vcount: number;
}

export interface KoroRig {
  format: string;
  bin: string;
  parameters: { id: string; min: number; max: number; default: number }[];
  parts: { id: string }[];
  art_meshes: KoroMesh[];
  deformers: unknown[];
  pendant_springs?: unknown[];
  cloth_springs?: unknown[];
  rigid_parts?: unknown[];
  joint_bindings?: unknown[];
}

export class KoroModel {
  constructor(gl: WebGL2RenderingContext, rig: KoroRig, binary: ArrayBuffer, textures: WebGLTexture[]);
  man: KoroRig;
  params: number[];
  clampMin: number[];
  clampMax: number[];
  paramIndex: Map<string, number>;
  partOpacity: Float32Array;
  _rigidReset?: boolean;
  _rigidPendingDT?: number;
  setParameter(id: string, value: number): void;
  getParameter(id: string): number | undefined;
  setPartOpacity(id: string, value: number): void;
  applyTuning(tuning: object): void;
  applyPose(pose: object): void;
  update(): void;
  draw(projection: Float32Array): void;
  dispose(): void;
}

export function stepPendantSprings(host: object, model: KoroModel, dt: number): void;
export function stepClothSprings(host: object, model: KoroModel, dt: number): void;
