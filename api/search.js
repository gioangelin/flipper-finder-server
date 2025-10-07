// api/search.js
// Vercel Serverless Function: proxy per eBay Browse API (marketplace IT)
// Richiesta token con client_credentials, cache in memoria, richieste /search?q=...

const TOKEN_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.browse";
const MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_LIMIT = 12;

module.exports = async (req, res) => {
  // CORS (consentire chiamate da extension/content script)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

    // --- Ottieni token (cache in memoria globale per evitare richieste ripetute) ---
    if (!global.__EBAY_TOKEN || Date.now() > global.__EBAY_TOKEN_EXPIRES_AT) {
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

      global.__EBAY_TOKEN = tokenJson.access_token;
      // expires_in is in seconds - mettiamo un margine di 60s
      global.__EBAY_TOKEN_EXPIRES_AT = Date.now() + (tokenJson.expires_in - 60) * 1000;
      console.log("Obtained new eBay token, expires in:", tokenJson.expires_in);
    }

    const accessToken = global.__EBAY_TOKEN;

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

    // mappiamo i campi in forma semplice
    const items = (ebayJson.itemSummaries || []).map((item) => {
      const image =
        item.image?.imageUrl ||
        item.thumbnailImages?.[0]?.imageUrl ||
        item.additionalImages?.[0]?.imageUrl ||
        "";

      const priceValue =
        item.price?.value ||
        item.currentBidPrice?.value ||
        (item.priceRange && item.priceRange.min && item.priceRange.min.value) ||
        "N/D";

      const currency =
        item.price?.currency ||
        item.currentBidPrice?.currency ||
        (item.priceRange && item.priceRange.min && item.priceRange.min.currency) ||
        "EUR";

      const link = item.itemWebUrl || item.itemHref || "";

      return {
        title: item.title || "",
        price: priceValue,
        currency: currency,
        condition: item.condition || "",
        image: image,
        link: link,
        seller: item.seller?.username || "",
        shipping:
          item.shippingOptions?.[0]?.shippingCost?.value === "0.00"
            ? "Spedizione gratuita"
            : (item.shippingOptions?.[0]?.shippingCost ? `${item.shippingOptions[0].shippingCost.value} ${item.shippingOptions[0].shippingCost.currency || ""}` : ""),
        country: item.itemLocation?.country || "",
      };
    });

    return res.json({ itemSummaries: items, raw_total: ebayJson.total || 0 });
  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
};
