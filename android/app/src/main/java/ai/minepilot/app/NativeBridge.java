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
    public static String diagnostic() {
        if (!loaded) return "JNI_LIBRARY_MISSING";
        try {
            return nativeProtocolVersion() == 1 ? "JNI_BRIDGE_READY" : "JNI_VERSION_MISMATCH";
        } catch (UnsatisfiedLinkError | SecurityException e) {
            return "JNI_ENTRYPOINT_MISSING";
        }
    }
}
