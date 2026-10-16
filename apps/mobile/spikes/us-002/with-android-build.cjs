/* eslint-disable @typescript-eslint/no-require-imports */
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidBuild(config) {
  return withAppBuildGradle(config, (mod) => {
    const marker =
      '// US-002: invoke Hermes relative to the JS root on Windows.';
    const runtimeMarker =
      '// US-002: package the OpenSSL ABI linked by expo-sqlite.';
    if (!mod.modResults.contents.includes(runtimeMarker)) {
      mod.modResults.contents +=
        '\n' +
        runtimeMarker +
        '\n' +
        String.raw`
def us002OpenSslCoordinate = "io.github.ronickg:openssl:3.3.2-1"
configurations { us002OpenSslRuntime { transitive = false } }
dependencies {
    implementation us002OpenSslCoordinate
    us002OpenSslRuntime(us002OpenSslCoordinate + "@aar")
}
def us002JniDirectory = layout.buildDirectory.dir("us002-openssl/jni")
def us002Abis = (findProperty("reactNativeArchitectures") ?: "armeabi-v7a,arm64-v8a,x86,x86_64").split(",")
def us002ExtractOpenSsl = tasks.register("us002ExtractOpenSsl", Sync) {
    from { zipTree(configurations.us002OpenSslRuntime.singleFile) }
    include us002Abis.collect { "prefab/modules/crypto/libs/android." + it + "/libcrypto.so" }
    eachFile { details ->
        def abi = details.relativePath.segments[4].substring("android.".length())
        details.path = abi + "/" + details.name
    }
    includeEmptyDirs = false
    into us002JniDirectory
}
android.sourceSets.main.jniLibs.srcDir(us002JniDirectory.get().asFile)
tasks.named("preBuild").configure { dependsOn(us002ExtractOpenSsl) }
tasks.configureEach {
    if (name.startsWith("merge") && name.endsWith("JniLibFolders")) {
        dependsOn(us002ExtractOpenSsl)
    }
}
`;
    }
    if (mod.modResults.contents.includes(marker)) return mod;
    const anchor = /^(\s*hermesCommand = .+)$/m;
    if (!anchor.test(mod.modResults.contents))
      throw new Error('HERMES_TEMPLATE_CHANGED');
    mod.modResults.contents = mod.modResults.contents.replace(
      anchor,
      (line) =>
        line +
        '\n' +
        String.raw`
    ${marker}
    if (System.getProperty("os.name").toLowerCase().contains("windows")) {
        hermesCommand = new File(projectRoot).toPath().relativize(new File(hermesCommand.get()).toPath()).toString()
    }
`,
    );
    return mod;
  });
};
