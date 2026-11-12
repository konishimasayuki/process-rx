import { Redis } from "@upstash/redis";
import { hasValidSession } from "./_require-session.js";

const redis = Redis.fromEnv();

export const DEFAULT_AGENT_SETTINGS = {
  fax_folder: "\\\\192.168.11.1\\シェアード\\fax",
  auto_print: true,
  printer: "",
};

async function getSettings() {
  const raw = await redis.get("settings:fax_agent");
  const saved = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  return { ...DEFAULT_AGENT_SETTINGS, ...saved };
}

// 薬局PCのFAX取込アプリ用の設定。
// - アプリ(合言葉付き)からのGET: 設定を返し、生存確認(最終接続)を記録
// - 画面(ログイン中)からのGET: 設定と最終接続を返す / POST: 設定を保存
export default async function handler(req, res) {
  const secret = req.headers["x-fax-secret"];
  const isAgent = !!process.env.FAX_SHARED_SECRET && secret === process.env.FAX_SHARED_SECRET;

  if (isAgent && req.method === "GET") {
    const { version, host } = req.query || {};
    await redis.set(
      "fax_agent:heartbeat",
      JSON.stringify({
        last_seen: new Date().toISOString(),
        version: version || "",
        host: host || "",
      })
    );
    res.status(200).json({ settings: await getSettings() });
    return;
  }

  if (!(await hasValidSession(req))) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  if (req.method === "GET") {
    const hb = await redis.get("fax_agent:heartbeat");
    res.status(200).json({
      settings: await getSettings(),
      heartbeat: hb ? (typeof hb === "string" ? JSON.parse(hb) : hb) : null,
    });
    return;
  }

  if (req.method === "POST") {
    const { fax_folder, auto_print, printer } = req.body || {};
    const current = await getSettings();
    const next = {
      fax_folder: fax_folder !== undefined ? String(fax_folder).trim() : current.fax_folder,
      auto_print: auto_print !== undefined ? !!auto_print : current.auto_print,
      printer: printer !== undefined ? String(printer).trim() : current.printer,
    };
    if (!next.fax_folder) {
      res.status(400).json({ error: "FAXフォルダを入力してください" });
      return;
    }
    await redis.set("settings:fax_agent", JSON.stringify(next));
    res.status(200).json({ status: "ok", settings: next });
    return;
  }

  res.status(405).json({ error: "GET/POSTのみ対応しています" });
}
