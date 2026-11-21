plugins { id("com.android.application") }
val nodeSmoke = providers.gradleProperty("minepilotNodeSmoke").map(String::toBoolean).getOrElse(false)
val nodeSmokeDir = layout.buildDirectory.dir("node-smoke")

android {
    namespace = "ai.minepilot.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "ai.minepilot.app"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a") }
    }
    if (nodeSmoke) {
        ndkVersion = "28.0.13004108"
        sourceSets.getByName("debug").assets.srcDir(nodeSmokeDir.map { it.dir("notices") })
    }
    buildTypes.getByName("debug") {
        manifestPlaceholders["minepilotNodeSmoke"] = nodeSmoke.toString()
        if (nodeSmoke) {
            applicationIdSuffix = ".runtimeprobe"
            externalNativeBuild.cmake.arguments += listOf(
                "-DANDROID_STL=c++_shared",
                "-DMINEPILOT_NODE_SMOKE_DIR=${nodeSmokeDir.get().asFile.absolutePath}"
            )
        }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt") } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies { testImplementation("junit:junit:4.13.2") }
