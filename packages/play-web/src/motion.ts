export const MOTION_TOKENS = {
  ease: {
    out: "cubic-bezier(.2,.8,.2,1)",
    snap: "cubic-bezier(.3,1.4,.4,1)",
    in: "cubic-bezier(.6,0,.8,.2)",
    io: "cubic-bezier(.65,0,.35,1)",
  },
  duration: {
    micro: 120,
    fast: 220,
    normal: 420,
    slow: 700,
  },
} as const;

export interface MotionRunOptions {
  duration?: number;
  delay?: number;
  easing?: string;
  fill?: FillMode;
  replace?: boolean;
  essential?: boolean;
  rmKf?: Keyframe[];
}

export interface MotionStaggerOptions extends MotionRunOptions {
  x?: number;
  y?: number;
  rot?: number;
  each?: number;
}

export interface MotionBurstOptions {
  n?: number;
  colors?: string[];
  color?: string;
  size?: number;
  angle?: number;
  spread?: number;
  dist?: number;
  grav?: number;
  dur?: number;
}

type AnimatableElement = HTMLElement & { __anim?: Animation | null };

export interface ReducedMotionStore {
  get(): boolean;
  set(v: boolean): void;
  toggle(): boolean;
  subscribe(fn: (v: boolean) => void): () => void;
}

