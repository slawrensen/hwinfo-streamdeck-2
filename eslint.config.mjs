import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["com.lawrensen.hwinfo.sdPlugin/bin/**", "node_modules/**", "release/**"]
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: globals.node
		}
	},
	{
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/explicit-module-boundary-types": "error",
			"no-console": ["error", { allow: ["error"] }]
		}
	},
	{
		// The probe is a console tool and the build scripts are plain Node.
		files: ["src/probe.ts", "scripts/**"],
		rules: {
			"no-console": "off"
		}
	}
);
