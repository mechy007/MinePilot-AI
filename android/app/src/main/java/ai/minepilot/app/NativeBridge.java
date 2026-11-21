package ai.minepilot.app;

/** Native JNI packaging smoke check, not a Bedrock engine. */
public final class NativeBridge {
    private NativeBridge() {}
    private static final boolean loaded;
    static {
        boolean ok;
        try {
            System.loadLibrary("minepilot_bridge");
            ok = true;
        } catch (UnsatisfiedLinkError | SecurityException e) {
            ok = false;
        }
        loaded = ok;
    }
    private static native int nativeProtocolVersion();
    private static native int nativeRaknetUdpHandshake(int a, int b, int c, int d,
            int port, int protocol, int mtu, long guid);
    /**
     * Performs real network I/O. Call ONLY on a background worker thread.
     * A zero return means the RakNet open-connection exchange completed;
     * it does NOT mean Xbox authentication or Minecraft world joining.
     */
    public static int raknetUdpHandshake(int[] ipv4, int port, int protocol,
            int mtu, long guid) {
        if (!loaded || ipv4 == null || ipv4.length != 4) return -1;
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper())
            throw new IllegalStateException("Network handshake must run off UI thread");
        return nativeRaknetUdpHandshake(ipv4[0], ipv4[1], ipv4[2], ipv4[3],
                port, protocol, mtu, guid);
    }
    private static native int nativeUdpPreflight();
    private static native int nativeRaknetPingCodecSelfTest();
    private static native int nativeRaknetPongCodecSelfTest();
    private static native int nativeRaknetUdpLoopbackSelfTest();
    private static native int nativeRaknetRequest1CodecSelfTest();
    private static native int nativeRaknetReply1CodecSelfTest();
    private static native int nativeRaknetStage2CodecSelfTest();
    public static String raknetHandshakeCodecDiagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            if (nativeRaknetReply1CodecSelfTest() != 0) return "RAKNET_REPLY1_CODEC_FAILED";
            if (nativeRaknetStage2CodecSelfTest() != 0) return "RAKNET_STAGE2_CODEC_FAILED";
            return "RAKNET_HANDSHAKE_FRAMING_OK_OFFLINE_ONLY";
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "RAKNET_HANDSHAKE_CODEC_ENTRYPOINT_MISSING";
        }
    }
    public static String raknetRequest1Diagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            return nativeRaknetRequest1CodecSelfTest() == 0
                ? "RAKNET_REQUEST1_CODEC_OK_OFFLINE" : "RAKNET_REQUEST1_CODEC_FAILED";
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "RAKNET_REQUEST1_ENTRYPOINT_MISSING";
        }
    }
    public static String raknetUdpLoopbackDiagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            switch (nativeRaknetUdpLoopbackSelfTest()) {
                case 0: return "RAKNET_PING_UDP_LOOPBACK_OK_LOCAL_ONLY";
                case 2: return "RAKNET_UDP_LOOPBACK_RECEIVE_FAILED";
                case 3: return "RAKNET_UDP_LOOPBACK_PAYLOAD_MISMATCH";
                default: return "RAKNET_UDP_LOOPBACK_SOCKET_FAILED";
            }
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "RAKNET_UDP_LOOPBACK_ENTRYPOINT_MISSING";
        }
    }
    public static String raknetPongDiagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            return nativeRaknetPongCodecSelfTest() == 0 ? "RAKNET_PONG_CODEC_OK_OFFLINE" : "RAKNET_PONG_CODEC_FAILED";
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "RAKNET_PONG_ENTRYPOINT_MISSING";
        }
    }
    public static String raknetCodecDiagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            return nativeRaknetPingCodecSelfTest() == 0 ? "RAKNET_PING_CODEC_OK_OFFLINE" : "RAKNET_PING_CODEC_FAILED";
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "RAKNET_CODEC_ENTRYPOINT_MISSING";
        }
    }
    public static String udpDiagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            switch (nativeUdpPreflight()) {
                case 0: return "UDP_LOOPBACK_BIND_OK";
                case 1: return "UDP_SOCKET_UNAVAILABLE";
                default: return "UDP_LOOPBACK_BIND_FAILED";
            }
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "UDP_JNI_ENTRYPOINT_MISSING";
        }
    }
    public static String diagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            return nativeProtocolVersion() == 1 ? "JNI_BRIDGE_READY" : "JNI_VERSION_MISMATCH";
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "JNI_ENTRYPOINT_MISSING";
        }
    }
}
