# KOJIMA_WOW: what we borrowed, and what we refused to copy (v7)

This file maps design *principles* from a few landmark games and websites to LEDRING mechanics.
We copied no assets, names, sounds, fonts or logos. "Codec", "odradek" and "strand" are used below only as shorthand for the design idea; the UI calls them CX-417 calls, SCAN and STRANDS.

## Research notes (honest)
- **X search:** returned mostly generic "best websites" threads. No single viral post gave us a concrete mechanic.
- **Reddit:** we didn't get useful threads from r/web_design, r/webdev or r/InternetIsBeautiful.
- **Awwwards SOTD 2026 sample:** GQ×AP Extraordinary Lab, iyO, Cerebrium, Equinox.
- **Named references, from known work:** Bruno Simon, Lusion, Active Theory, Igloo Inc, Messenger by Abeto, Neal.fun, Poolsuite, the Linear and Vercel launch pages, Rauno, Codrops.
  - Common thread: **one living centerpiece**, **a site that notices you**, **physical, tactile feedback**, **sound as an opt-in reward**, and **a single idea executed with total commitment**.
  - Neal.fun and Poolsuite show that personality beats polish.
- **Kojima sources:**
  - Psycho Mantis fourth-wall thesis (uu.diva-portal).
  - bosnan.net design essay.
  - Death Stranding strand/social-strand paper (silentblade).
  - mattdemers essay.
  - Game Informer interview with Kojima on likes and the deliberate absence of a thumbs-down.

## Mapping
| Source idea | Why it lands | LEDRING mechanic (v7) | Status |
|---|---|---|---|
| Psycho Mantis reads your memory card / controller | The game proves it can see *you*, outside the fiction | **Fourth-wall CX-417 call** on first Play. Built only from local signals: local time, phone vs desktop, battery (only if exposed without a prompt), past runs and their ending ("You let a network call through last time. I remember."), and the tab-switch count. The call ends with "None of this left your browser." | built |
| "Port swap" (the player must physically change something to win) | It breaks the input contract | The tab-away call: leave the tab during a build and CX-417 comments on how long you were gone. Idle 25 s in Chapter 0 gives "Still there?". Planned: a Red Wall variant you can only beat by resizing or rotating the device | partial |
| Codec calls | Dialogue as a ritual: ring, frame, scanlines, frequency | Codec-style overlay: ring SFX, a vertical-collapse open animation, the agent ring portrait vs a YOU silhouette, waveform bars while "talking", typed lines, tap/Enter/Esc. Non-blocking mini-call strip for interrupts | built |
| "!" alert | One glyph = instant dread; readable in 100 ms | A big red "!" pops over the agent card, with a two-tone alert SFX, right before every Red Wall | built |
| Odradek scanner pulse | Information revealed through a physical sweep | **SCAN**: a blue sweep runs down the code, a ping-ring fires, and the risky line is pinned red with its category and line number *before* the Red Wall asks you to decide. You see what you are judging | built |
| Strands: async traces of other players, likes, no thumbs-down | Togetherness without contact or toxicity | **STRANDS**: the menu canvas is a living network of builds. Others are **SIMULATED** and labelled on screen, and likes travel along the strands. Each direction shows "◇ N similar strands · ♥ L (simulated)". Ending: "◇ Leave a strand" stores your build locally and adds your node (▲ you) to the network. Likes only, no downvotes | built (simulated); real backend = plan S24 |
| Route planning | Planning *is* the gameplay | Today: the ending flowchart/route of decisions. Planned: a route map from fragments to brief to versions to ending, shared as a strand | plan |
| Timefall (the world ages what it touches) | A visible cost of time | Planned: the longer a QTE runs, the more code "greys"; diff decay | plan |
| BB / bond | Care for a fragile companion | The CX-417 ring *is* the companion; its state colour drives the menu centerpiece (calm/proc/crit from your last ending) | built (colour) |
| Cardboard box | Comedy inside tension | Planned: "Hide" QTE option. The agent pretends the tests pass, and the judge finds out | plan |
| Sons of Liberty AI colonel breakdown | The trusted voice glitches and the fiction cracks | Planned for the COMPROMISED ending: the CX-417 call text corrupts and starts quoting your own brief back at you | plan |
| P.T. looping hallway | Tiny space, endless dread, details change each loop | Planned "Loop" mode: same brief, same run, one detail changes each replay; find it | plan |

## Guardrails
- Privacy: no network, no permission prompts, nothing stored beyond the existing localStorage save, and the call says so.
- Every simulated social item carries a "simulated" label.
- Sound is off by default (HUD toggle, persisted). All synthesized with WebAudio.
- Reduced motion: the canvas draws one static frame; codec text appears at once; no sweep.
