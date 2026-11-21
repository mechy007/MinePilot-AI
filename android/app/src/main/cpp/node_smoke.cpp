#include <jni.h>
#include <node.h>
#include <string>

extern "C" JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NodeSmokeActivity_runNode(JNIEnv* env, jclass, jstring entrypoint) {
    const char* entrypoint_chars = env->GetStringUTFChars(entrypoint, nullptr);
    if (entrypoint_chars == nullptr) return 1;
    std::string command("node\0", 5);
    command.append(entrypoint_chars);
    env->ReleaseStringUTFChars(entrypoint, entrypoint_chars);

    char* args[] = {command.data(), command.data() + 5, nullptr};
    return node::Start(2, args);
}
