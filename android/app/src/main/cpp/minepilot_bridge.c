#include <jni.h>

// JNI packaging smoke test only. No Bedrock transport or authentication.
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeProtocolVersion(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return 1;
}
