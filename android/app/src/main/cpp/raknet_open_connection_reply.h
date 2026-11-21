#ifndef MINEPILOT_RAKNET_OPEN_CONNECTION_REPLY_H
#define MINEPILOT_RAKNET_OPEN_CONNECTION_REPLY_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "raknet_ping.h"

// RakNet Open Connection Reply 1 (0x06): ID, magic, server GUID,
// security flag, MTU (big-endian). Parsing alone does not establish a session.
#define MP_RAKNET_REPLY1_SIZE 28
typedef struct {
    uint64_t server_guid;
    uint8_t security_enabled;
    uint16_t mtu;
} mp_raknet_reply1;

static inline int mp_decode_open_connection_reply1(const uint8_t *packet,
                                                    size_t size,
                                                    mp_raknet_reply1 *result) {
    if (!packet || !result || size != MP_RAKNET_REPLY1_SIZE || packet[0] != 0x06)
        return -1;
    if (memcmp(packet + 1, MP_RAKNET_MAGIC, 16) != 0) return -1;
    if (packet[25] > 1) return -1;
    uint64_t guid = 0;
    for (int i = 17; i < 25; ++i) guid = (guid << 8) | packet[i];
    uint16_t mtu = (uint16_t)(((uint16_t)packet[26] << 8) | packet[27]);
    if (mtu < 18 || mtu > 1492) return -1;
    mp_raknet_reply1 parsed = {guid, packet[25], mtu};
    *result = parsed;
    return 0;
}
#endif
