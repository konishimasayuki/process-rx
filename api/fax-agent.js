import { Redis } from "@upstash/redis";
import { getSession, isAdmin } from "./_session.js";

const redis = Redis.fromEnv();

export const DEFAULT_AGENT_SETTINGS = {
  fax_folder: "\\\\192.168.11.1\\シェアード\\fax",
  auto_print: true,
  printer: "",
};

const IMPORT_COUNTS = [5, 10, 20, 50];
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

async function getSettings() {
  return { ...DEFAULT_AGENT_SETTINGS, ...(parse(await redis.get("settings:fax_agent")) || {}) };
}

// 薬局PCのFAX取込アプリとのやりとり。
//  アプリ(合言葉付き):
//    GET  … 設定と、PCへの依頼(command)を受け取る。生存確認として最終接続も記録
//    POST … 依頼の進み具合・結果を報告
//  画面(ログイン中):
//    GET  … 設定・最終接続・依頼の状況
//    POST { fax_folder, auto_print, printer } … 設定を保存(管理者)
//    POST { command: "import_existing", count } … フォルダにある既存FAXの取込を依頼(管理者)
export default async function handler(req, res) {
  const secret = req.headers["x-fax-secret"];
  const isAgent = !!process.env.FAX_SHARED_SECRET && secret === process.env.FAX_SHARED_SECRET;

  if (isAgent && req.method === "GET") {
    const { version, host, pdf_count } = req.query || {};
    const prev = parse(await redis.get("fax_agent:heartbeat"));
    await redis.set(
      "fax_agent:heartbeat",
      JSON.stringify({
        last_seen: new Date().toISOString(),
        version: version || "",
        host: host || "",
        // 件数が送られてこないときは、前回の値を残す
        pdf_count:
          pdf_count !== undefined && pdf_count !== "" ? Number(pdf_count) : prev?.pdf_count ?? null,
      })
    );
    const command = parse(await redis.get("fax_agent:command"));
    res.status(200).json({
      settings: await getSettings(),
      command: command && command.status === "pending" ? command : null,
    });
    return;
  }

  if (isAgent && req.method === "POST") {
    const { command_id, status, progress, result } = req.body || {};
    const command = parse(await redis.get("fax_agent:command"));
    if (!command || command.id !== command_id) {
      res.status(404).json({ error: "依頼が見つかりません" });
      return;
    }
    const next = {
      ...command,
      status: ["running", "done", "failed"].includes(status) ? status : command.status,
      progress: progress || command.progress || null,
      result: result || command.result || null,
      updated_at: new Date().toISOString(),
    };
    await redis.set("fax_agent:command", JSON.stringify(next), { ex: 60 * 60 * 24 });
    // 取込中はアプリが一覧の取得を止めているので、進み具合の報告を生存確認の代わりにする
    const hb = parse(await redis.get("fax_agent:heartbeat"));
    if (hb) await redis.set("fax_agent:heartbeat", JSON.stringify({ ...hb, last_seen: new Date().toISOString() }));
    res.status(200).json({ status: "ok" });
    return;
  }

  const session = await getSession(req);
  if (!session) {
    res.status(401).json({ error: "ログインが必要です" });
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      settings: await getSettings(),
      heartbeat: parse(await redis.get("fax_agent:heartbeat")),
      command: parse(await redis.get("fax_agent:command")),
    });
    return;
  }

  if (req.method === "POST") {
    if (!isAdmin(session)) {
      res.status(403).json({ error: "管理者のみ操作できます" });
      return;
    }
    const body = req.body || {};

    if (body.command === "import_existing") {
      const count = Number(body.count);
      if (!IMPORT_COUNTS.includes(count)) {
        res.status(400).json({ error: `件数は${IMPORT_COUNTS.join("・")}のいずれかです` });
        return;
      }
      const current = parse(await redis.get("fax_agent:command"));
      if (current && ["pending", "running"].includes(current.status)) {
        const age = Date.now() - new Date(current.updated_at || current.requested_at).getTime();
        if (age < 10 * 60 * 1000) {
          res.status(409).json({ error: "前回の取込がまだ進行中です" });
          return;
        }
      }
      const command = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "import_existing",
        count,
        status: "pending",
        requested_at: new Date().toISOString(),
        requested_by: session.name,
        progress: null,
        result: null,
      };
      await redis.set("fax_agent:command", JSON.stringify(command), { ex: 60 * 60 * 24 });
      res.status(200).json({ status: "ok", command });
      return;
    }

    const { fax_folder, auto_print, printer } = body;
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
