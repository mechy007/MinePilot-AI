#ifndef MINEPILOT_RAKNET_PONG_H
#define MINEPILOT_RAKNET_PONG_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "raknet_ping.h"

// Unconnected pong (0x1c): timestamp, server GUID, magic, MOTD length, MOTD.
// Returns 0 on valid framing; payload is a non-owning byte span, not a C string.
// Does not authenticate, establish a RakNet session, or trust server metadata.
typedef struct {
    uint64_t timestamp;
    uint64_t server_guid;
    const uint8_t *motd;
    size_t motd_length;
} mp_raknet_pong;

static inline uint64_t mp_read_u64_be(const uint8_t *p) {
    uint64_t n = 0;
    for (int i = 0; i < 8; ++i) n = (n << 8) | p[i];
    return n;
}

static inline int mp_decode_unconnected_pong(const uint8_t *packet, size_t size,
                                              mp_raknet_pong *result) {
    if (!packet || !result || size < 35 || packet[0] != 0x1c) return -1;
    if (memcmp(packet + 17, MP_RAKNET_MAGIC, 16) != 0) return -1;
    size_t len = ((size_t)packet[33] << 8) | packet[34];
    if (len != size - 35) return -1;
    mp_raknet_pong parsed = {
        mp_read_u64_be(packet + 1), mp_read_u64_be(packet + 9), packet + 35, len
    };
    *result = parsed;
    return 0;
}
#endif
