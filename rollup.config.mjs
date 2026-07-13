import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.lawrensen.hwinfo.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "es",
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	// koffi is a native module — it cannot be bundled; scripts/copy-koffi.mjs vendors it
	// into the .sdPlugin's bin/node_modules so the import resolves at runtime.
	external: ["koffi"],
	// @elgato/utils declares no sideEffects, so rollup keeps its barrel's
	// Option/OptionGroup modules for their top-level z.object() calls even
	// though nothing imports a binding from them — dragging all of zod
	// (~14 KB minified) into the bundle. The SDK runtime only uses
	// Enumerable/EventEmitter/withResolvers/Lazy. Marking the lists/ modules
	// side-effect free lets rollup drop them, and zod falls out with its
	// last importer; if a future SDK version starts importing Option, the
	// modules are retained again automatically.
	treeshake: {
		moduleSideEffects: (id) => !/[\\/]@elgato[\\/]utils[\\/]dist[\\/]lists[\\/]/.test(id)
	},
	plugins: [
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching &&
			terser({
				compress: { passes: 2 },
				format: { comments: false }
			}),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

export default config;
