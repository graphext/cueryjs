import type { ModelIdentifier } from './schemas/models.schema.ts';
import { cleanColumnName } from './utils.ts';

/**
 * Will eventually contain helpers to get metadata about models, e.g. pricing.
 *
 * Represents a model identifier with optional provider and model name.
 * Can parse strings like "openai/gpt-4" or just "gpt-4".
 */
export class ModelId {
	readonly name: string;
	readonly provider: string | null;

	constructor(name: ModelIdentifier) {
		if (!name.includes('/')) {
			this.provider = null;
			this.name = name.toLowerCase();
			return;
		}

		const parts = name.split('/', 2);
		this.provider = parts[0];
		this.name = parts[1];
	}

	toString(): string {
		if (this.provider) {
			return `${this.provider}/${this.name}`;
		}
		return this.name;
	}

	toJSON(): string {
		return this.toString();
	}

	inspect(): string {
		return `ModelId(provider=${JSON.stringify(this.provider)}, name=${JSON.stringify(this.name)})`;
	}

	equals(other: ModelId | string): boolean {
		if (typeof other === 'string') {
			return this.toString() === other;
		}
		if (other instanceof ModelId) {
			return this.provider === other.provider && this.name === other.name;
		}
		return false;
	}

	columnName(includeProvider: boolean = false): string {
		if (includeProvider && this.provider) {
			return cleanColumnName(`${this.provider}_${this.name}`);
		}
		return cleanColumnName(this.name);
	}
}
