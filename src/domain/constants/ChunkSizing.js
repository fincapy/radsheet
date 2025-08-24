/**
 * @file Contains constants related to the sizing and indexing of chunks within the sheet.
 * These values are critical for performance, as they are used in bitwise operations
 * for quick calculations of cell and chunk coordinates.
 */

// One chunk holds 64x64 cells (power of two -> cheap bit math)
export const CHUNK_NUM_ROWS = 64;
export const CHUNK_NUM_COLS = 64;

// The number of bits to shift a global row or column index to get the chunk index.
// This is equivalent to Math.log2(CHUNK_NUM_ROWS).
export const CHUNK_ROW_SHIFT_BITS = 6;
export const CHUNK_COL_SHIFT_BITS = 6;

// The total number of cells contained within a single chunk.
export const CELLS_PER_CHUNK = CHUNK_NUM_ROWS * CHUNK_NUM_COLS;

// Used to pack a (chunkRow, chunkCol) coordinate pair into a single numeric key.
// The maximum number of chunk columns is chosen to be 2^20, which along with 2^20
// chunk rows allows for approximately 1 trillion (10^12) unique chunk keys before
// overflow would occur in standard JavaScript number types.
// chunkKey = chunkRow * MAX_CHUNK_COLUMNS_FOR_KEY_PACKING + chunkCol
export const MAX_CHUNK_COLUMNS_FOR_KEY_PACKING = 1 << 20;
