/**
 * Send push via Expo Push API.
 * @param {string} to - Expo push token (ExponentPushToken[...])
 * @param {{ title?: string, body: string, data?: object }} payload
 */
export async function sendExpoPush(to, { title, body, data = {} }) {
  if (!to || typeof to !== "string" || !to.startsWith("ExponentPushToken")) {
    return;
  }
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        title: title || "Notification",
        body: body || "",
        data: { ...data },
        sound: "default",
        channelId: "default",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn("Expo push failed:", res.status, text);
    }
  } catch (e) {
    console.warn("Expo push error:", e?.message || e);
  }
}
