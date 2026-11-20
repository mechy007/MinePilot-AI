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
    private static native int nativeUdpPreflight();
    private static native int nativeRaknetPingCodecSelfTest();
    private static native int nativeRaknetPongCodecSelfTest();
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
