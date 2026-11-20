#ifndef MINEPILOT_RAKNET_PING_H
#define MINEPILOT_RAKNET_PING_H
#include <stddef.h>
#include <stdint.h>

// RakNet unconnected ping: 0x01 + big-endian timestamp + 16-byte magic + GUID.
// This only encodes a packet; it does not perform discovery, login or join.
#define MP_RAKNET_PING_SIZE 33
static const uint8_t MP_RAKNET_MAGIC[16] = {
  0x00,0xff,0xff,0x00,0xfe,0xfe,0xfe,0xfe,
  0xfd,0xfd,0xfd,0xfd,0x12,0x34,0x56,0x78
};
static inline int mp_encode_unconnected_ping(uint8_t *out, size_t capacity,
                                              uint64_t timestamp, uint64_t guid) {
    if (!out || capacity < MP_RAKNET_PING_SIZE) return -1;
    out[0] = 0x01;
    for (int i = 0; i < 8; ++i) {
        out[1+i] = (uint8_t)(timestamp >> (56-8*i));
        out[25+i] = (uint8_t)(guid >> (56-8*i));
    }
    for (int i = 0; i < 16; ++i) out[9+i] = MP_RAKNET_MAGIC[i];
    return MP_RAKNET_PING_SIZE;
}
#endif
