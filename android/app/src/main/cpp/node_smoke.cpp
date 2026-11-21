#include <jni.h>
#include <node.h>
#include <string>

extern "C" JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NodeSmokeActivity_runNode(JNIEnv* env, jclass, jstring source) {
    const char* script_chars = env->GetStringUTFChars(source, nullptr);
    if (script_chars == nullptr) return 1;
    std::string command("node\0--eval\0", 12);
    command.append(script_chars);
    env->ReleaseStringUTFChars(source, script_chars);

    char* args[] = {command.data(), command.data() + 5, command.data() + 12, nullptr};
    return node::Start(3, args);
}
