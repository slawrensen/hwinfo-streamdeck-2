{
	"target_defaults": {
		"sources": ["hwsm.c", "hwsm.rc"],
		"libraries": ["advapi32.lib"],
		"defines": ["NAPI_VERSION=8"],
		"msvs_settings": {
			"VCCLCompilerTool": {
				"WarningLevel": "4",
				"WarnAsError": "true",
				"BufferSecurityCheck": "true",
				"Optimization": 1,
				"FavorSizeOrSpeed": 2,
				"AdditionalOptions": ["/guard:cf", "/Brepro"]
			},
			"VCLinkerTool": {
				"LinkIncremental": "1",
				"RandomizedBaseAddress": "2",
				"DataExecutionPrevention": "2",
				"AdditionalOptions": ["/guard:cf", "/CETCOMPAT", "/Brepro", "/PDBALTPATH:%_PDB%"]
			}
		}
	},
	"targets": [
		{
			"target_name": "hwsm"
		},
		{
			"target_name": "hwsm_test",
			"defines": ["HWSM_TEST_HOOKS"]
		},
		{
			"target_name": "hwsm_protomm",
			"defines": ["HWSM_PROTOCOL_VERSION=999"]
		}
	]
}
