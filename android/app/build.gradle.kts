plugins { id("com.android.application") }
val nodeSmoke = providers.gradleProperty("minepilotNodeSmoke").map(String::toBoolean).getOrElse(false)
val nodeSmokeDir = layout.buildDirectory.dir("node-smoke")
val xboxClientId = providers.gradleProperty("minepilotXboxClientId").getOrElse("")

android {
    namespace = "ai.minepilot.app"
    buildFeatures { buildConfig = true }
    compileSdk = 35
    defaultConfig {
        applicationId = "ai.minepilot.app"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "XBOX_CLIENT_ID", "\\\"$xboxClientId\\\"")
        ndk { abiFilters += listOf("arm64-v8a") }
    }
    if (nodeSmoke) {
        ndkVersion = "28.0.13004108"
        sourceSets.getByName("debug").assets.srcDirs(
            nodeSmokeDir.map { it.dir("notices") },
            nodeSmokeDir.map { it.dir("sdk") }
        )
    }
    buildTypes.getByName("debug") {
        manifestPlaceholders["minepilotNodeSmoke"] = nodeSmoke.toString()
        if (nodeSmoke) {
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
