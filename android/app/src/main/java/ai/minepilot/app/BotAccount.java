package ai.minepilot.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Stores the bot identity and refresh token in Android Keystore-backed encrypted storage. */
final class BotAccount {
    private static final String ALIAS = "minepilot.bot.refresh.v1";
    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "bot-account"));
    }
    static boolean saved(Context context) { return file(context).getBaseFile().exists(); }
    static synchronized void forget(Context context) {
        file(context).delete();
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            store.deleteEntry(ALIAS);
        } catch (Exception ignored) {
            // No account remains available even if key cleanup is deferred.
        }
    }

    private static SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(ALIAS, null);
        if (existing != null || !create) return existing;
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    static synchronized void save(Context context, org.json.JSONObject account) throws Exception {
        String refresh = account.getString("refreshToken");
        if (refresh.length() < 20 || account.optString("gamertag").isEmpty()) throw new IllegalArgumentException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        byte[] iv = cipher.getIV();
        if (iv.length != 12) throw new IllegalStateException();
        byte[] ciphertext = cipher.doFinal(account.toString().getBytes(StandardCharsets.UTF_8));
        AtomicFile target = file(context);
        FileOutputStream out = target.startWrite();
        try {
            out.write(iv);
            out.write(ciphertext);
            target.finishWrite(out);
        } catch (Exception error) {
            target.failWrite(out);
            throw error;
        }
    }
    static synchronized org.json.JSONObject read(Context context) throws Exception {
        byte[] sealed = file(context).readFully();
        if (sealed.length <= 12) throw new IllegalStateException("Stored bot account is invalid");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Arrays.copyOf(sealed, 12)));
        return new org.json.JSONObject(new String(
                cipher.doFinal(sealed, 12, sealed.length - 12), StandardCharsets.UTF_8));
    }
    static synchronized String refreshToken(Context context) throws Exception {
        return read(context).getString("refreshToken");
    }
    static String gamertag(Context context) {
        try { return read(context).optString("gamertag", "Xbox account"); }
        catch (Exception error) { return "Account needs sign-in"; }
    }
    static String xuid(Context context) {
        try { return read(context).optString("xuid", ""); }
        catch (Exception error) { return ""; }
    }
}
