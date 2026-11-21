#ifndef MINEPILOT_RAKNET_OPEN_CONNECTION_STAGE2_H
#define MINEPILOT_RAKNET_OPEN_CONNECTION_STAGE2_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "raknet_ping.h"

// RakNet IPv4 address: family=4, complemented IPv4 octets, big-endian port.
#define MP_RAKNET_IPV4_ADDRESS_SIZE 7
#define MP_RAKNET_REQUEST2_SIZE 34
#define MP_RAKNET_REPLY2_SIZE 35
typedef struct {
    uint8_t ipv4[4];
    uint16_t port;
} mp_raknet_ipv4;
typedef struct {
    uint64_t server_guid;
    mp_raknet_ipv4 client_address;
    uint16_t mtu;
    uint8_t security_enabled;
} mp_raknet_reply2;

static inline void mp_raknet_write_u64_be(uint8_t *out, uint64_t n) {
    for (int i = 7; i >= 0; --i) { out[i] = (uint8_t)n; n >>= 8; }
}
static inline uint64_t mp_raknet_read_u64_be(const uint8_t *in) {
    uint64_t n = 0;
    for (int i = 0; i < 8; ++i) n = (n << 8) | in[i];
    return n;
}
static inline void mp_raknet_write_ipv4(uint8_t *out, const mp_raknet_ipv4 *addr) {
    out[0] = 4;
    for (int i = 0; i < 4; ++i) out[i+1] = (uint8_t)~addr->ipv4[i];
    out[5] = (uint8_t)(addr->port >> 8);
    out[6] = (uint8_t)addr->port;
}
static inline int mp_raknet_read_ipv4(const uint8_t *in, mp_raknet_ipv4 *addr) {
    if (in[0] != 4) return -1;
    for (int i = 0; i < 4; ++i) addr->ipv4[i] = (uint8_t)~in[i+1];
    addr->port = (uint16_t)(((uint16_t)in[5] << 8) | in[6]);
    return 0;
}

// Pure encoding; does not transmit, negotiate or authenticate.
static inline int mp_encode_open_connection_request2(uint8_t *out, size_t capacity,
        const mp_raknet_ipv4 *server, uint16_t mtu, uint64_t client_guid) {
    if (!out || !server || capacity < MP_RAKNET_REQUEST2_SIZE ||
        mtu < 18 || mtu > 1492 || server->port == 0) return -1;
    out[0] = 7;
    memcpy(out+1, MP_RAKNET_MAGIC, 16);
    mp_raknet_write_ipv4(out+17, server);
    out[24] = (uint8_t)(mtu >> 8);
    out[25] = (uint8_t)mtu;
    mp_raknet_write_u64_be(out+26, client_guid);
    return MP_RAKNET_REQUEST2_SIZE;
}

// Strict 35-byte IPv4 Reply 2. Reject unsupported IPv6 and malformed flags.
static inline int mp_decode_open_connection_reply2(const uint8_t *packet, size_t size,
                                                     mp_raknet_reply2 *result) {
    if (!packet || !result || size != MP_RAKNET_REPLY2_SIZE ||
        packet[0] != 8 || memcmp(packet+1, MP_RAKNET_MAGIC, 16)) return -1;
    mp_raknet_reply2 parsed = {0};
    parsed.server_guid = mp_raknet_read_u64_be(packet+17);
    if (mp_raknet_read_ipv4(packet+25, &parsed.client_address)) return -1;
    parsed.mtu = (uint16_t)(((uint16_t)packet[32] << 8) | packet[33]);
    parsed.security_enabled = packet[34];
    if (parsed.mtu < 18 || parsed.mtu > 1492 || parsed.security_enabled > 1) return -1;
    *result = parsed;
    return 0;
}
#endif
