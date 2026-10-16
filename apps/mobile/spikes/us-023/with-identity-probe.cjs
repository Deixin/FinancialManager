/* eslint-disable @typescript-eslint/no-require-imports */
const { withAppBuildGradle } = require('expo/config-plugins');
module.exports = function withIdentityProbe(config) {
  return withAppBuildGradle(config, (mod) => {
    const marker = '// US-023: explicit synthetic identity profile only.';
    if (!mod.modResults.contents.includes(marker))
      mod.modResults.contents += `\n${marker}
if(findProperty("fmIdentityProbe")=="us023") {
    react { entryFile = file(new File(projectRoot,"spikes/us-023/index.ts")) }
    android { defaultConfig { applicationId = "com.miudos.financialmanager.us023" } }
}
`;
    return mod;
  });
};
