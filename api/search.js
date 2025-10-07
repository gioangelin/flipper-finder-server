// api/search.js
// Serverless Function Vercel: proxy eBay Browse API (marketplace IT)

const TOKEN_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.browse";
const MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_LIMIT = 12;

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

    // --- Ottieni token in cache ---
    if (!global.__EBAY_TOKEN || Date.now() > global.__EBAY_TOKEN_EXPIRES_AT) {
      const clientId = process.env.EBAY_CLIENT_ID;
      const clientSecret = process.env.EBAY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        console.error("❌ EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not set");
        return res.status(500).json({ error: "EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not set" });
      }

      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const bodyParams = new URLSearchParams({
        grant_type: "client_credentials",
        scope: TOKEN_SCOPE,
      }).toString();

      console.log("🔑 Requesting new eBay token...");
      console.log("Basic Auth:", basic.slice(0,10)+"..."); // non stampare tutto per sicurezza
      console.log("Body params:", bodyParams);

      const tokenResp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: bodyParams,
      });

      const tokenJson = await tokenResp.json();
      if (!tokenResp.ok) {
        console.error("❌ Token error:", tokenJson);
        return res.status(500).json({ error: "Failed to obtain eBay token", details: tokenJson });
      }

      global.__EBAY_TOKEN = tokenJson.access_token;
      global.__EBAY_TOKEN_EXPIRES_AT = Date.now() + (tokenJson.expires_in - 60) * 1000;
      console.log("✅ New eBay token obtained, expires in", tokenJson.expires_in, "seconds");
    }

    const accessToken = global.__EBAY_TOKEN;

    // --- Chiamata Browse API ---
    const limit = req.query.limit || DEFAULT_LIMIT;
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`;

    console.log("🔎 Fetching eBay items for:", q);
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
      console.error("❌ eBay API error:", ebayJson);
      return res.status(500).json({ error: "eBay API error", details: ebayJson });
    }

    // --- Mappatura semplificata ---
    const items = (ebayJson.itemSummaries || []).map(item => {
      const image = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || item.additionalImages?.[0]?.imageUrl || "";
      const priceValue = item.price?.value || item.currentBidPrice?.value || (item.priceRange?.min?.value) || "N/D";
      const currency = item.price?.currency || item.currentBidPrice?.currency || (item.priceRange?.min?.currency) || "EUR";
      const link = item.itemWebUrl || item.itemHref || "";
      return {
        title: item.title || "",
        price: priceValue,
        currency: currency,
        condition: item.condition || "",
        image: image,
        link: link,
        seller: item.seller?.username || "",
        shipping: item.shippingOptions?.[0]?.shippingCost?.value === "0.00" ? "Spedizione gratuita" :
                  (item.shippingOptions?.[0]?.shippingCost ? `${item.shippingOptions[0].shippingCost.value} ${item.shippingOptions[0].shippingCost.currency || ""}` : ""),
        country: item.itemLocation?.country || "",
      };
    });

    return res.json({ itemSummaries: items, raw_total: ebayJson.total || 0 });

  } catch (err) {
    console.error("❌ Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
};