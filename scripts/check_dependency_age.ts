const minimumAgeDays = Number(Deno.env.get('MINIMUM_DEPENDENCY_AGE_DAYS') ?? '7');

if (!Number.isFinite(minimumAgeDays) || minimumAgeDays < 0) {
	throw new Error('MINIMUM_DEPENDENCY_AGE_DAYS must be a non-negative number');
}

type Lockfile = {
	npm?: Record<string, unknown>;
	jsr?: Record<string, unknown>;
};

type Dependency = {
	registry: 'npm' | 'jsr';
	name: string;
	version: string;
};

function splitPackageVersion(value: string): { name: string; version: string } {
	const separator = value.lastIndexOf('@');
	if (separator <= 0 || separator === value.length - 1) {
		throw new Error(`Cannot parse locked dependency: ${value}`);
	}
	return { name: value.slice(0, separator), version: value.slice(separator + 1) };
}

async function npmPublishedAt(name: string, version: string): Promise<Date> {
	const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
	if (!response.ok) {
		throw new Error(`npm metadata request failed for ${name}: ${response.status}`);
	}
	const metadata = await response.json() as { time?: Record<string, string> };
	const publishedAt = metadata.time?.[version];
	if (!publishedAt) throw new Error(`npm has no publication date for ${name}@${version}`);
	return new Date(publishedAt);
}

async function jsrPublishedAt(name: string, version: string): Promise<Date> {
	const [scope, packageName] = name.replace(/^@/, '').split('/');
	if (!scope || !packageName) throw new Error(`Cannot parse JSR package name: ${name}`);
	const response = await fetch(
		`https://jsr.io/@${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}/meta.json`,
	);
	if (!response.ok) {
		throw new Error(`JSR metadata request failed for ${name}: ${response.status}`);
	}
	const metadata = await response.json() as { versions?: Record<string, { createdAt?: string }> };
	let publishedAt = metadata.versions?.[version]?.createdAt;
	if (!publishedAt) {
		const versionResponse = await fetch(
			`https://api.jsr.io/scopes/${encodeURIComponent(scope)}/packages/${
				encodeURIComponent(packageName)
			}/versions/${encodeURIComponent(version)}`,
		);
		if (!versionResponse.ok) {
			throw new Error(`JSR version metadata request failed for ${name}@${version}: ${versionResponse.status}`);
		}
		const versionMetadata = await versionResponse.json() as { createdAt?: string };
		publishedAt = versionMetadata.createdAt;
	}
	if (!publishedAt) throw new Error(`JSR has no publication date for ${name}@${version}`);
	return new Date(publishedAt);
}

const lockfile = JSON.parse(await Deno.readTextFile(new URL('../deno.lock', import.meta.url))) as Lockfile;
const dependencies: Dependency[] = [
	...Object.keys(lockfile.npm ?? {}).map((value) => ({ registry: 'npm' as const, ...splitPackageVersion(value) })),
	...Object.keys(lockfile.jsr ?? {}).map((value) => ({ registry: 'jsr' as const, ...splitPackageVersion(value) })),
];
const cutoff = new Date(Date.now() - minimumAgeDays * 24 * 60 * 60 * 1000);

const tooNew: string[] = [];
for (const dependency of dependencies) {
	const publishedAt = dependency.registry === 'npm'
		? await npmPublishedAt(dependency.name, dependency.version)
		: await jsrPublishedAt(dependency.name, dependency.version);
	if (publishedAt > cutoff) {
		tooNew.push(`${dependency.registry}:${dependency.name}@${dependency.version} (${publishedAt.toISOString()})`);
	}
}

if (tooNew.length > 0) {
	throw new Error(
		`Dependencies newer than ${minimumAgeDays} days:\n${tooNew.map((dependency) => `- ${dependency}`).join('\n')}`,
	);
}

console.log(`All ${dependencies.length} locked dependencies are at least ${minimumAgeDays} days old.`);
