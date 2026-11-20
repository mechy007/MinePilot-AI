package ai.minepilot.app;

import android.content.Context;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Arrays;

/** Runtime packaging preflight. Never claims that a Bedrock session works. */
public final class RuntimeProbe {
    private RuntimeProbe() {}
    public static final String RUNTIME_NAME = "libminepilot_runtime.so";
    public enum Result { UNSUPPORTED_ABI, MISSING_RUNTIME, INVALID_ELF, RUNTIME_PRESENT }
    public static Result inspect(Context context) {
        if (!Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a")) {
            return Result.UNSUPPORTED_ABI;
        }
        File binary = new File(context.getApplicationInfo().nativeLibraryDir, RUNTIME_NAME);
        if (!binary.isFile() || binary.length() < 64) return Result.MISSING_RUNTIME;
        try (FileInputStream stream = new FileInputStream(binary)) {
            byte[] header = new byte[20];
            if (stream.read(header) != header.length) return Result.INVALID_ELF;
            // ELF64 little-endian AArch64 (e_machine 183). No execution or trust implied.
            boolean valid = (header[0] & 255) == 127 && header[1] == 'E'
                    && header[2] == 'L' && header[3] == 'F'
                    && header[4] == 2 && header[5] == 1
                    && (header[18] & 255) == 183 && header[19] == 0;
            return valid ? Result.RUNTIME_PRESENT : Result.INVALID_ELF;
        } catch (IOException ignored) {
            return Result.INVALID_ELF;
        }
    }
}
