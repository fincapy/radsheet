/**
 * @file Defines constants for cell types and JSDoc typedefs for chunk structures.
 * This provides a centralized, clear definition of the core data structures
 * used to store cell data.
 */

/**
 * Tag indicating that a cell is empty.
 * @type {0}
 */
export const CELL_TAG_EMPTY = 0;

/**
 * Tag indicating that a cell contains a number (Float64).
 * @type {1}
 */
export const CELL_TAG_NUMBER = 1;

/**
 * Tag indicating that a cell contains a string. The actual value is a numeric
 * ID that maps to the GlobalStringTable.
 * @type {2}
 */
export const CELL_TAG_STRING = 2;

/**
 * Tag indicating that a cell contains a boolean value. Booleans are stored as
 * 0 or 1 in the numeric payload of dense chunks.
 * @type {3}
 */
export const CELL_TAG_BOOLEAN = 3;

/**
 * @typedef {import('../strings/GlobalStringTable').GlobalStringTable} GlobalStringTable
 */

/**
 * @typedef {0 | 1 | 2 | 3} CellTag
 * A numeric tag representing the type of data stored in a cell.
 */

/**
 * @typedef {object} SparseChunk
 * @property {'sparse'} kind - The type discriminator for the chunk.
 * @property {number} nonEmptyCellCount - The number of cells that have a value.
 * @property {Map<number, number|string|boolean>} localIndexToValue - A map from the cell's local index within the chunk to its JavaScript value.
 * @property {boolean} isDirty - A flag indicating if the chunk has been modified since it was last persisted.
 */

/**
 * @typedef {object} DenseChunk
 * @property {'dense'} kind - The type discriminator for the chunk.
 * @property {number} nonEmptyCellCount - The number of cells that have a value.
 * @property {boolean} isDirty - A flag indicating if the chunk has been modified since it was last persisted.
 * @property {Uint8Array} tagByLocalIndex - A struct-of-arrays field. An array where each index corresponds to a cell's local index, and the value is its `CellTag`.
 * @property {Float64Array} numberByLocalIndex - A struct-of-arrays field. Stores numeric values for cells tagged as `CELL_TAG_NUMBER` or `CELL_TAG_BOOLEAN` (as 0 or 1).
 * @property {Uint32Array} stringIdByLocalIndex - A struct-of-arrays field. Stores string IDs for cells tagged as `CELL_TAG_STRING`. The ID maps to the `GlobalStringTable`.
 */

/**
 * @typedef {SparseChunk | DenseChunk} GenericChunk
 * A union type representing any kind of chunk. The `kind` property is used to
 * discriminate between the different chunk structures at runtime.
 */
