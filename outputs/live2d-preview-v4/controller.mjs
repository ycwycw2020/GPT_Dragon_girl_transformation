/**
 * Dragon companion parameter driver. No renderer, artwork or Cubism model is
 * included. A real model must bind these parameters before movement is visible.
 * All time values are seconds. No OS keyboard/mouse input is generated.
 */

const TAU = Math.PI * 2;
const EPSILON = 1e-9;
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const smooth = n => { const x = clamp(n); return x * x * (3 - 2 * x); };
const wave = (t, period, phase = 0) => Math.sin(TAU * (t / period + phase));
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

/** IDs and ranges match live2d-production-v2/motion-spec.json. */
export const PARAMETER_RANGES = Object.freeze(Object.fromEntries(Object.entries({
  ParamAngleX: [-30, 30], ParamAngleY: [-30, 30], ParamAngleZ: [-30, 30],
  ParamBodyAngleZ: [-10, 10], ParamBreath: [0, 1],
  ParamEyeLOpen: [0, 1], ParamEyeROpen: [0, 1],
  ParamEyeLSmile: [0, 1], ParamEyeRSmile: [0, 1],
  ParamBrowLY: [-1, 1], ParamBrowRY: [-1, 1],
  ParamBrowLAngle: [-1, 1], ParamBrowRAngle: [-1, 1],
  ParamEyeBallX: [-1, 1], ParamEyeBallY: [-1, 1],
  ParamMouthOpenY: [0, 1], ParamMouthForm: [-1, 1],
  ParamDragonFatigue: [0, 1], ParamDragonLeftArmPose: [0, 1],
  ParamDragonMouseX: [-1, 1], ParamDragonMouseY: [-1, 1],
  ParamDragonMouseClick: [0, 1], ParamDragonMouseRightClick: [0, 1],
  ParamDragonMouseScroll: [-1, 1], ParamDragonKeyIndex: [0, 1],
  ParamDragonKeyMiddle: [0, 1], ParamDragonKeySpace: [0, 1],
  ParamDragonTypingWrist: [0, 1], ParamDragonTailBase: [-1, 1],
  ParamDragonTailTip: [-1, 1], ParamDragonHairFront: [-1, 1],
  ParamDragonHairBack: [-1, 1], ParamDragonAhoge: [-1, 1],
  ParamDragonTassel: [-1, 1], ParamDragonFXThinking: [0, 1],
  ParamDragonFXEnergy: [0, 1], ParamDragonFXFatigue: [0, 1],
  ParamDragonFXBattery: [0, 1], ParamDragonTailRestPose: [0, 1],
}).map(([id, range]) => [id, Object.freeze(range)])));

export const PARAMETER_IDS = Object.freeze(Object.keys(PARAMETER_RANGES));
const CONTACT_PARAMETERS = new Set(PARAMETER_IDS.filter(id =>
  /Mouse|KeyIndex|KeyMiddle|KeySpace|TypingWrist|LeftArmPose/.test(id)));

