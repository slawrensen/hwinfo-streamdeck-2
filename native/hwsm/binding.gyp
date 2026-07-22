{
	"targets": [
		{
			"target_name": "hwsm",
			"sources": ["hwsm.c"],
			"libraries": ["advapi32.lib"],
			"msvs_settings": {
				"VCCLCompilerTool": {
					"Optimization": 1,
					"FavorSizeOrSpeed": 2
				}
			}
		}
	]
}
