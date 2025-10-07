// api/search.js
import fetch from "node-fetch";

const MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_LIMIT = 12;

// Token globale in memoria
global.__EBAY_TOKEN = global.__EBAY_TOKEN || null;
global.__EBAY_TOKEN_EXPIRES_AT = global.__EBAY_TOKEN_EXPIRES_AT || 0;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

    // --- ottieni token se scaduto o non presente ---
    if (!global.__EBAY_TOKEN || Date.now() > global.__EBAY_TOKEN_EXPIRES_AT) {
      const clientId = process.env.EBAY_CLIENT_ID;
      const clientSecret = process.env.EBAY_CLIENT_SECRET;
      const refreshToken = process.env.EBAY_REFRESH_TOKEN;

      if (!clientId || !clientSecret || !refreshToken) {
        return res.status(500).json({ error: "Client ID, secret or refresh token not set" });
      }

      const tokenResp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: "https://api.ebay.com/oauth/api_scope/buy.browse",
        }).toString(),
      });

      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("Token refresh error:", tokenJson);
        return res.status(500).json({ error: "Failed to obtain eBay token", details: tokenJson });
      }

      global.__EBAY_TOKEN = tokenJson.access_token;
      global.__EBAY_TOKEN_EXPIRES_AT = Date.now() + (tokenJson.expires_in - 60) * 1000;
      console.log("✅ eBay token refreshed, expires in:", tokenJson.expires_in);
    }

    const accessToken = global.__EBAY_TOKEN;
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

    // Mappatura semplificata
    const items = (ebayJson.itemSummaries || []).map(item => ({
      title: item.title || "",
      price: item.price?.value || "N/D",
      currency: item.price?.currency || "EUR",
      condition: item.condition || "",
      image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || item.additionalImages?.[0]?.imageUrl || "",
      link: item.itemWebUrl || item.itemHref || "",
      seller: item.seller?.username || "",
      shipping: item.shippingOptions?.[0]?.shippingCost?.value === "0.00"
        ? "Spedizione gratuita"
        : (item.shippingOptions?.[0]?.shippingCost ? `${item.shippingOptions[0].shippingCost.value} ${item.shippingOptions[0].shippingCost.currency || ""}` : ""),
      country: item.itemLocation?.country || "",
    }));

    return res.json({ itemSummaries: items, raw_total: ebayJson.total || 0 });

  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
}