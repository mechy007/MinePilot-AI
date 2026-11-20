#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../android/app/src/main/cpp/raknet_pong.h"

int main(void) {
    uint8_t p[39] = {0};
    p[0] = 0x1c;
    for (int i = 0; i < 8; ++i) {
        p[1+i] = (uint8_t)(i+1);
        p[9+i] = (uint8_t)(i+17);
    }
    memcpy(p+17, MP_RAKNET_MAGIC, 16);
    p[33] = 0; p[34] = 4;
    memcpy(p+35, "MCPE", 4);
    mp_raknet_pong pong = {0};
    assert(mp_decode_unconnected_pong(p, sizeof(p), &pong) == 0);
    assert(pong.timestamp == UINT64_C(0x0102030405060708));
    assert(pong.server_guid == UINT64_C(0x1112131415161718));
    assert(pong.motd_length == 4 && memcmp(pong.motd, "MCPE", 4) == 0);
    assert(mp_decode_unconnected_pong(p, 34, &pong) == -1);
    assert(mp_decode_unconnected_pong(NULL, sizeof(p), &pong) == -1);
    assert(mp_decode_unconnected_pong(p, sizeof(p), NULL) == -1);
    p[0] = 1; assert(mp_decode_unconnected_pong(p, sizeof(p), &pong) == -1);
    p[0] = 0x1c; p[17] ^= 1;
    assert(mp_decode_unconnected_pong(p, sizeof(p), &pong) == -1);
    p[17] ^= 1;
    p[34] = 5; assert(mp_decode_unconnected_pong(p, sizeof(p), &pong) == -1);
    p[34] = 3; assert(mp_decode_unconnected_pong(p, sizeof(p), &pong) == -1);
    p[34] = 4;
    assert(mp_decode_unconnected_pong(p, sizeof(p)-1, &pong) == -1);
    return 0;
}
