#ifndef MINEPILOT_RAKNET_HANDSHAKE_STATE_H
#define MINEPILOT_RAKNET_HANDSHAKE_STATE_H
#include <stddef.h>
#include <stdint.h>
#include "raknet_open_connection.h"
#include "raknet_open_connection_reply.h"
#include "raknet_open_connection_stage2.h"

// Transport-independent RakNet open-connection handshake state machine.
// The caller owns UDP sockets, destination validation, timeouts, and scheduling.
// Never treat this state as an authenticated Minecraft/Bedrock session.
typedef enum {
    MP_HS_IDLE = 0,
    MP_HS_WAIT_REPLY1 = 1,
    MP_HS_WAIT_REPLY2 = 2,
    MP_HS_OPEN_CONNECTION_COMPLETE = 3,
    MP_HS_FAILED = 4
} mp_handshake_phase;

typedef struct {
    mp_handshake_phase phase;
    uint8_t protocol;
    uint16_t requested_mtu;
    uint16_t negotiated_mtu;
    uint64_t client_guid;
    uint64_t server_guid;
    mp_raknet_ipv4 server_address;
    uint8_t security_enabled;
    uint8_t retries;
} mp_raknet_handshake;

#define MP_HS_MAX_RETRIES 3
static inline int mp_handshake_init(mp_raknet_handshake *hs, uint8_t protocol,
        uint16_t mtu, uint64_t guid, const mp_raknet_ipv4 *server) {
    if (!hs || !server || !server->port || mtu < 18 || mtu > 1492) return -1;
    *hs = (mp_raknet_handshake){0};
    hs->phase = MP_HS_IDLE;
    hs->protocol = protocol;
    hs->requested_mtu = mtu;
    hs->client_guid = guid;
    hs->server_address = *server;
    return 0;
}
static inline int mp_handshake_next_request(mp_raknet_handshake *hs,
        uint8_t *out, size_t capacity) {
    if (!hs || !out || hs->phase == MP_HS_FAILED ||
        hs->phase == MP_HS_OPEN_CONNECTION_COMPLETE) return -1;
    if (hs->phase == MP_HS_IDLE || hs->phase == MP_HS_WAIT_REPLY1) {
        int n = mp_encode_open_connection_request1(out, capacity,
                hs->requested_mtu, hs->protocol);
        if (n >= 0) hs->phase = MP_HS_WAIT_REPLY1;
        return n;
    }
    if (hs->phase == MP_HS_WAIT_REPLY2)
        return mp_encode_open_connection_request2(out, capacity,
                &hs->server_address, hs->negotiated_mtu, hs->client_guid);
    return -1;
}
static inline int mp_handshake_accept_reply(mp_raknet_handshake *hs,
        const uint8_t *packet, size_t size) {
    if (!hs || !packet) return -1;
    if (hs->phase == MP_HS_WAIT_REPLY1) {
        mp_raknet_reply1 reply;
        if (mp_decode_open_connection_reply1(packet, size, &reply)) return -1;
        // Security negotiation requires separate support; fail closed.
        if (reply.security_enabled) { hs->phase = MP_HS_FAILED; return -2; }
        hs->server_guid = reply.server_guid;
        hs->negotiated_mtu = reply.mtu < hs->requested_mtu ?
                reply.mtu : hs->requested_mtu;
        hs->phase = MP_HS_WAIT_REPLY2;
        hs->retries = 0;
        return 0;
    }
    if (hs->phase == MP_HS_WAIT_REPLY2) {
        mp_raknet_reply2 reply;
        if (mp_decode_open_connection_reply2(packet, size, &reply)) return -1;
        if (reply.security_enabled || reply.server_guid != hs->server_guid ||
            reply.mtu > hs->negotiated_mtu) {
            hs->phase = MP_HS_FAILED;
            return -2;
        }
        hs->negotiated_mtu = reply.mtu;
        hs->phase = MP_HS_OPEN_CONNECTION_COMPLETE;
        hs->retries = 0;
        return 0;
    }
    return -1;
}
// Call only on a genuine caller-measured timeout. Never retry indefinitely.
static inline int mp_handshake_on_timeout(mp_raknet_handshake *hs) {
    if (!hs || (hs->phase != MP_HS_WAIT_REPLY1 &&
                hs->phase != MP_HS_WAIT_REPLY2)) return -1;
    if (++hs->retries > MP_HS_MAX_RETRIES) {
        hs->phase = MP_HS_FAILED;
        return -1;
    }
    return 0;
}
#endif
