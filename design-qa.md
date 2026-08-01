# Menu dashboard fidelity QA

**Comparison target**

- Source visual truth: `C:\Users\PC\.codex\attachments\7dcb6d7b-be66-4495-a665-5a88b2fa202d\image-2.png`
- Reference atlas: `public/assets/ui/button-state-atlas.png` (generated from the supplied style reference).
- Rendered implementation: Codex in-app browser capture of the live Phaser Menu scene, 2026-08-01.
- Implementation screenshot: `D:\game_develop\rymthic_game\menu-buttons-live.png`
- Viewport: fixed game canvas `1440 × 810` CSS px, captured in an `1280 × 720` in-app-browser viewport.
- Source pixels: `1487 × 1058`; runtime canvas: `1440 × 810`; device density: 1×. The source art is fit to the established 16:9 game stage, preserving the game's existing viewport and gameplay layout.
- Atlas pixels: `1536 × 1024`; runtime screenshot pixels: `1280 × 720`; no density normalization was needed for the state comparison because the atlas is a reference board and the runtime screenshot is a viewport capture.
- State: no active run; the live `START BALL HOP` primary button is interactive and starts the first Ball Hop run.

**Full-view comparison evidence**

The rendered Menu capture shows the same runway composition, hero placement, RYTHMIC logo, magenta primary CTA, cyan secondary CTA, mission card, three stat chips, and utility rail. The generated atlas was used as a component reference; the actual controls are live Phaser containers with real text, pointer states, hit areas, and scene transitions.

Focused button-state comparison was required and completed against the atlas: primary, secondary, utility, and modal controls were checked in idle and hover states; pressed and disabled behavior is implemented in `makeButton`.

**Findings**

- [P3] Generated atlas is a reference sheet, not a runtime sprite sheet
  Location: `public/assets/ui/button-state-atlas.png`.
  Evidence: the atlas documents state geometry and dimensions; live labels and interactions are rendered by Phaser.
  Impact: text stays dynamic and localizable while the visual system remains faithful to the generated reference.
  Fix: none required; this is intentional component architecture.

**Required fidelity surfaces**

- Fonts and typography: live Orbitron/Rajdhani text uses italic display treatment for button labels, preserving the generated atlas's arcade slant and hierarchy.
- Spacing and layout rhythm: primary, secondary, utility, and modal sizes are documented in the atlas; the Menu uses explicit component dimensions and clipped-corner geometry.
- Colors and tokens: cyan, magenta, violet, navy, and muted disabled tokens map directly to `Theme.js` and brighten on hover.
- Image quality and asset fidelity: the supplied runway/hero assets remain intact; the generated atlas is used for button design guidance, not as a flattened dashboard replacement.
- Copy and content: labels remain live Phaser text. The primary CTA starts Ball Hop for a new player and resumes an existing run when one is present.

**Primary interactions tested**

- Boot → Calibration → Menu in the in-app browser.
- Main dashboard CTA → Upgrade / first-run setup.
- Automated browser smoke: Boot → Calibration → Menu → Upgrade → Level → live combat; no console errors.

**Implementation checklist**

- [x] Generate and ship a button-state reference atlas.
- [x] Map the main CTA, new-run CTA, Practice, Unlocks, and Audio to real Phaser controls.
- [x] Implement idle, hover, pressed, disabled, icon, and modal states in the shared widget.
- [x] Keep the Ball Hop gameplay UI and hero/enemy animation systems unchanged.

**Final result**

passed
