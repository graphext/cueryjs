import { build, emptyDir } from "jsr:@deno/dnt";

// Read version from deno.json
const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const { name, version, license } = denoJson;

console.log(`Building ${name}@${version} for npm...`);

await emptyDir("./npm");

await build({
	entryPoints: ["./mod.ts"],
	outDir: "./npm",
	shims: {
		deno: true,
	},
	// Skip type checking - dnt's Node.js types differ from Deno's
	// The code is already type-checked by `deno check`
	typeCheck: false,
	// Don't run tests in npm build
	test: false,
	compilerOptions: {
		lib: ["ESNext", "DOM"],
		target: "Latest",
	},
	package: {
		name,
		version,
		description: "Cuery tools for AI-powered keyword research and brand analysis",
		license,
		repository: {
			type: "git",
			url: "git+https://github.com/graphext/cueryjs.git",
		},
		bugs: {
			url: "https://github.com/graphext/cueryjs/issues",
		},
	},
	postBuild() {
		Deno.copyFileSync("README.md", "npm/README.md");
	},
});

console.log(`Done! Package built in ./npm`);
