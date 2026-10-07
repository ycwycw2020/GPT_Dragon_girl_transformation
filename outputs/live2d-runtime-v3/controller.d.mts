export type IdleState = 'idle_high_energy' | 'idle_mid_energy' | 'idle_low_energy';
/** idle_neutral is missing-quota presentation, never a fifth quota tier. */
export type State = IdleState | 'working_thinking' | 'idle_neutral';
export type Action = 'transfer' | 'mouse' | 'type' | 'think' | 'idle';
export type ParameterId =
  | 'ParamAngleX' | 'ParamAngleY' | 'ParamAngleZ' | 'ParamBodyAngleZ' | 'ParamBreath'
  | 'ParamEyeLOpen' | 'ParamEyeROpen' | 'ParamEyeLSmile' | 'ParamEyeRSmile'
  | 'ParamBrowLY' | 'ParamBrowRY' | 'ParamBrowLAngle' | 'ParamBrowRAngle'
  | 'ParamEyeBallX' | 'ParamEyeBallY' | 'ParamMouthOpenY' | 'ParamMouthForm'
  | 'ParamDragonFatigue' | 'ParamDragonLeftArmPose'
  | 'ParamDragonMouseX' | 'ParamDragonMouseY' | 'ParamDragonMouseClick'
  | 'ParamDragonMouseRightClick' | 'ParamDragonMouseScroll'
  | 'ParamDragonKeyIndex' | 'ParamDragonKeyMiddle' | 'ParamDragonKeySpace'
  | 'ParamDragonTypingWrist' | 'ParamDragonTailBase' | 'ParamDragonTailTip'
  | 'ParamDragonTailRestPose' | 'ParamDragonHairFront' | 'ParamDragonHairBack'
  | 'ParamDragonAhoge' | 'ParamDragonTassel' | 'ParamDragonFXThinking'
  | 'ParamDragonFXEnergy' | 'ParamDragonFXFatigue' | 'ParamDragonFXBattery';

export type ParameterWriter = (id: ParameterId, value: number) => void;
export interface ControllerInput {
  isWorking?: boolean;
  isChatThinking?: boolean;
  /** A fresh sample. Omit between polls; null explicitly marks quota unavailable. */
  remainingPercent?: number | null;
  /** Age of this sample at setInput time; omitted means newly observed. */
  quotaAgeSeconds?: number;
}
export interface ControllerOptions {
  /** Default 120 seconds. Expired samples retain the last trusted tier with a flag. */
  quotaMaxAgeSeconds?: number;
  /** Default 3; only quota changes debounce. First sample/work begin immediately. */
  quotaDebounceSeconds?: number;
  /** Default 0.6 seconds for pose/expression blending. */
  transitionSeconds?: number;
  /** Default 0.75 seconds for a full chin-support/keyboard arm transfer. */
  armTransitionSeconds?: number;
  /** Optional sole parameter writer. Each update writes each parameter once. */
  apply?: ParameterWriter;
}
export interface ControllerFrame {
  readonly timeSeconds: number;
  readonly state: State;
  readonly action: Action;
  readonly parameters: Readonly<Record<ParameterId, number>>;
  readonly quotaUnknown: boolean;
  readonly quota: Readonly<{
    status: 'fresh' | 'cached' | 'unknown';
    lastTrustedRemainingPercent: number | null;
    ageSeconds: number | null;
    cachedState: IdleState | null;
    pendingState: IdleState | null;
  }>;
  readonly handLocks: Readonly<{
    left: 'transfer' | 'keyboard' | 'chin_support';
    right: 'mouse_action' | 'mouse_rest';
  }>;
}
export declare const PARAMETER_RANGES: Readonly<Record<ParameterId, readonly [number, number]>>;
export declare const PARAMETER_IDS: readonly ParameterId[];
export declare function classifyQuota(remainingPercent: unknown): IdleState | null;
export declare class DragonCompanionController {
  constructor(options?: ControllerOptions);
  readonly options: Readonly<Required<Omit<ControllerOptions, 'apply'>>>;
  readonly time: number;
  readonly state: State;
  /** Input is applied at the current clock time; no render/write is performed. */
  setInput(input?: ControllerInput): this;
  /** Input patch is applied before deltaSeconds advances the clock. */
  update(deltaSeconds: number, input?: ControllerInput): ControllerFrame;
  /** No clock advance and no writes to the model. */
  snapshot(): ControllerFrame;
}
export interface CubismParameterModel<TId = string> {
  setParameterValueById(id: TId, value: number, weight?: number): void;
}
export declare function createCubismParameterWriter(model: CubismParameterModel<string>): ParameterWriter;
export declare function createCubismParameterWriter<TId>(
  model: CubismParameterModel<TId>,
  resolveId: (id: ParameterId) => TId,
): ParameterWriter;
