# LEDRING Play: motion and game-feel design (v4)

**Goal:** make supervising an agent feel like a game (punchy, readable, tactile) without leaving v1's look: light paper, ink type, mono captions and one state colour at a time.
**Implemented in:** `p6b-motion.js` (the motion layer), `p2c-css.html` (play layer + responsive), with hooks in `p6-engine.js`, `p8-game.js` and `p9-ui.js`.

---

## 1. Sources and what we take from each

| Source | Observation | What LEDRING takes |
|---|---|---|
| **Persona 5** (Atlus, CEDEC+KYUSHU 2017 talk; [Persona Central](https://personacentral.com/persona-5-panel-concept-development-ui/), [Siliconera](https://www.siliconera.com/atlus-reveals-design-secrets-behind-persona-5s-distinctive-ui/)) | One brand colour carries identity. Diagonal composition plus a guide line steers the eye. Lighting and contrast mark priority. The team *toned down* excess animation for usability. | An **ink-slab diagonal wipe** with a calm-blue edge stripe and a big caption between scenes. **Skewed banners** for step and decision calls. One accent colour per state. Restraint: one big effect per action. |
| X: [@SatoruYouKoi](https://x.com/SatoruYouKoi/status/1939235165084991558) on P5 transitions | "Pick a single colour to create a silhouette and a shadow" and you have the P5 menu transition. | The wipe is a single ink colour plus one stripe: no gradients, no glow. |
| **Detroit: Become Human** ([Lidia Chía, UX of choice mechanics](https://medium.com/@lidiachia/the-detroit-game-experience-ux-of-choice-mechanics-f5cddcec7c3a)) | A clean HUD most of the time. Timed choices create pressure. Restrictions appear diegetically, as the "wall". Weak points: no correction after a pick, and goals that vanish too fast. | Choice timers with a draining bar, then **urgency in the last 3 s**. The Red Wall is a physical barrier (**hazard bands**). A "decision registered" **stamp** confirms the pick. We fix the weak spots: Ask-why does not burn the choice, and banners stay 1.5 s with the log keeping the record. |
| **Hades** ([teemo.dev systems teardown](https://teemo.dev/game-design/hades/systems/ux-ui-and-accessibility/)) | Juice is feedback (shake, numbers), and the loudest juice layers are **toggles**. Information lives in the world, not in panels. | Shake, hit-stop and particles are all off under reduced motion. **Count-up numbers** for instability, trust and ending recap. Status lives on the artifact (preview, test slip) rather than in extra panels. |
| **Death Stranding** ([Life's Hectic](https://www.lifeshectic.com/examples-of-ui-design-in-video-games/)) | Diegetic Cuff Links: the device on the character shows status and changes colour. Criticism: dense, noisy menus. | The **LED ring is the diegetic status** (colour plus spin speed). Keep menus sparse: the model drawer is a secondary sheet. |
| **Cyberpunk 2077** (observed gameplay UI; reference boards on [Game UI Database](https://www.gameuidatabase.com/)) | Glitch slices on critical events and hard cuts. | Only the *structure*: hard cuts and hit-stop on the Red Wall. **Not** the neon/glitch look, which would be the generic AI look Felix banned. |
| **Returnal** (observed) | Diegetic alerts and a strong audio-visual "danger" telegraph before an impact. | **Hit-stop (90 ms freeze) → shake → wall slam**: a telegraph, then the impact. |
| **Destiny 2** (observed menus) | Tactile hover states and crisp, quick panel slides; cards respond to the cursor. | **Card tilt** on mission cards (pointer-driven, desktop only), button press squash, and a hover nudge on QTE options. |
| **"Juice it or lose it"** (Jonasson & Purho, GDC Europe 2012), **"The art of screenshake"** (Vlambeer, 2013) | Small, many, responsive effects; hit-stop; particles; anticipation. | Hit-stop, shard bursts and stamp overshoot. |
| **React Bits** ([reactbits.dev](https://reactbits.dev)) | A component catalogue: SplitText, AnimatedContent, TiltedCard, ClickSpark, CountUp. | Ported as tiny vanilla equivalents: `Motion.split`, `stagger`, `tilt()`, `burst`, `count`. |
| **Motion** ([motion.dev/docs/performance](https://motion.dev/docs/performance)) | `transform`/`opacity` are compositor-safe; WAAPI can run them off the main thread; independent transforms via CSS variables are *not* accelerated, so animate `transform` directly. | Our layer is WAAPI-only and animates `transform` strings and opacity. Production: `motion`'s `animate()` (MIT). |
| **GSAP** ([standard license](https://gsap.com/community/standard-license/), [Webflow: GSAP is free](https://webflow.com/blog/gsap-becomes-free)) | Free for commercial use, plugins included (SplitText etc.). Prohibited only inside no-code visual animation builders that compete with Webflow. | **License-fine for LEDRING.** We did *not* vendor it: the needs are covered by about 120 lines of WAAPI, and that keeps the single file small. GSAP stays an option if timelines grow (labels, scrubbing). |

## 2. Rules (reliability first)

1. **Compositor-only:** animate `transform` and `opacity` only. (Exception: one-shot `stroke-dashoffset` draw of the ending flow SVG.) No width, height or top animation in JS. The meter and trust bar keep v1's CSS width transition, which is a known exception queued for `scaleX` in S21.
2. **Interruptible:** each element keeps one live `Animation` (`el.__anim`). A new animation cancels the old one, so spam-clicks never stack or stick. Fills use `both`, so the end state is explicit.
3. **No layout thrash:** read first (`getBoundingClientRect` for bursts, fly chips and tilt), then write once. Tilt writes happen in `requestAnimationFrame`, one per frame.
4. **Reduced motion:** `prefers-reduced-motion` *or* `?rm` sets `html.rm`. `Motion.run` swaps keyframes for a ≤160 ms opacity fade; shake, hit-stop, particles, tilt and the wipe are skipped; CSS animations and transitions are clamped; count-ups jump. Meaning is never motion-only: every state also has words, an icon and a colour.
5. **Test mode:** `?fast` clamps every duration to ≤60 ms, so e2e runs stay deterministic.
6. **Budget:** one hero effect per player action. Nothing ambient besides the LED ring. Nothing moves while the user is reading an answer.
7. **Brand:** light paper, ink `#0E1114`, state colours only. No glow, no blur-glass, no grain, no gradients-as-decoration.

**Tokens:** `ease.out (.2,.8,.2,1)` for entrances, `ease.snap (.3,1.4,.4,1)` for overshoot pops, `ease.in (.6,0,.8,.2)` for slams and exits. Durations: micro 120–220, element 380–560, scene 300+140+360.

## 3. Moments mapped to screens

| Screen | Moment | Pattern (source) | Implementation |
|---|---|---|---|
| **Menu** | Title builds letter by letter; ring, host line and buttons deal in | SplitText + stagger (React Bits); P5 line of sight | `enterScene("menu")`: `Motion.split(#m-title)` with 22 ms per char and snap ease, then `stagger` |
| Menu → Idea | **Ink-slab wipe** "PICK A BUILD" | P5 diagonal transition | `Motion.wipe(caption, swap)`: a skewed slab in for 300 ms, hold 140 ms, out for 360 ms; the scene swaps under cover |
| **Idea select** | Cards deal in with a 60 ms stagger; pointer **tilt**; press squash; solid buttons get an ink-blue "lip" shadow | Destiny tactile cards; TiltedCard | `tilt()` (hover-capable pointers only), `.btn:active scale(.96)` |
| **Drawer: ChatGPT plan** | Continue → spinner → consent sheet pops → **Connected** stamp; "Using ChatGPT plan" pill + "Manage usage ↗" | SIWC guidelines; stamp feedback | `siwcMockFlow()` → `Motion.pop`, `Motion.stamp` |
| Idea → Run | Wipe "BUILD START"; agent card, meter and panel slide in | — | `show("run", caption)` |
| **Run** | **Step banner** "v2 · WRITING" and **decision banner** "DECISION · Add polish" (crit edge for shortcut/plug) | Detroit chapter card × P5 call-out | `banner(text,tone)`: 1.5 s, skewed, translate only |
| Run | Instability and trust **count up**; LED ring colour and speed | Hades numbers; DS diegetic device | `Motion.count`; the v1 ring remains |
| **QTE** | Box **slams** up; options deal from the left; key caps rotate on hover; last 3 s → red timer + **urgency pulse**; pick → option inks black, others fall away, **spark burst**; timeout → **AUTO** stamp | Detroit timer; Juice | `qte()`: slam keyframes, `stagger`, `.urgent`, `.picked`, `burst`, `.stampmark` |
| **Red Wall** | **Hit-stop 90 ms** → shake → box slam; **hazard bands** crawl at top and bottom; BLOCK → **shatter** (22 shards, red/ink/white) + "⛔ BLOCKED" stamp; miss → **MISSED** stamp | Returnal telegraph; Vlambeer hit-stop | `Motion.hitstop`, `#choicelayer.wall .hz` (translate loop), `burst`, `stamp` |
| Run → End | Wipe "VERDICT · POLISHED" | — | `show("end", caption)` |
| **Ending** | Title split; ending **tag stamps** with overshoot; the flow path **draws** column by column; recap numbers count up; artifact frame pops; good endings → **ink confetti** from the tag; bad endings → a short shake | P5 results screen; Juice | `paintEnd` hook: `split`, `stamp`, `stroke-dashoffset`, `count`, `burst` |

## 4. Responsive behaviour (and how motion adapts)

- **Desktop** (≥1180×760): fixed stage of 1180×760. The ending fits 1280×800 with no scroll (measured 760/760).
- **≤1180 wide or ≤760 tall:** the stage fills the viewport (`100dvh`).
- **≤900 (tablet portrait):** scenes scroll. Run = agent+meter row, a 104 px log, then code | preview. **QTE and Red Wall become a bottom sheet** (16 px top radius, safe-area padding). Drawer = `min(380px,100%)`. The HUD chapter line is hidden. Banners move to 60 px.
- **≤600 (phone):** single column; **preview above code** (46dvh / 30dvh); full-width menu and ending buttons; the footer hint is hidden.
- **Motion on touch:** tilt is disabled (`hover:hover` only); press squash stays. Bursts are positioned from measured rects, so they work at every size.

## 5. Not done yet / next

- The meter and trust bar still animate `width` (CSS transition from v1). Switch to `scaleX` on an inner bar (S21).
- No sound. A soft tick in the last 3 s and a thud on BLOCK would add a lot; it needs a mute toggle (Hades-style).
- No in-app reduced-motion toggle yet (OS setting + `?rm` only).
- The P5, Detroit, Cyberpunk, Returnal and Destiny notes come from public talks and articles plus general observation. No assets or screenshots were used.
