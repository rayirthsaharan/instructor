/**
 * Parameters of the diagram panel detector (docs/ACCURACY_TEST_PLAN.md section 7). Fractions are of the page
 * (or of the content box where stated). Tune only on the Lumen pages and spare manuals, never on the scored manuals.
 */

/** Step 1: long edge of the working image. */
export const WORK_LONG_EDGE = 800;
/** Step 1 (addition): when more than this share of ink pixels is isolated, the page is a noisy scan: average-downscale and median-filter (spec order). Clean renders skip the median because it erases 1 px rules. */
export const NOISY_ISOLATED_INK_SHARE = 0.02;
/** Step 1: pages with a lower mean luminance (0..1) are inverted. */
export const DARK_PAGE_MEAN_LUMINANCE = 0.45;
/** Step 1: Otsu's threshold is clamped to this grey range; ink is darker than the threshold. */
export const OTSU_MIN = 140;
export const OTSU_MAX = 230;

/** Step 3 (addition): rule lines are found with a threshold this far below the page background, capped at OTSU_MAX. */
export const LINE_BACKGROUND_MARGIN = 25;

/** Step 2: connected components whose bounding box is smaller than this share of the page are specks. */
export const SPECK_AREA_FRACTION = 0.0002;

/** Step 3 (pass A): minimum line length as a share of the content box. Spec 0.25; 0.2 so Lumen's narrow side-by-side panels (23% of the height) qualify. */
export const LINE_MIN_LENGTH_FRACTION = 0.2;
/** Step 3: 1-D closing length as a share of the page. Spec 0.02; 0.012 so a 2% gutter between framed panels is not bridged. */
export const LINE_CLOSE_FRACTION = 0.012;
/** Step 3 (addition): fragments of a broken line are kept from this length (share of the content box) and merged over gaps up to the merge gap. */
export const LINE_FRAGMENT_MIN_FRACTION = 0.08;
export const LINE_MERGE_GAP_FRACTION = 0.1;
/** Fragments whose centres differ by at most this many pixels are collinear. */
export const LINE_MERGE_ACROSS_PX = 2;
/** Step 3: a line is at most this thick (share of the page). */
export const LINE_MAX_THICKNESS_FRACTION = 0.01;
/** Step 3 (addition): a closed run must be at least this inked (dashed and dotted lines are 0.3 to 0.6; text rows are lower). */
export const LINE_MIN_INK_FRACTION = 0.3;
/** Step 3: each side of a rectangle needs this much line coverage. */
export const SIDE_COVERAGE_MIN = 0.8;
/** Step 3: how far line ends may miss a corner (share of the short side). */
export const CORNER_TOLERANCE_FRACTION = 0.015;
/** Step 3: at least this many rectangles covering this share of the content box make a framed page. */
export const FRAMES_MIN_COUNT = 2;
export const FRAMES_MIN_COVERAGE = 0.35;
/** Step 3 (addition): a set of frames whose members overlap by more than this share of the smaller one is line noise, not a layout. */
export const FRAMES_MAX_OVERLAP = 0.1;
/** Bounds on pass A work (strongest candidates kept). */
export const MAX_LINE_CANDIDATES = 48;
export const MAX_LINE_OBJECTS = 6000;

/** Step 4 (pass B): shortest blank gap that cuts, as a share of the page height / width. */
export const GAP_MIN_FRACTION = 0.025;
export const XY_MAX_DEPTH = 4;
/** A row or column with at most this share of ink (of the block) counts as blank (scan noise tolerance). */
export const BLANK_INK_FRACTION = 0.003;
/** Caption: text block shorter than this share of the page height. */
export const CAPTION_MAX_HEIGHT_FRACTION = 0.06;
/** Caption merge: distance to its picture, share of the page height. */
export const CAPTION_MERGE_DISTANCE_FRACTION = 0.03;
/** Caption merge: horizontal overlap with the picture, share of the caption width ("same column"). */
export const CAPTION_COLUMN_OVERLAP = 0.5;
/** Text block: ink density below this (spec 0.08, but the bounding box of a real text line is 0.15-0.3 inked and the darkest-pixel downscale thickens strokes) and every ink row-run no taller than the line height below. */
export const TEXT_MAX_INK_DENSITY = 0.5;
export const TEXT_LINE_MAX_HEIGHT_FRACTION = 0.03;
/** Running header / footer zone. */
export const HEADER_FOOTER_FRACTION = 0.07;

/** Step 5: size filter. */
export const PANEL_MIN_SIDE_OF_SHORT = 0.08;
export const PANEL_MIN_AREA_FRACTION = 0.02;
export const PANEL_MAX_AREA_FRACTION = 0.85;
export const MAX_PANELS = 12;
export const GAP_RETRY_FACTOR = 1.5;
export const GAP_RETRIES = 2;

/** Step 6: padding on every side, row grouping tolerance. */
export const PANEL_PAD = 0.01;
export const ROW_TOLERANCE = 0.02;

/** Skew: angles searched (degrees) and the sharpening needed over 0 degrees to call a page skewed. */
export const SKEW_LIMIT_DEG = 2;
export const SKEW_SEARCH_DEG = 5;
export const SKEW_STEP_DEG = 0.5;
export const SKEW_MIN_GAIN = 1.25;
