/**
 * Layout — the single source of truth for screen geometry (DESIGN.md §2).
 *
 * The canvas is a fixed 1440×810 fitted to the window. The play field is the
 * whole screen minus the two HUD bars: the road owns everything between them.
 * Nothing in src/ may hardcode a panel rect that belongs here.
 */

export const CANVAS_W = 1440;
export const CANVAS_H = 810;

export const TOP_HUD_H = 92;       // top info bar (enemy / phrase / combo) — 80px avatar
export const BOTTOM_HUD_H = 200;   // bottom bar (hero 88px + HP/MP / beat / 2×5 skill bar)

/** The BallHop stage — full width between the two HUD bars. */
export const STAGE = {
  x: 0,
  y: TOP_HUD_H,
  width: CANVAS_W,
  height: CANVAS_H - TOP_HUD_H - BOTTOM_HUD_H,   // 518
};

export const HORIZON_Y_RATIO = 0.25;   // horizon inside the stage
export const BALL_Y_RATIO = 0.80;      // ball plane inside the stage
export const ROAD_WIDTH_FRACTION = 0.74; // road occupies this fraction of stage width

export const HUD_PAD = 12;
export const CORNER_RADIUS = 10;

// --- HUD sub-regions (§2) ---
export const TOP_LEFT_W = 320;     // enemy zone
export const TOP_RIGHT_W = 320;    // combo / accuracy zone
export const BOTTOM_LEFT_W = 320;  // hero zone
export const BOTTOM_RIGHT_W = 520; // skill bar zone

export const SKILL_SLOT = 44;      // skill slot size
export const SKILL_GAP = 6;        // gap between slots
