/**
 * @file FenwickTree (or Binary Indexed Tree) data structure for efficient prefix sum queries.
 */

export class FenwickTree {
	/**
	 * @param {number} size The number of items in the tree (0-based).
	 */
	constructor(size) {
		this.size = size;
		this.tree = new Array(size + 1).fill(0);
	}

	/**
	 * Adds a delta to the value at a given index.
	 * @param {number} indexOneBased The 1-based index to update.
	 * @param {number} delta The value to add.
	 */
	add(indexOneBased, delta) {
		for (let i = indexOneBased; i <= this.size; i += i & -i) {
			this.tree[i] += delta;
		}
	}

	/**
	 * Calculates the cumulative sum up to a given index.
	 * @param {number} countOneBased The 1-based index to sum up to.
	 * @returns {number} The cumulative sum.
	 */
	sum(countOneBased) {
		let res = 0;
		for (let i = countOneBased; i > 0; i -= i & -i) {
			res += this.tree[i];
		}
		return res;
	}

	/**
	 * Finds the 0-based index of the k-th item (where k is 1-based).
	 * This is the "rank" or "select" operation.
	 * It runs in O(log n) time.
	 * @param {number} k - 1-based rank.
	 * @returns {number} 0-based index, or -1 if k is out of bounds.
	 */
	findKth(k) {
		if (k <= 0 || k > this.sum(this.size)) {
			return -1;
		}

		let idx = 0;
		let p2 = 1;
		while (p2 * 2 <= this.size) {
			p2 *= 2;
		}

		for (; p2 > 0; p2 >>= 1) {
			if (idx + p2 <= this.size) {
				if (this.tree[idx + p2] < k) {
					k -= this.tree[idx + p2];
					idx += p2;
				}
			}
		}
		return idx;
	}
}
