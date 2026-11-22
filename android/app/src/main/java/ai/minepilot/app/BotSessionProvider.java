package ai.minepilot.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.FileNotFoundException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Streams a short-lived credential to the app's own Bedrock process. */
public final class BotSessionProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) || !"/refresh".equals(uri.getPath())) throw new FileNotFoundException();
        return openPipeHelper(uri, "application/octet-stream", null, null, (fd, u, mime, opts, args) -> {
            try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(fd)) {
                out.write(BotAccount.refreshToken(getContext()).getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
                // The runtime treats an empty pipe as a sign-in failure.
            }
        });
    }
    @Override public String getType(Uri uri) { return null; }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