// Scalar pose values blend once, then movement and expressions are composed.
const PROFILES = Object.freeze({
  working_thinking: { eye: .9, smile: 0, mouth: -.1, open: .08, fatigue: .1,
    brow: .08, browAngle: .18, tail: .2, tailAmp: .2, tailPeriod: 9,
    headAmp: 1, headY: -.6, breathPeriod: 5.2, blinkPeriod: 4.8,
    blinkDuration: .2, thinking: 1, energy: 0, tired: 0, battery: 0 },
  idle_high_energy: { eye: 1, smile: .2, mouth: .7, open: .03, fatigue: 0,
    brow: .06, browAngle: 0, tail: 0, tailAmp: .55, tailPeriod: 8,
    headAmp: 1.5, headY: .4, breathPeriod: 4.6, blinkPeriod: 4,
    blinkDuration: .16, thinking: 0, energy: 1, tired: 0, battery: 0 },
  idle_mid_energy: { eye: .62, smile: .06, mouth: .25, open: 0, fatigue: .55,
    brow: -.15, browAngle: -.15, tail: .55, tailAmp: .12, tailPeriod: 13,
    headAmp: .65, headY: -1.3, breathPeriod: 7, blinkPeriod: 5.6,
    blinkDuration: .32, thinking: 0, energy: 0, tired: 1, battery: 0 },
  idle_low_energy: { eye: .28, smile: 0, mouth: -.2, open: 0, fatigue: 1,
    brow: -.35, browAngle: -.3, tail: 1, tailAmp: .025, tailPeriod: 18,
    headAmp: .24, headY: -3, breathPeriod: 8.5, blinkPeriod: 6.5,
    blinkDuration: .48, thinking: 0, energy: 0, tired: 0, battery: 1 },
  // Missing quota is a neutral presentation, not an invented quota tier.
  idle_neutral: { eye: .85, smile: .05, mouth: .15, open: 0, fatigue: .15,
    brow: 0, browAngle: 0, tail: .3, tailAmp: .14, tailPeriod: 11,
    headAmp: .7, headY: 0, breathPeriod: 6, blinkPeriod: 5,
    blinkDuration: .23, thinking: 0, energy: 0, tired: 0, battery: 0 },
});

/** 15 and 50 are explicitly assigned to the middle tier. No coercion. */
export function classifyQuota(remainingPercent) {
  if (typeof remainingPercent !== 'number' || !Number.isFinite(remainingPercent)
      || remainingPercent < 0 || remainingPercent > 100) return null;
  if (remainingPercent > 50) return 'idle_high_energy';
  if (remainingPercent < 15) return 'idle_low_energy';
  return 'idle_mid_energy';
}