export function createReducedMotionStore(initial = false): ReducedMotionStore {
  let state = initial;
  const listeners = new Set<(v: boolean) => void>();
  return {
    get: () => state,
    set(v: boolean) {
      state = Boolean(v);
      for (const fn of listeners) fn(state);
    },
    toggle() {
      this.set(!state);
      return state;
    },
    subscribe(fn: (v: boolean) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function escapeChar(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MotionEngine {
  readonly tokens: typeof MOTION_TOKENS;
  readonly rm: ReducedMotionStore;
  isReduced(): boolean;
  setReduced(v: boolean): void;
  toggleReduced(): boolean;
  run(el: Element | null | undefined, kf: Keyframe[], o?: MotionRunOptions): Animation | null;
  stagger(els: Iterable<Element> | ArrayLike<Element>, o?: MotionStaggerOptions): void;
  split(el: HTMLElement | null | undefined, o?: MotionStaggerOptions): void;
  pop(el: Element | null | undefined, delay?: number): Animation | null;
  stamp(el: Element | null | undefined, delay?: number): Animation | null;
  shake(el: Element | null | undefined, amt?: number): Animation | null;
  hitstop(ms?: number): Promise<void>;
  count(el: HTMLElement | null | undefined, to: number, ms?: number): void;
  burst(x: number, y: number, o?: MotionBurstOptions): void;
  fly(fromEl: Element | null | undefined, toEl: Element | null | undefined, html: string, color?: string): void;
  wipe(caption: string, mid?: () => void): Promise<void>;
  scaleBar(el: HTMLElement | null | undefined, pct: number): void;
}

export function createMotionEngine(opts?: {
  fast?: boolean;
  reduced?: boolean;
  onStampSfx?: () => void;
}): MotionEngine {
  const fast = Boolean(opts?.fast);
  const rm = createReducedMotionStore(Boolean(opts?.reduced));

  const syncHtmlClass = (v: boolean) => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("rm", v);
    }
  };
  rm.subscribe(syncHtmlClass);
  syncHtmlClass(rm.get());

  let wipeCleanup: (() => void) | null = null;

  const engine: MotionEngine = {
    tokens: MOTION_TOKENS,
    rm,
    isReduced: () => rm.get(),
    setReduced(v: boolean) {
      rm.set(v);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("ledring-rm", v ? "1" : "0");
        }
      } catch {
        // ignore storage errors
      }
    },
    toggleReduced() {
      const next = !rm.get();
      this.setReduced(next);
      return next;
    },
    run(el, kf, o = {}) {
      const node = el as AnimatableElement | null | undefined;
      if (!node || typeof node.animate !== "function") return null;
      if (node.__anim && o.replace !== false) {
        try {
          node.__anim.cancel();
        } catch {
          // ignore cancel errors
        }
      }
      let frames = kf;
      let optsRun: KeyframeAnimationOptions = {
        duration: o.duration ?? MOTION_TOKENS.duration.normal,
        delay: o.delay ?? 0,
        easing: o.easing ?? MOTION_TOKENS.ease.out,
        fill: o.fill ?? "both",
      };
      if (rm.get()) {
        const startOp = kf[0]?.opacity ?? 1;
        const endOp = kf[kf.length - 1]?.opacity ?? 1;
        frames = o.rmKf ?? [{ opacity: startOp, transform: "none" }, { opacity: endOp, transform: "none" }];
        optsRun = {
          ...optsRun,
          duration: Math.min(MOTION_TOKENS.duration.micro, Number(optsRun.duration) || MOTION_TOKENS.duration.micro),
          delay: 0,
        };
      }
      if (fast) {
        optsRun = {
          ...optsRun,
          duration: Math.min(60, Number(optsRun.duration) || 60),
          delay: Math.min(20, Number(optsRun.delay) || 0),
        };
      }
      const anim = node.animate(frames, optsRun);
      node.__anim = anim;
      return anim;
    },
    stagger(els, o = {}) {
      const list = Array.from(els);
      list.forEach((el, i) => {
        const x = o.x ?? 0;
        const y = o.y ?? 18;
        const rot = o.rot ? ` rotate(${o.rot}deg)` : "";
        this.run(
          el,
          [
            { opacity: 0, transform: `translate3d(${x}px,${y}px,0)${rot}` },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: o.duration ?? 520,
            delay: (o.delay ?? 0) + i * (o.each ?? 45),
            easing: o.easing ?? MOTION_TOKENS.ease.out,
          },
        );
      });
    },
    split(el, o = {}) {
      if (!el) return;
      const txt = el.textContent ?? "";
      el.setAttribute("aria-label", txt);
      if (rm.get()) return;
      const html = el.innerHTML
        .split(/(<br\s*\/?>)/i)
        .map((part) =>
          /^<br/i.test(part)
            ? part
            : part
                .split(/(\s+)/)
                .map((w) =>
                  /^\s+$/.test(w) || !w
                    ? w
                    : `<span class="sw" aria-hidden="true">${[...w].map((c) => `<span class="sc">${escapeChar(c)}</span>`).join("")}</span>`,
                )
                .join(""),
        )
        .join("");
      el.innerHTML = html;
      this.stagger(el.querySelectorAll(".sc"), {
        y: 38,
        rot: 6,
        each: 22,
        duration: 560,
        easing: MOTION_TOKENS.ease.snap,
        ...o,
      });
    },
    pop(el, delay = 0) {
      return this.run(
        el,
        [
          { opacity: 0, transform: "scale(.86) translate3d(0,10px,0)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 380, delay, easing: MOTION_TOKENS.ease.snap },
      );
    },
    stamp(el, delay = 0) {
      opts?.onStampSfx?.();
      return this.run(
        el,
        [
          { opacity: 0, transform: "scale(2.2) rotate(-8deg)" },
          { opacity: 1, transform: "scale(.92) rotate(-3deg)", offset: 0.6 },
          { opacity: 1, transform: "scale(1) rotate(-3deg)" },
        ],
        { duration: MOTION_TOKENS.duration.normal, delay, easing: MOTION_TOKENS.ease.in },
      );
    },
    shake(el, amt = 8) {
      if (rm.get() || !el) return null;
      const frames: Keyframe[] = [0, 1, 2, 3, 4, 5, 6]
        .map((i) => ({
          transform: `translate3d(${i % 2 ? amt : -amt}px,${((i % 3) - 1) * amt * 0.4}px,0)`,
        }))
        .concat([{ transform: "none" }]);
      return this.run(el, frames, {
        duration: MOTION_TOKENS.duration.normal,
        easing: "linear",
        fill: "none",
      });
    },
    async hitstop(ms = 90) {
      if (rm.get() || typeof document === "undefined") return;
      const st = document.querySelector("#stage");
      if (!st) return;
      st.classList.add("hitstop");
      await new Promise((r) => setTimeout(r, fast ? Math.min(ms, 20) : ms));
      st.classList.remove("hitstop");
    },
    count(el, to, ms = 500) {
      if (!el) return;
      const from = Number(el.dataset.v || 0);
      el.dataset.v = String(to);
      if (rm.get() || fast || from === to) {
        el.textContent = String(Math.round(to));
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = String(Math.round(from + (to - from) * e));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    burst(x, y, o = {}) {
      if (rm.get() || typeof document === "undefined") return;
      const host = document.querySelector("#fx");
      if (!host) return;
      const n = o.n ?? 14;
      const r = host.getBoundingClientRect();
      for (let i = 0; i < n; i++) {
        const p = document.createElement("i");
        p.className = "shard";
        p.style.left = `${x - r.left}px`;
        p.style.top = `${y - r.top}px`;
        p.style.background = o.colors ? (o.colors[i % o.colors.length] ?? "#0E1114") : (o.color ?? "#0E1114");
        const s = (o.size ?? 8) * (0.6 + Math.random() * 0.8);
        p.style.width = `${s}px`;
        p.style.height = `${s}px`;
        host.appendChild(p);
        const a = (o.angle ?? Math.random() * Math.PI * 2) + (o.spread ? (Math.random() - 0.5) * o.spread : 0);
        const v = (o.dist ?? 120) * (0.5 + Math.random());
        const an = p.animate(
          [
            { transform: "translate3d(-50%,-50%,0) rotate(0)", opacity: 1 },
            {
              transform: `translate3d(${Math.cos(a) * v - s / 2}px,${Math.sin(a) * v + (o.grav ?? 40)}px,0) rotate(${(Math.random() - 0.5) * 540}deg)`,
              opacity: 0,
            },
          ],
          {
            duration: (o.dur ?? MOTION_TOKENS.duration.slow) * (0.7 + Math.random() * 0.6),
            easing: MOTION_TOKENS.ease.out,
            fill: "both",
          },
        );
        an.onfinish = () => p.remove();
      }
    },
    fly(fromEl, toEl, html, color) {
      if (!fromEl || !toEl || typeof document === "undefined") return;
      const fx = document.querySelector("#fx");
      if (!fx) return;
      const a = fromEl.getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      const h = fx.getBoundingClientRect();
      const c = document.createElement("div");
      c.className = "flychip";
      c.innerHTML = html;
      c.style.background = color ?? "#0E1114";
      c.style.left = `${a.left + a.width / 2 - h.left}px`;
      c.style.top = `${a.top + a.height / 2 - h.top}px`;
      fx.appendChild(c);
      if (rm.get()) {
        setTimeout(() => c.remove(), 300);
        return;
      }
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const an = c.animate(
        [
          { transform: "translate3d(-50%,-50%,0) scale(.6)", opacity: 0 },
          {
            transform: `translate3d(calc(-50% + ${dx * 0.35}px),calc(-50% + ${dy * 0.35 - 60}px),0) scale(1.1)`,
            opacity: 1,
            offset: 0.35,
          },
          {
            transform: `translate3d(calc(-50% + ${dx}px),calc(-50% + ${dy}px),0) scale(.5)`,
            opacity: 0.2,
          },
        ],
        { duration: 820, easing: MOTION_TOKENS.ease.io, fill: "both" },
      );
      an.onfinish = () => {
        c.remove();
        this.run(toEl, [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], {
          duration: 300,
          easing: MOTION_TOKENS.ease.snap,
          fill: "none",
        });
      };
    },
    wipe(caption, mid) {
      if (typeof document === "undefined") {
        mid?.();
        return Promise.resolve();
      }
      if (wipeCleanup) {
        wipeCleanup();
        wipeCleanup = null;
      }
      const w = document.querySelector("#wipe") as HTMLElement | null;
      const cap = document.querySelector("#wipecap") as HTMLElement | null;
      if (cap) cap.textContent = caption || "";
      if (!w || rm.get() || fast) {
        w?.classList.remove("on");
        mid?.();
        return Promise.resolve();
      }
      return new Promise<void>((res) => {
        let midCalled = false;
        let timer = 0;
        const callMid = () => {
          if (!midCalled) {
            midCalled = true;
            mid?.();
          }
        };
        const finishWipe = () => {
          clearTimeout(timer);
          callMid();
          w.classList.remove("on");
          if (wipeCleanup === finishWipe) wipeCleanup = null;
          res();
        };
        wipeCleanup = finishWipe;
        w.classList.add("on");
        const a = this.run(
          w,
          [
            { transform: "translate3d(-115%,0,0) skewX(-14deg)" },
            { transform: "translate3d(0,0,0) skewX(-14deg)" },
          ],
          { duration: 300, easing: MOTION_TOKENS.ease.in, essential: true },
        );
        if (cap) {
          this.run(
            cap,
            [
              { opacity: 0, transform: "translate3d(-40px,0,0)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 260, delay: MOTION_TOKENS.duration.micro },
          );
        }
        if (!a) {
          finishWipe();
          return;
        }
        a.onfinish = () => {
          callMid();
          timer = window.setTimeout(() => {
            const b = this.run(
              w,
              [
                { transform: "translate3d(0,0,0) skewX(-14deg)" },
                { transform: "translate3d(115%,0,0) skewX(-14deg)" },
              ],
              { duration: 360, easing: MOTION_TOKENS.ease.out, essential: true },
            );
            if (!b) {
              finishWipe();
              return;
            }
            b.onfinish = () => finishWipe();
          }, 140);
        };
      });
    },
    scaleBar(el, pct) {
      if (!el) return;
      const ratio = Math.max(0, Math.min(1, pct / 100));
      el.style.transform = `scaleX(${ratio})`;
    },
  };

  return engine;
}
