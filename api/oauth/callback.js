// api/oauth/callback.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing authorization code");

    const CLIENT_ID = process.env.EBAY_CLIENT_ID;
    const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
    const REDIRECT_URI = "Giovanni_Angeli-Giovanni-Auto-P-egwvupmy";

    if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).send("Client ID/secret not set");

    // Scambia code per refresh token + access token
    const tokenResp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });

    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok) {
      console.error("OAuth token error:", tokenJson);
      return res.status(500).json(tokenJson);
    }

    // Qui tokenJson contiene: access_token, refresh_token, expires_in
    console.log("✅ OAuth token obtained:", tokenJson);

    // Mostra istruzioni all’utente per copiare il refresh_token in ENV
    res.send(`
      <h2>Token ottenuto correttamente!</h2>
      <p>Copia il <strong>refresh_token</strong> e mettilo nella variabile EBAY_REFRESH_TOKEN su Vercel.</p>
      <pre>${tokenJson.refresh_token}</pre>
    `);

  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("Internal server error: " + (err.message || err));
  }
}