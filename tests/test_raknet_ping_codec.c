#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../android/app/src/main/cpp/raknet_ping.h"
int main(void) {
    uint8_t bytes[MP_RAKNET_PING_SIZE] = {0};
    assert(mp_encode_unconnected_ping(bytes, sizeof(bytes),
      UINT64_C(0x0102030405060708), UINT64_C(0x1112131415161718)) == 33);
    const uint8_t expected[] = {
      0x01,1,2,3,4,5,6,7,8,
      0,255,255,0,254,254,254,254,253,253,253,253,18,52,86,120,
      17,18,19,20,21,22,23,24
    };
    assert(memcmp(bytes, expected, sizeof(expected)) == 0);
    assert(mp_encode_unconnected_ping(bytes, 32, 0, 0) == -1);
    assert(mp_encode_unconnected_ping(NULL, 33, 0, 0) == -1);
    return 0;
}
