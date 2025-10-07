// api/search.js
import fetch from "node-fetch";

const TOKEN_SCOPE = "https://api.ebay.com/oauth/api_scope"; // Client Credentials flow
const MARKETPLACE_ID = "EBAY_IT";
const DEFAULT_LIMIT = 12;

// Cache globale per token (process-local)
let cachedToken = null;
let tokenExpiresAt = 0;

// utility: convert price string -> number (gestisce formati "1.234,56", "1234.56", "12,50", "€ 12,50")
function toNumber(value) {
  if (value === undefined || value === null) return NaN;
  const s = String(value).trim();
  // rimuovi tutto tranne digits, dot, comma, minus
  const cleaned = s.replace(/[^\d\.,-]/g, "").trim();
  if (!cleaned) return NaN;
  // Se contiene sia '.' che ',' assume '.' migliaia e ',' decimali -> rimuovi '.' e sostituisci ',' con '.'
  if (cleaned.indexOf(".") > -1 && cleaned.indexOf(",") > -1) {
    return parseFloat(cleaned.replace(/\./g, "").replace(/,/g, "."));
  }
  // Se contiene solo ',' -> consideralo separatore decimale
  if (cleaned.indexOf(",") > -1 && cleaned.indexOf(".") === -1) {
    return parseFloat(cleaned.replace(/,/g, "."));
  }
  // altrimenti parse diretto
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter 'q'" });

    // parse optional vinted price (client può passare vinted_price)
    const rawVinted = req.query.vinted_price;
    const vintedPrice = rawVinted ? toNumber(rawVinted) : NaN;

    // --- ottieni token se necessario ---
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
      tokenExpiresAt = Date.now() + (tokenJson.expires_in - 60) * 1000;
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

    // mappiamo e aggiungiamo prezzo numerico per ogni elemento
    const items = (ebayJson.itemSummaries || []).map((item) => {
      const priceValue =
        item.price?.value ||
        item.currentBidPrice?.value ||
        (item.priceRange && item.priceRange.min && item.priceRange.min.value) ||
        "";

      const currency =
        item.price?.currency ||
        item.currentBidPrice?.currency ||
        (item.priceRange && item.priceRange.min && item.priceRange.min.currency) ||
        "EUR";

      const numeric = toNumber(priceValue);

      return {
        title: item.title || "",
        price: priceValue || "N/D",
        priceNumeric: Number.isFinite(numeric) ? numeric : null,
        currency,
        condition: item.condition || "",
        image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || (item.additionalImages?.[0]?.imageUrl || ""),
        link: item.itemWebUrl || item.itemHref || "",
        seller: item.seller?.username || "",
        shipping:
          item.shippingOptions?.[0]?.shippingCost?.value === "0.00"
            ? "Spedizione gratuita"
            : (item.shippingOptions?.[0]?.shippingCost ? `${item.shippingOptions[0].shippingCost.value} ${item.shippingOptions[0].shippingCost.currency || ""}` : ""),
        country: item.itemLocation?.country || "",
      };
    });

    // calcolo statistiche sui prezzi numerici
    const numericPrices = items.map(i => i.priceNumeric).filter(v => typeof v === "number" && !isNaN(v));
    const count = numericPrices.length;
    const min = count ? Math.min(...numericPrices) : null;
    const max = count ? Math.max(...numericPrices) : null;
    const avg = count ? numericPrices.reduce((s, x) => s + x, 0) / count : null;

    const stats = {
      count,
      min,
      max,
      avg: avg !== null ? Math.round(avg * 100) / 100 : null,
      vintedPrice: Number.isFinite(vintedPrice) ? vintedPrice : null,
    };

    if (Number.isFinite(vintedPrice) && stats.avg !== null) {
      stats.diff = Math.round((stats.avg - vintedPrice) * 100) / 100; // avg - vinted
      stats.diffPercent = Math.round(((stats.avg - vintedPrice) / vintedPrice) * 100 * 100) / 100; // percent with 2 decim
    }

    return res.json({ itemSummaries: items, stats, raw_total: ebayJson.total || 0 });
  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
}