function positiveOption(value, fallback, name, allowZero = false) {
  const n = value === undefined ? fallback : value;
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) {
    throw new RangeError(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return n;
}

function pulse(t, start, duration) {
  const x = (t - start) / duration;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 2;
}

// Independent curves are evaluated at absolute elapsed time; never += per-frame
// offsets. This keeps equal timestamps equal at 30, 60 or 144 FPS.
function blinkMask(time, period, duration) {
  const phase = time % period;
  return 1 - pulse(phase, period - duration, duration);
}

function interpolate(a, b, amount) {
  return Object.fromEntries(Object.keys(b).map(key => [key, a[key] + (b[key] - a[key]) * amount]));
}

export class DragonCompanionController {
  constructor(options = {}) {
    this.options = Object.freeze({
      quotaMaxAgeSeconds: positiveOption(options.quotaMaxAgeSeconds, 120, 'quotaMaxAgeSeconds'),
      quotaDebounceSeconds: positiveOption(options.quotaDebounceSeconds, 3, 'quotaDebounceSeconds', true),
      transitionSeconds: positiveOption(options.transitionSeconds, .6, 'transitionSeconds'),
      armTransitionSeconds: positiveOption(options.armTransitionSeconds, .75, 'armTransitionSeconds'),
    });
    if (options.apply !== undefined && typeof options.apply !== 'function') throw new TypeError('apply must be a function');
    this.apply = options.apply;
    this.time = 0;
    this.isWorking = false;
    this.isChatThinking = false;
    this.state = 'idle_neutral';
    this.stateSince = 0;
    this.poseFrom = { ...PROFILES.idle_neutral };
    this.poseStart = 0;
    this.armFrom = 0;
    this.armTarget = 0;
    this.armStart = 0;
    this.armDuration = 0;
    this.workStart = 0;
    this.cachedQuotaState = null;
    this.quotaSample = null;
    this.quotaFresh = false;
    this.pendingQuota = null;
    this.mouseReturn = null;
    this.continuityFrom = null;
  }

  /** Patch input at the current controller time. Omitted fields retain values. */
  setInput(input = {}) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object');
    // Validate first so a malformed patch cannot partially mutate the task flags.
    for (const key of ['isWorking', 'isChatThinking']) {
      if (own(input, key) && typeof input[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
    }
    if (own(input, 'isWorking')) this.isWorking = input.isWorking;
    if (own(input, 'isChatThinking')) this.isChatThinking = input.isChatThinking;
    if (own(input, 'remainingPercent')) {
      const band = classifyQuota(input.remainingPercent);
      const age = input.quotaAgeSeconds === undefined ? 0 : input.quotaAgeSeconds;
      const validAge = typeof age === 'number' && Number.isFinite(age)
        && age >= 0 && age <= this.options.quotaMaxAgeSeconds;
      this.quotaFresh = band !== null && validAge;
      if (this.quotaFresh) {
        this.quotaSample = {
          value: input.remainingPercent, observedAt: this.time - age,
          expiresAt: this.time - age + this.options.quotaMaxAgeSeconds,
        };
        if (this.cachedQuotaState === null || this.options.quotaDebounceSeconds === 0) {
          this.cachedQuotaState = band;
          this.pendingQuota = null;
        } else if (band === this.cachedQuotaState) {
          this.pendingQuota = null;
        } else if (this.pendingQuota?.band !== band) {
          this.pendingQuota = { band, dueAt: this.time + this.options.quotaDebounceSeconds };
        }
      } else {
        // Invalid/stale data never overwrites the last trusted value or tier.
        this.pendingQuota = null;
      }
    }
    this._resolve(this.time);
    return this;
  }

  _poseAt(time) {
    return interpolate(this.poseFrom, PROFILES[this.state], smooth((time - this.poseStart) / this.options.transitionSeconds));
  }

  _armAt(time) {
    if (this.armDuration === 0) return this.armTarget;
    return this.armFrom + (this.armTarget - this.armFrom) * smooth((time - this.armStart) / this.armDuration);
  }

  _resolve(time) {
    const next = this.isWorking || this.isChatThinking ? 'working_thinking'
      : this.cachedQuotaState ?? 'idle_neutral';
    if (next === this.state) return;
    const previous = this._snapshotAt(time).parameters;
    if ((this.state === 'working_thinking') !== (next === 'working_thinking')) {
      this.mouseReturn = {
        x: previous.ParamDragonMouseX, y: previous.ParamDragonMouseY, start: time,
      };
    }
    this.continuityFrom = previous;
    this.poseFrom = this._poseAt(time);
    this.poseStart = time;
    const target = next === 'working_thinking' ? 1 : 0;
    if (target !== this.armTarget) {
      this.armFrom = this._armAt(time);
      this.armStart = time;
      this.armTarget = target;
      this.armDuration = Math.abs(target - this.armFrom) * this.options.armTransitionSeconds;
    }
    this.state = next;
    this.stateSince = time;
    if (next === 'working_thinking') this.workStart = time + this.armDuration;
  }

  /** Advance by elapsed seconds; apply each composed parameter exactly once. */
  update(deltaSeconds, input) {
    if (typeof deltaSeconds !== 'number' || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be finite and non-negative');
    }
    const nextTime = this.time + deltaSeconds;
    if (!Number.isFinite(nextTime)) throw new RangeError('elapsed time overflow');
    if (input !== undefined) this.setInput(input);
    // Resolve a debounced transition at its exact timestamp even across a long
    // frame. A quota that expires before confirmation cannot change the tier.
    if (this.pendingQuota && this.quotaFresh && this.pendingQuota.dueAt <= nextTime + EPSILON
        && this.pendingQuota.dueAt <= this.quotaSample.expiresAt) {
      const eventTime = this.pendingQuota.dueAt;
      this.cachedQuotaState = this.pendingQuota.band;
      this.pendingQuota = null;
      this._resolve(eventTime);
    }
    this.time = nextTime;
    if (this.quotaSample && this.time > this.quotaSample.expiresAt) {
      this.quotaFresh = false;
      this.pendingQuota = null;
    }
    const frame = this.snapshot();
    if (this.apply) {
      for (const [id, value] of Object.entries(frame.parameters)) this.apply(id, value);
    }
    return frame;
  }

  /** Read without advancing time or writing to the renderer. */
  snapshot() {
    return this._snapshotAt(this.time);
  }

  _snapshotAt(t) {
    const p = this._poseAt(t);
    const age = Math.max(0, t - this.stateSince);
    const working = this.state === 'working_thinking';
    const arm = this._armAt(t);
    const workTime = Math.max(0, t - this.workStart);
    const inTransfer = t + EPSILON < this.armStart + this.armDuration;
    const phase = workTime % 12;
    const action = inTransfer ? 'transfer' : !working ? 'idle'
      : phase < 3.5 ? 'mouse' : phase < 7.5 ? 'type' : 'think';
    let mouseX = 0, mouseY = 0, click = 0, rightClick = 0, scroll = 0;
    let keyIndex = 0, keyMiddle = 0, keySpace = 0, wrist = 0;

    if (working && !inTransfer) {
      if (action === 'mouse') {
        // Same translation IDs drive BOTH mouse and gripping hand in the rig.
        // Fade to the rest anchor at both ends, including interruption below.
        const gate = smooth(phase / .3) * smooth((3.5 - phase) / .45);
        mouseX = .42 * gate * wave(phase, 3.5);
        mouseY = .18 * gate * wave(phase, 1.75);
        click = pulse(phase, 1.05, .18) + pulse(phase, 2.5, .18);
        rightClick = pulse(phase, 2.9, .18);
        scroll = .22 * pulse(phase, 1.6, .55) * wave(phase - 1.6, .55);
      } else if (action === 'type') {
        const typing = phase - 3.5;
        const gate = smooth(typing / .2) * smooth((4 - typing) / .2);
        // One finger/active keycap pair owns each key parameter. No separate
        // key or hand oscillator can drift away from its contact partner.
        const beat = typing % 1;
        keyIndex = gate * (pulse(beat, .06, .17) + pulse(beat, .7, .17));
        keyMiddle = gate * pulse(beat, .36, .17);
        keySpace = gate * pulse(typing % 2, 1.1, .2);
        wrist = .15 * Math.max(keyIndex, keyMiddle, keySpace);
      }
    }

    // Mouse returns along the same shared parameters when work is interrupted.
    // Buttons/keys are zero immediately; the left arm can then leave safely.
    if (this.mouseReturn) {
      const release = 1 - smooth((t - this.mouseReturn.start) / .25);
      mouseX = this.mouseReturn.x * release + mouseX * (1 - release);
      mouseY = this.mouseReturn.y * release + mouseY * (1 - release);
    }

    const mask = blinkMask(age, p.blinkPeriod, p.blinkDuration);
    const nod = this.state === 'idle_low_energy' ? pulse(age % 24, 18, 2.8)
      : this.state === 'idle_high_energy' ? .4 * pulse(age % 17, 12, 1.6) : 0;
    const yawn = this.state === 'idle_low_energy' ? .35 * pulse(age % 48, 39, 2.2) : 0;
    const thinkingTilt = working && action === 'think' ? .9 * Math.sin(Math.PI * (phase - 7.5) / 4.5) : 0;
    const tailCycle = wave(age, p.tailPeriod);
    const tailTip = wave(age, p.tailPeriod, -.12);
    const values = {
      ParamAngleX: p.headAmp * wave(t, 13),
      ParamAngleY: p.headY + p.headAmp * .4 * wave(t, 11) - 2 * nod,
      ParamAngleZ: p.headAmp * .65 * wave(t, 15) + thinkingTilt,
      ParamBodyAngleZ: p.headAmp * .12 * wave(t, 15),
      ParamBreath: .5 + .16 * wave(age, p.breathPeriod),
      ParamEyeLOpen: p.eye * mask * (1 - .8 * nod),
      ParamEyeROpen: p.eye * mask * (1 - .8 * nod),
      ParamEyeLSmile: p.smile, ParamEyeRSmile: p.smile,
      ParamBrowLY: p.brow + .05 * thinkingTilt, ParamBrowRY: p.brow,
      ParamBrowLAngle: p.browAngle, ParamBrowRAngle: -p.browAngle,
      ParamEyeBallX: .12 * wave(t, 9) + (action === 'mouse' ? -.12 : 0),
      ParamEyeBallY: working ? -.12 : -.04 * nod,
      ParamMouthOpenY: Math.max(p.open, yawn), ParamMouthForm: p.mouth * (1 - yawn),
      ParamDragonFatigue: p.fatigue, ParamDragonLeftArmPose: arm,
      ParamDragonMouseX: mouseX, ParamDragonMouseY: mouseY,
      ParamDragonMouseClick: click, ParamDragonMouseRightClick: rightClick,
      ParamDragonMouseScroll: scroll, ParamDragonKeyIndex: keyIndex,
      ParamDragonKeyMiddle: keyMiddle, ParamDragonKeySpace: keySpace,
      ParamDragonTypingWrist: wrist,
      // RestPose deforms ONLY the tail, with an anchored root behind the chair:
      // 0 raised; .55 inward-drooping tip; 1 low soft arc, never beyond desk legs.
      ParamDragonTailRestPose: p.tail,
      ParamDragonTailBase: .25 * p.tailAmp * tailCycle,
      ParamDragonTailTip: p.tailAmp * tailTip * (action === 'think' ? .35 : 1),
      ParamDragonHairFront: .04 * wave(t, 7),
      ParamDragonHairBack: .055 * wave(t, 8, -.08),
      ParamDragonAhoge: (.03 + p.headAmp * .03) * wave(t, 6),
      ParamDragonTassel: .025 * wave(t, 7, -.15),
      ParamDragonFXThinking: p.thinking * (action === 'think' ? 1 : .45),
      ParamDragonFXEnergy: p.energy * (.9 + .1 * wave(t, 5)),
      ParamDragonFXFatigue: p.tired,
      ParamDragonFXBattery: p.battery * (.82 + .12 * wave(t, 8)),
    };
    const parameters = Object.freeze(Object.fromEntries(PARAMETER_IDS.map(id => {
      let value = values[id];
      // Preserve final ambient values across changes of blink/breath cadence.
      // Never blend stale contact/button values into a released hand.
      if (this.continuityFrom && !CONTACT_PARAMETERS.has(id)) {
        const amount = smooth(age / this.options.transitionSeconds);
        value = this.continuityFrom[id] + (value - this.continuityFrom[id]) * amount;
      }
      if (!Number.isFinite(value)) throw new Error(`Non-finite parameter: ${id}`);
      return [id, clamp(value, ...PARAMETER_RANGES[id]) || 0];
    })));
    return Object.freeze({
      timeSeconds: t, state: this.state, action, parameters,
      quotaUnknown: !this.quotaFresh,
      quota: Object.freeze({
        status: this.quotaFresh ? 'fresh' : this.cachedQuotaState ? 'cached' : 'unknown',
        lastTrustedRemainingPercent: this.quotaSample?.value ?? null,
        ageSeconds: this.quotaSample ? t - this.quotaSample.observedAt : null,
        cachedState: this.cachedQuotaState,
        pendingState: this.pendingQuota?.band ?? null,
      }),
      handLocks: Object.freeze({
        left: inTransfer ? 'transfer' : working ? 'keyboard' : 'chin_support',
        right: action === 'mouse' ? 'mouse_action' : 'mouse_rest',
      }),
    });
  }
}

/**
 * Adapter for a REAL CubismModel. Pass an ID resolver for Cubism Web Framework:
 * id => CubismFramework.getIdManager().getId(id)
 * String-ID wrappers may omit it. Does not call model.update() or render().
 */
export function createCubismParameterWriter(model, resolveId = id => id) {
  if (!model || typeof model.setParameterValueById !== 'function') {
    throw new TypeError('model must implement setParameterValueById');
  }
  if (typeof resolveId !== 'function') throw new TypeError('resolveId must be a function');
  const handles = new Map(PARAMETER_IDS.map(id => [id, resolveId(id)]));
  return (id, value) => {
    if (!handles.has(id)) throw new RangeError(`Unknown controller parameter: ${id}`);
    const [lo, hi] = PARAMETER_RANGES[id];
    if (!Number.isFinite(value)) throw new RangeError('parameter value must be finite');
    model.setParameterValueById(handles.get(id), clamp(value, lo, hi), 1);
  };
}
