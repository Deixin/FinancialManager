/* eslint-disable @typescript-eslint/no-require-imports */
const { withAppBuildGradle } = require('expo/config-plugins');
module.exports = function withSchemaProbe(config) {
  return withAppBuildGradle(config, (mod) => {
    const marker = '// US-021: explicit synthetic schema profile only.';
    if (!mod.modResults.contents.includes(marker))
      mod.modResults.contents += `\n${marker}
if (findProperty("fmSchemaProbe") == "us021") {
    react { entryFile = file(new File(projectRoot, "spikes/us-021/index.ts")) }
    android { defaultConfig { applicationId = "com.miudos.financialmanager.us021" } }
}
`;
    return mod;
  });
};
