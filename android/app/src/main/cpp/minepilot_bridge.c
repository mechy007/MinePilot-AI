#include <jni.h>
#include <errno.h>
#include <sys/socket.h>
#include <unistd.h>

// JNI/NDK networking capability smoke check; does not send packets or join worlds.
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeProtocolVersion(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return 1;
}

// Returns 0 when an IPv4 UDP socket can be opened and closed; negative errno otherwise.
// The socket is never connected, bound, or used to transmit data.
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeUdpSocketProbe(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    int fd = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return -errno;
    if (close(fd) != 0) return -errno;
    return 0;
}
