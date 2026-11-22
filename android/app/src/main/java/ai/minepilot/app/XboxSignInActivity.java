package ai.minepilot.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.graphics.Color;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.util.Base64;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/** Interactive OAuth authorization-code + PKCE. No passwords or device codes. */
public final class XboxSignInActivity extends Activity {
    private static final String REDIRECT = "minepilot://oauth";
    private TextView message;
    private String verifier;
    private String state;
    private boolean awaiting;
    private static String random() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
    private static String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }
    private static String read(HttpURLConnection c) throws Exception {
        InputStream stream = c.getResponseCode() < 400 ? c.getInputStream() : c.getErrorStream();
        if (stream == null) throw new IllegalStateException("Empty authentication response");
        try (InputStream in = stream) { return new String(in.readAllBytes(), StandardCharsets.UTF_8); }
    }
    private static JSONObject post(String url, String data, String bearer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(12000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", bearer == null ? "application/x-www-form-urlencoded" : "application/json");
        if (bearer != null && !bearer.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + bearer);
        try (OutputStream out = c.getOutputStream()) { out.write(data.getBytes(StandardCharsets.UTF_8)); }
        try {
            String response = read(c);
            if (c.getResponseCode() >= 400) throw new IllegalStateException("Authentication service returned HTTP " + c.getResponseCode());
            return new JSONObject(response);
        } finally { c.disconnect(); }
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(10, 12, 23));
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(28, 48, 28, 28); layout.setBackgroundColor(Color.rgb(10, 12, 23));
        message = new TextView(this); message.setTextColor(Color.WHITE); message.setTextSize(18);
        message.setText("Sign in with your Xbox / Microsoft account. MinePilot never receives your password.");
        layout.addView(message);
        Button login = new Button(this); login.setText("Continue with Xbox");
        login.setOnClickListener(v -> begin()); layout.addView(login);
        setContentView(layout);
        if (saved != null) {
            verifier = saved.getString("verifier");
            state = saved.getString("state");
            awaiting = saved.getBoolean("awaiting");
        }
        if (getIntent() != null && getIntent().getData() != null) handle(getIntent().getData());
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (intent.getData() != null) handle(intent.getData());
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        out.putString("verifier", verifier); out.putString("state", state);
        out.putBoolean("awaiting", awaiting); super.onSaveInstanceState(out);
    }
    private void begin() {
        if (BuildConfig.XBOX_CLIENT_ID.isEmpty()) {
            message.setText("Xbox OAuth is not configured. The app developer must supply a Microsoft Entra public-client application ID.");
            return;
        }
        try {
            verifier = random(); state = random(); awaiting = true;
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            String challenge = Base64.encodeToString(hash, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            String uri = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
                + "?client_id=" + enc(BuildConfig.XBOX_CLIENT_ID)
                + "&response_type=code&redirect_uri=" + enc(REDIRECT)
                + "&response_mode=query&scope=" + enc("XboxLive.signin offline_access")
                + "&code_challenge_method=S256&code_challenge=" + enc(challenge)
                + "&state=" + enc(state);
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(uri)));
            message.setText("Complete sign-in in your browser. MinePilot will return here automatically.");
        } catch (Exception e) { message.setText("Could not open secure Microsoft sign-in."); }
    }
    private void handle(Uri uri) {
        if (!"minepilot".equals(uri.getScheme()) || !"oauth".equals(uri.getHost())) return;
        if (!awaiting || state == null || !state.equals(uri.getQueryParameter("state")) || verifier == null) {
            message.setText("Sign-in verification failed. Please start again."); return;
        }
        awaiting = false;
        String code = uri.getQueryParameter("code");
        if (code == null || code.isEmpty()) {
            message.setText("Microsoft sign-in was cancelled or denied."); return;
        }
        String pkce = verifier; verifier = null; state = null;
        message.setText("Verifying Xbox Live account…");
        new Thread(() -> {
            String result;
            try {
                JSONObject oauth = post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
                    "client_id=" + enc(BuildConfig.XBOX_CLIENT_ID)
                    + "&grant_type=authorization_code&code=" + enc(code)
                    + "&redirect_uri=" + enc(REDIRECT)
                    + "&code_verifier=" + enc(pkce), null);
                String access = oauth.getString("access_token");
                JSONObject xbl = post("https://user.auth.xboxlive.com/user/authenticate",
                    new JSONObject().put("Properties", new JSONObject().put("AuthMethod", "RPS")
                        .put("SiteName", "user.auth.xboxlive.com").put("RpsTicket", "d=" + access))
                        .put("RelyingParty", "http://auth.xboxlive.com").put("TokenType", "JWT").toString(), "");
                String xboxToken = xbl.getString("Token");
                String uhs = xbl.getJSONObject("DisplayClaims").getJSONArray("xui").getJSONObject(0).getString("uhs");
                JSONObject xsts = post("https://xsts.auth.xboxlive.com/xsts/authorize",
                    new JSONObject().put("Properties", new JSONObject().put("SandboxId", "RETAIL")
                        .put("UserTokens", new org.json.JSONArray().put(xboxToken)))
                        .put("RelyingParty", "rp://api.minecraftservices.com/").put("TokenType", "JWT").toString(), "");
                result = "Xbox Live authentication successful. Xbox user hash: "
                    + uhs + ". Minecraft XSTS token received. Session is not yet connected to the Bedrock engine.";
                // Intentionally do not persist access or refresh tokens until encrypted storage is implemented.
            } catch (Exception e) {
                result = "Xbox authentication could not be completed. Check app registration, account permissions, and network connection.";
            }
            final String finalResult = result;
            runOnUiThread(() -> { if (!isFinishing()) message.setText(finalResult); });
        }, "minepilot-xbox-oauth").start();
    }
}
