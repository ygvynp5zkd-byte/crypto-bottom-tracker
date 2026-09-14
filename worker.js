export default {
  async fetch(request, env) {
    const message =
      "🔔 TEST\n\n" +
      "Crypto Bottom Tracker يعمل بنجاح ✅\n" +
      "Cloudflare → Telegram";

    const url =
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message
      })
    });

    return new Response(await response.text(), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
};
