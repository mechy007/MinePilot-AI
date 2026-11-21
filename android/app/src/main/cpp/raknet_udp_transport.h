#ifndef MINEPILOT_RAKNET_UDP_TRANSPORT_H
#define MINEPILOT_RAKNET_UDP_TRANSPORT_H

#include "raknet_handshake_state.h"
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

// Blocking, bounded IPv4 UDP handshake transport. Intended for a worker thread,
// NEVER Android's UI thread. No Xbox login, Bedrock session, or world join.
// A connected UDP socket filters datagrams from non-peer endpoints in the kernel.
// Return 0 only for RakNet open-connection completion, not game login.
#define MP_UDP_TIMEOUT_MS 750
#define MP_UDP_MAX_PACKETS_PER_ATTEMPT 16
static inline int mp_raknet_udp_handshake(const mp_raknet_ipv4 *server,
        uint8_t protocol, uint16_t mtu, uint64_t client_guid,
        mp_raknet_handshake *result) {
    if (!server || !result || !server->port || mtu < 18 || mtu > 1492)
        return -1;
    mp_raknet_handshake hs = {0};
    if (mp_handshake_init(&hs, protocol, mtu, client_guid, server)) return -1;
    int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (fd < 0) return -2;
    int status = -3;
    struct sockaddr_in peer = {0};
    peer.sin_family = AF_INET;
    peer.sin_port = htons(server->port);
    uint32_t ip = ((uint32_t)server->ipv4[0] << 24) |
                  ((uint32_t)server->ipv4[1] << 16) |
                  ((uint32_t)server->ipv4[2] << 8) |
                  (uint32_t)server->ipv4[3];
    peer.sin_addr.s_addr = htonl(ip);
    struct timeval timeout = { .tv_sec = 0, .tv_usec = MP_UDP_TIMEOUT_MS * 1000 };
    if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) ||
        connect(fd, (const struct sockaddr *)&peer, sizeof(peer))) goto done;
    uint8_t request[1492], reply[1492];
    while (hs.phase != MP_HS_OPEN_CONNECTION_COMPLETE &&
           hs.phase != MP_HS_FAILED) {
        int length = mp_handshake_next_request(&hs, request, sizeof(request));
        if (length <= 0) break;
        if (send(fd, request, (size_t)length, 0) != length) break;
        int advanced = 0;
        for (int i = 0; i < MP_UDP_MAX_PACKETS_PER_ATTEMPT; ++i) {
            ssize_t received = recv(fd, reply, sizeof(reply), 0);
            if (received < 0) {
                if (errno == EINTR) { --i; continue; }
                if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                goto done;
            }
            if (received == 0) continue;
            if (mp_handshake_accept_reply(&hs, reply, (size_t)received) == 0) {
                advanced = 1;
                break;
            }
            if (hs.phase == MP_HS_FAILED) goto done;
        }
        if (hs.phase == MP_HS_OPEN_CONNECTION_COMPLETE) {
            status = 0;
            break;
        }
        if (!advanced && mp_handshake_on_timeout(&hs)) break;
    }
done:
    close(fd);
    *result = hs;
    return status;
}
#endif
