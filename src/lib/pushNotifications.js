/**
 * Send push via Expo Push API.
 * @param {string|string[]} to - Expo push token(s) (ExponentPushToken[...])
 * @param {{ title?: string, body: string, data?: object }} payload
 */
export async function sendExpoPush(to, { title, body, data = {} }) {
  if (!to) return;
  
  // Handle single token or array of tokens
  const tokens = Array.isArray(to) ? to : [to];
  
  // Filter valid tokens
  const validTokens = tokens.filter(
    (token) => token && typeof token === "string" && token.startsWith("ExponentPushToken")
  );
  
  if (validTokens.length === 0) return;
  
  try {
    // Expo Push API supports sending to multiple tokens in one request
    const messages = validTokens.map((token) => ({
      to: token,
      title: title || "Your Meme's",
      body: body || "",
      data: { ...data },
      sound: "default",
      channelId: "default",
      priority: "high",
      badge: 1,
    }));
    
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });
    
    if (!res.ok) {
      const text = await res.text();
      console.warn("Expo push failed:", res.status, text);
    } else {
      const result = await res.json().catch(() => ({}));
      // Log any errors from Expo Push API
      if (result.data) {
        result.data.forEach((item, index) => {
          if (item.status === "error") {
            console.warn(`Push notification error for token ${index}:`, item.message);
          }
        });
      }
    }
  } catch (e) {
    console.warn("Expo push error:", e?.message || e);
  }
}
