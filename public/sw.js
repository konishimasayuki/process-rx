// process-rx サービスワーカー(ホーム画面に追加・通知用。データは常に最新をネットから取得)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// FAX受信などのお知らせ(プッシュ通知)。アプリのアイコンにも件数を出す
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      try {
        if (typeof data.badge === "number" && self.navigator.setAppBadge) {
          if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
          else await self.navigator.clearAppBadge();
        }
      } catch {
        // バッジに対応していない端末
      }
      await self.registration.showNotification(data.title || "process-rx", {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.tag || "process-rx",
        renotify: true,
        data: { url: data.url || "/" },
      });
    })()
  );
});

// 通知をタップしたら、アプリを開く(開いていればそれを前に出す)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
