/**
 * Error indicating model output failed schema validation.
 */
export class SchemaValidationError extends Error {
	override readonly cause?: unknown;

	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'SchemaValidationError';
		this.cause = cause;
	}
}
