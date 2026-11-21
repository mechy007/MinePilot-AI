#include <jni.h>
#include <string.h>
#include "raknet_ping.h"
#include "raknet_pong.h"
#include "raknet_open_connection.h"
#include "raknet_open_connection_reply.h"
#include "raknet_open_connection_stage2.h"
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
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

/* Offline request-1 framing self-test. No packets sent. */
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeRaknetRequest1CodecSelfTest(JNIEnv *env, jclass clazz) {
    (void)env; (void)clazz;
    uint8_t packet[64];
    memset(packet, 0xa5, sizeof(packet));
    if (mp_encode_open_connection_request1(packet, sizeof(packet), 32, 11) != 32) return 1;
    if (packet[0] != 0x05 || memcmp(packet + 1, MP_RAKNET_MAGIC, 16) ||
        packet[17] != 11) return 2;
    for (int i = 18; i < 32; ++i) if (packet[i] != 0) return 3;
    if (packet[32] != 0xa5 || packet[63] != 0xa5) return 4;
    if (mp_encode_open_connection_request1(packet, sizeof(packet), 17, 11) != -1 ||
        mp_encode_open_connection_request1(packet, sizeof(packet), 65, 11) != -1 ||
        mp_encode_open_connection_request1(NULL, 32, 32, 11) != -1) return 5;
    uint8_t boundary[1493];
    memset(boundary, 0xa5, sizeof(boundary));
    if (mp_encode_open_connection_request1(boundary, sizeof(boundary), 18, 11) != 18 ||
        boundary[0] != 0x05 || memcmp(boundary + 1, MP_RAKNET_MAGIC, 16) ||
        boundary[17] != 11 || boundary[18] != 0xa5) return 6;
    memset(boundary, 0xa5, sizeof(boundary));
    if (mp_encode_open_connection_request1(boundary, sizeof(boundary), 1492, 11) != 1492 ||
        boundary[0] != 0x05 || memcmp(boundary + 1, MP_RAKNET_MAGIC, 16) ||
        boundary[17] != 11 || boundary[18] != 0 ||
        boundary[1491] != 0 || boundary[1492] != 0xa5) return 7;
    if (mp_encode_open_connection_request1(boundary, sizeof(boundary), 1493, 11) != -1) return 8;
    return 0;
}

/* Offline reply-1 parsing only; no live server handshake. */
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeRaknetReply1CodecSelfTest(JNIEnv *env, jclass clazz) {
    (void)env; (void)clazz;
    uint8_t p[MP_RAKNET_REPLY1_SIZE] = {0};
    p[0] = 6;
    memcpy(p + 1, MP_RAKNET_MAGIC, 16);
    for (int i = 0; i < 8; ++i) p[17+i] = (uint8_t)(i+1);
    p[26] = 5; p[27] = 120;
    mp_raknet_reply1 result = {0};
    if (mp_decode_open_connection_reply1(p, sizeof(p), &result) ||
        result.server_guid != UINT64_C(0x0102030405060708) ||
        result.mtu != 1400 || result.security_enabled != 0) return 1;
    if (mp_decode_open_connection_reply1(p, sizeof(p)-1, &result) == 0) return 2;
    p[1] ^= 1;
    if (mp_decode_open_connection_reply1(p, sizeof(p), &result) == 0) return 3;
    p[1] ^= 1;
    p[25] = 2;
    if (mp_decode_open_connection_reply1(p, sizeof(p), &result) == 0) return 4;
    p[25] = 1;
    if (mp_decode_open_connection_reply1(p, sizeof(p), &result) ||
        result.security_enabled != 1) return 5;
    p[26] = 0; p[27] = 17;
    if (mp_decode_open_connection_reply1(p, sizeof(p), &result) == 0) return 6;
    p[26] = 5; p[27] = 213;
    if (mp_decode_open_connection_reply1(p, sizeof(p), &result) == 0) return 7;
    return 0;
}

/* Offline RakNet request-2 and reply-2 test vectors; no network traffic. */
JNIEXPORT jint JNICALL
Java_ai_minepilot_app_NativeBridge_nativeRaknetStage2CodecSelfTest(JNIEnv *env, jclass clazz) {
    (void)env; (void)clazz;
    mp_raknet_ipv4 server = {{127,0,0,1}, 19132};
    uint8_t request[MP_RAKNET_REQUEST2_SIZE+1] = {0};
    if (mp_encode_open_connection_request2(request, sizeof(request), &server, 1400,
        UINT64_C(0x0102030405060708)) != MP_RAKNET_REQUEST2_SIZE) return 1;
    const uint8_t expected_request[MP_RAKNET_REQUEST2_SIZE] = {
        0x07, 0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
        0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
        0x04, 0x80, 0xff, 0xff, 0xfe, 0x4a, 0xbc,
        0x05, 0x78, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08
    };
    if (memcmp(request, expected_request, sizeof(expected_request))) return 2;
    if (mp_encode_open_connection_request2(request, 33, &server, 1400, 0) != -1 ||
        mp_encode_open_connection_request2(NULL, 34, &server, 1400, 0) != -1 ||
        mp_encode_open_connection_request2(request, 34, &server, 1493, 0) != -1) return 3;
    uint8_t reply[MP_RAKNET_REPLY2_SIZE] = {
        0x08, 0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
        0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78,
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x04, 0x80, 0xff, 0xff, 0xfe, 0x4a, 0xbc,
        0x05, 0x78, 0x00
    };
    mp_raknet_reply2 parsed = {0};
    if (mp_decode_open_connection_reply2(reply, sizeof(reply), &parsed) ||
        parsed.server_guid != UINT64_C(0x0102030405060708) ||
        parsed.mtu != 1400 || parsed.client_address.port != 19132 ||
        memcmp(parsed.client_address.ipv4, server.ipv4, 4)) return 4;
    if (mp_decode_open_connection_reply2(reply, 34, &parsed) == 0) return 5;
    reply[25] = 6;
    if (mp_decode_open_connection_reply2(reply, 35, &parsed) == 0) return 6;
    reply[25] = 4; reply[34] = 2;
    if (mp_decode_open_connection_reply2(reply, 35, &parsed) == 0) return 7;
    return 0;
}
