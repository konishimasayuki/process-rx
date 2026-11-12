\xef\xbb\xbfprocess-rx FAX取込アプリ

■ 入っているもの
  process-rx-agent.exe … FAXを取り込んで合体・印刷するアプリ
  SumatraPDF.exe       … 自動印刷に使うPDFソフト(削除しないでください)

■ はじめての設定
  1. このフォルダを C:\process-rx に置く
  2. process-rx-agent.exe をダブルクリック
  3. 質問に答える
     ・合言葉 … VercelのFAX_SHARED_SECRETと同じ文字列
     ・FAXのフォルダ … そのままEnterでOK(\\192.168.11.1\シェアード\fax)
     ・自動印刷 … Enter(する)
     ・プリンタ名 … Enter(いつも使うプリンタ)
     ・自動起動 … Enter(する)

■ ふだん
  ・黒い画面は閉じない(最小化はOK)。閉じると取り込みが止まります
  ・アプリが動いている間はパソコンがスリープしません(画面は消えてOK)
  ・合体したPDFは「合体済み」フォルダに日付ごとに保存されます
  ・動作の記録は agent.log に残ります

■ 設定をやり直したいとき
  config.json を削除して、アプリを起動し直す
