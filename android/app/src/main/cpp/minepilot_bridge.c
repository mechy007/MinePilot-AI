#include <jni.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

// JNI bridge and local UDP socket preflight only. No Bedrock protocol or login.
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeProtocolVersion(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return 1;
}

// Return 0 if a native IPv4 UDP socket can bind to local loopback.
// No packets are sent; no remote hosts or Minecraft sessions are contacted.
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeUdpPreflight(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) return 1;
    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(0);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int result = bind(fd, (const struct sockaddr *)&addr, sizeof(addr));
    close(fd);
    return result == 0 ? 0 : 2;
}
