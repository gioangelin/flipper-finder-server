// api/search.js
import fetch from "node-fetch";

const TOKEN_SCOPE = "https://api.ebay.com/oauth/api_scope"; // Client Credentials flow
const MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_LIMIT = 12;

// Cache globale per token
let cachedToken = null;
let tokenExpiresAt = 0;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

    // --- Ottieni token se scaduto o non presente ---
    if (!cachedToken || Date.now() > tokenExpiresAt) {
      const clientId = process.env.EBAY_CLIENT_ID;
      const clientSecret = process.env.EBAY_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not set" });
      }

      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const tokenResp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: TOKEN_SCOPE,
        }).toString(),
      });

      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("Token error:", tokenJson);
        return res.status(500).json({ error: "Failed to obtain eBay token", details: tokenJson });
      }

      cachedToken = tokenJson.access_token;
      tokenExpiresAt = Date.now() + (tokenJson.expires_in - 60) * 1000; // margine 60s
      console.log("✅ Obtained new eBay token, expires in:", tokenJson.expires_in);
    }

    const accessToken = cachedToken;

    // --- Chiamata Browse API ---
    const limit = req.query.limit || DEFAULT_LIMIT;
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`;

    const ebayResp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
      },
    });

    const ebayJson = await ebayResp.json();
    if (!ebayResp.ok) {
      console.error("eBay API error:", ebayJson);
      return res.status(500).json({ error: "eBay API error", details: ebayJson });
    }

    const items = (ebayJson.itemSummaries || []).map((item) => ({
      title: item.title || "",
      price: item.price?.value || item.currentBidPrice?.value || "N/D",
      currency: item.price?.currency || item.currentBidPrice?.currency || "EUR",
      condition: item.condition || "",
      image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || "",
      link: item.itemWebUrl || item.itemHref || "",
      seller: item.seller?.username || "",
      shipping:
        item.shippingOptions?.[0]?.shippingCost?.value === "0.00"
          ? "Spedizione gratuita"
          : (item.shippingOptions?.[0]?.shippingCost
            ? `${item.shippingOptions[0].shippingCost.value} ${item.shippingOptions[0].shippingCost.currency || ""}`
            : ""),
      country: item.itemLocation?.country || "",
    }));

    return res.json({ itemSummaries: items, raw_total: ebayJson.total || 0 });
  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
}