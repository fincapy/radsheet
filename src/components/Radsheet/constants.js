/**
 * UI constants for the Radsheet component.
 *
 * These are grouped here to:
 * - centralize tuning knobs for layout/UX
 * - make rendering code (grid/headers) easier to test and reuse
 * - keep `Radsheet.svelte` focused on orchestration and state
 */

export const CELL_HEIGHT = 22; // px height for each grid row
export const CELL_WIDTH = 100; // px width for each grid column
export const ROW_HEADER_WIDTH = 50; // px width of row index gutter
export const COLUMN_HEADER_HEIGHT = 30; // px height of column header bar
export const SCROLLBAR_SIZE = 12; // px size of custom scrollbars

// Hot zone around edges used to trigger autoscroll during drag-select
export const EDGE = 24; // px
