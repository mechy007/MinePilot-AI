#ifndef MINEPILOT_RAKNET_OPEN_CONNECTION_H
#define MINEPILOT_RAKNET_OPEN_CONNECTION_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "raknet_ping.h"

// RakNet Open Connection Request 1: ID(0x05), magic(16), protocol(1), zero padding.
// mtu is the full UDP payload length, not the network MTU including IP/UDP headers.
// Pure framing only; no session, authentication or network exchange.
#define MP_RAKNET_REQUEST1_MIN_SIZE 18
#define MP_RAKNET_REQUEST1_MAX_SIZE 1492
static inline int mp_encode_open_connection_request1(uint8_t *out, size_t capacity,
                                                      size_t mtu, uint8_t protocol) {
    if (!out || mtu < MP_RAKNET_REQUEST1_MIN_SIZE ||
        mtu > MP_RAKNET_REQUEST1_MAX_SIZE || capacity < mtu) return -1;
    out[0] = 0x05;
    memcpy(out + 1, MP_RAKNET_MAGIC, 16);
    out[17] = protocol;
    memset(out + 18, 0, mtu - 18);
    return (int)mtu;
}
#endif
