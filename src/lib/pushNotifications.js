/**
 * Send push via Expo Push API.
 * @param {string|string[]} to - Expo push token(s) (ExponentPushToken[...])
 * @param {{ title?: string, body: string, data?: object }} payload
 */
export async function sendExpoPush(to, { title, body, data = {} }) {
  if (!to) return;

  // Handle single token or array of tokens
  const tokens = Array.isArray(to) ? to : [to];

  // Filter valid tokens - must be strings starting with ExponentPushToken
  const validTokens = tokens.filter(
    (token) =>
      token &&
      typeof token === "string" &&
      token.startsWith("ExponentPushToken"),
  );

  if (validTokens.length === 0) return;

  try {
    // Send to each token individually to handle failures gracefully
    // This prevents one failed token from affecting others
    const sendPromises = validTokens.map(async (token, index) => {
      try {
        const message = {
          to: token,
          title: title || "Your Meme's",
          body: body || "",
          data: { ...data },
          sound: "default",
          channelId: "default",
          priority: "high",
          badge: 1,
        };

        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify(message),
        });

        if (!res.ok) {
          const text = await res.text();
          console.warn(
            `Expo push failed for token ${index}:`,
            res.status,
            text,
          );
          return { success: false, token: token, error: text };
        }

        const result = await res.json().catch(() => ({}));

        // Check for errors in the response
        if (
          result.data &&
          result.data[0] &&
          result.data[0].status === "error"
        ) {
          const errorMsg = result.data[0].message;
          // Only log important errors, not common ones like invalid credentials
          if (
            !errorMsg.includes("FCM server key") &&
            !errorMsg.includes("unable to retrieve")
          ) {
            console.warn(
              `Push notification error for token ${index}:`,
              errorMsg,
            );
          }
          return { success: false, token: token, error: errorMsg };
        }

        return { success: true, token: token };
      } catch (e) {
        console.warn(`Error sending push to token ${index}:`, e?.message || e);
        return { success: false, token: token, error: e?.message };
      }
    });

    // Wait for all sends to complete
    const results = await Promise.all(sendPromises);

    // Count successes and failures
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    // Only log summary if there are failures (to avoid spam)
    if (failCount > 0 && failCount === validTokens.length) {
      console.warn(`All ${failCount} push notifications failed`);
    }
  } catch (e) {
    console.warn("Expo push error:", e?.message || e);
  }
}
