#include <jni.h>
#include <string.h>
#include "raknet_ping.h"
#include "raknet_pong.h"
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

JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeRaknetPingCodecSelfTest(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    uint8_t packet[MP_RAKNET_PING_SIZE] = {0};
    if (mp_encode_unconnected_ping(packet, sizeof(packet),
        UINT64_C(0x0102030405060708), UINT64_C(0x1112131415161718)) != MP_RAKNET_PING_SIZE) return 1;
    const uint8_t ts[] = {1,2,3,4,5,6,7,8};
    const uint8_t guid[] = {0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18};
    if (packet[0] != 1 || memcmp(packet+1, ts, 8) ||
        memcmp(packet+9, MP_RAKNET_MAGIC, 16) || memcmp(packet+25, guid, 8)) return 2;
    if (mp_encode_unconnected_ping(packet, 32, 0, 0) != -1 ||
        mp_encode_unconnected_ping(NULL, 33, 0, 0) != -1) return 3;
    return 0;
}

/* On-device offline codec verification. No network traffic or world joining. */
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeRaknetPongCodecSelfTest(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    uint8_t packet[39] = {0};
    packet[0] = 0x1c;
    for (int i = 0; i < 8; ++i) {
        packet[1+i] = (uint8_t)(i+1);
        packet[9+i] = (uint8_t)(i+17);
    }
    memcpy(packet+17, MP_RAKNET_MAGIC, 16);
    packet[33] = 0;
    packet[34] = 4;
    memcpy(packet+35, "MCPE", 4);
    mp_raknet_pong decoded = {0};
    if (mp_decode_unconnected_pong(packet, sizeof(packet), &decoded) != 0) return 1;
    if (decoded.timestamp != UINT64_C(0x0102030405060708) ||
        decoded.server_guid != UINT64_C(0x1112131415161718) ||
        decoded.motd_length != 4 || memcmp(decoded.motd, "MCPE", 4)) return 2;
    packet[17] ^= 1;
    if (mp_decode_unconnected_pong(packet, sizeof(packet), &decoded) == 0) return 3;
    packet[17] ^= 1;
    if (mp_decode_unconnected_pong(packet, sizeof(packet)-1, &decoded) == 0) return 4;
    return 0;
}

/* Local-only UDP roundtrip: encoded RakNet ping bytes, never a remote server. */
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeRaknetUdpLoopbackSelfTest(JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    int receiver = -1, sender = -1, code = 1;
    receiver = socket(AF_INET, SOCK_DGRAM, 0);
    sender = socket(AF_INET, SOCK_DGRAM, 0);
    if (receiver < 0 || sender < 0) goto done;
    struct timeval timeout = {.tv_sec = 0, .tv_usec = 250000};
    if (setsockopt(receiver, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) != 0) goto done;
    struct sockaddr_in dest = {0};
    dest.sin_family = AF_INET;
    dest.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    dest.sin_port = htons(0);
    if (bind(receiver, (struct sockaddr *)&dest, sizeof(dest)) != 0) goto done;
    socklen_t destlen = sizeof(dest);
    if (getsockname(receiver, (struct sockaddr *)&dest, &destlen) != 0) goto done;
    uint8_t packet[MP_RAKNET_PING_SIZE], received[MP_RAKNET_PING_SIZE + 1];
    if (mp_encode_unconnected_ping(packet, sizeof(packet),
        UINT64_C(0x0102030405060708), UINT64_C(0x1112131415161718)) != MP_RAKNET_PING_SIZE) goto done;
    if (sendto(sender, packet, sizeof(packet), 0, (struct sockaddr *)&dest, sizeof(dest)) != (ssize_t)sizeof(packet)) goto done;
    ssize_t n = recvfrom(receiver, received, sizeof(received), 0, NULL, NULL);
    if (n != (ssize_t)sizeof(packet)) { code = 2; goto done; }
    if (memcmp(packet, received, sizeof(packet)) != 0) { code = 3; goto done; }
    code = 0;
done:
    if (sender >= 0) close(sender);
    if (receiver >= 0) close(receiver);
    return code;
}
