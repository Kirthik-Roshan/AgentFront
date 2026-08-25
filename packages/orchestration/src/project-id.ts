export class ProjectIdSequence {
  readonly #year: number;
  #current: number;

  constructor(year = new Date().getUTCFullYear(), startingSequence = 0) {
    if (!Number.isInteger(year) || year < 2020 || year > 9999) throw new Error("Invalid project ID year.");
    if (!Number.isInteger(startingSequence) || startingSequence < 0 || startingSequence >= 1_000_000) {
      throw new Error("Invalid project ID starting sequence.");
    }
    this.#year = year;
    this.#current = startingSequence;
  }

  next(): string {
    this.#current += 1;
    if (this.#current > 999_999) throw new Error(`Project ID sequence exhausted for ${this.#year}.`);
    return `AF-${this.#year}-${String(this.#current).padStart(6, "0")}`;
  }
}

export function isProjectId(value: string): boolean {
  return /^AF-\d{4}-\d{6}$/.test(value);
}
