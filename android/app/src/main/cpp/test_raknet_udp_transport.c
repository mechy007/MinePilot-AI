// Local synthetic UDP responder: verifies real socket transport, NOT Bedrock login.
#include "raknet_udp_transport.h"
#include <pthread.h>
#include <stdio.h>
#include <string.h>
typedef struct { int fd; int ok; } responder;
static void *serve(void *arg) {
    responder *s = arg;
    struct timeval tv = {.tv_sec=3};
    setsockopt(s->fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof(tv));
    struct sockaddr_in peer={0}; socklen_t plen=sizeof(peer);
    uint8_t buf[1600], reply[35]={0};
    ssize_t n=recvfrom(s->fd,buf,sizeof(buf),0,(struct sockaddr*)&peer,&plen);
    if(n!=1400 || buf[0]!=5 || memcmp(buf+1,MP_RAKNET_MAGIC,16)) return NULL;
    reply[0]=6; memcpy(reply+1,MP_RAKNET_MAGIC,16);
    mp_raknet_write_u64_be(reply+17,42);
    reply[26]=5; reply[27]=120;
    if(sendto(s->fd,reply,28,0,(struct sockaddr*)&peer,plen)!=28) return NULL;
    n=recvfrom(s->fd,buf,sizeof(buf),0,(struct sockaddr*)&peer,&plen);
    if(n!=34 || buf[0]!=7 || memcmp(buf+1,MP_RAKNET_MAGIC,16)) return NULL;
    memset(reply,0,sizeof(reply));
    reply[0]=8; memcpy(reply+1,MP_RAKNET_MAGIC,16);
    mp_raknet_write_u64_be(reply+17,42);
    mp_raknet_ipv4 client={{127,0,0,1},ntohs(peer.sin_port)};
    mp_raknet_write_ipv4(reply+25,&client);
    reply[32]=5; reply[33]=120;
    if(sendto(s->fd,reply,35,0,(struct sockaddr*)&peer,plen)!=35) return NULL;
    s->ok=1;
    return NULL;
}
int main(void) {
    int fd=socket(AF_INET,SOCK_DGRAM,0);
    if(fd<0) return 1;
    struct sockaddr_in bindaddr={.sin_family=AF_INET,.sin_port=0};
    bindaddr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    if(bind(fd,(struct sockaddr*)&bindaddr,sizeof(bindaddr))) return 2;
    socklen_t len=sizeof(bindaddr);
    if(getsockname(fd,(struct sockaddr*)&bindaddr,&len)) return 3;
    responder s={.fd=fd,.ok=0};
    pthread_t thread;
    if(pthread_create(&thread,NULL,serve,&s)) return 4;
    mp_raknet_ipv4 endpoint={{127,0,0,1},ntohs(bindaddr.sin_port)};
    mp_raknet_handshake hs={0};
    int rc=mp_raknet_udp_handshake(&endpoint,11,1400,99,&hs);
    pthread_join(thread,NULL); close(fd);
    if(rc || !s.ok || hs.phase!=MP_HS_OPEN_CONNECTION_COMPLETE ||
       hs.server_guid!=42 || hs.negotiated_mtu!=1400) {
        fprintf(stderr,"UDP handshake failed: rc=%d phase=%d server=%d\\n",
                rc,hs.phase,s.ok); return 5;
    }
    puts("Synthetic loopback RakNet UDP handshake passed (not world joining)");
    return 0;
}
