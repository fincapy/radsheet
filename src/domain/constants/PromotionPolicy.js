/**
 * @file Defines the policy for when a chunk should be promoted from a sparse
 * representation to a dense one, or demoted back. This is a performance
 * optimization to balance memory usage and access speed.
 */

/**
 * When a sparse chunk's fill ratio (non-empty cells / total cells) is at or
 * above this value, it will be converted to a dense chunk.
 * A dense chunk is more memory-efficient and faster for largely-filled chunks.
 * @type {number}
 */
export const PROMOTE_TO_DENSE_FILL_RATIO = 0.5;

/**
 * When a dense chunk's fill ratio drops to or below this value, it will be
 * converted back to a sparse chunk.
 * A sparse chunk is more memory-efficient for largely-empty chunks.
 * @type {number}
 */
export const DEMOTE_TO_SPARSE_FILL_RATIO = 0.3;

/**
 * The default capacity of the in-memory hot cache, measured in the number of
 * chunks it can hold. This is a key knob to tune for memory budget vs.
 * performance. A larger cache reduces the need to fetch chunks from persistent
 * storage (like IndexedDB), but consumes more RAM.
 * @type {number}
 */
export const DEFAULT_HOT_CHUNK_CAPACITY = 2000;
