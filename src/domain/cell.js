export class Cell {
	constructor({ row, column, value }) {
		this.row = row;
		this.column = column;
		this.value = value;
	}

	id() {
		return `${this.row}${this.column}`;
	}
}
