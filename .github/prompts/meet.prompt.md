---
mode: agent
---

## 目標
逐條確認 Modbus 端到端設計與資料表，拍板後回填至 target.prompt.md 作為正式藍圖。

## 議程大綱（12 面向）

1) 通訊拓樸與連線策略
- 預設：每 Host 長連線；斷線指數回退重連；多 Host 併行，單 Host 串行（佇列）。
- 待決：keep-alive 與重連 backoff 具體參數。

2) 位址與功能碼（讀/寫）
- 預設：讀 FC03、寫 FC06；DIM4 亮度先用 4 次 FC06，確認再切 FC16。
- 待決：設備是否支援 FC16；必要時切換策略。

3) 暫存器映射來源
- 預設：後端單一 mapping（config/schema），前端只呼叫 helper。
- 待決：host 型號/韌體差異如何分流。

4) 佇列、節流與重試
- 預設：10 req/s 上限；逾時 1.5–2s；重試 2 次（200ms/500ms）；去重（相同地址短時間覆寫）。
- 待決：實機建議參數。

5) 輪詢（Poll）策略
- 預設：每 Host 2–3s 一輪，±10% 抖動；與寫入互斥（有 in-flight 則暫停該 Host 輪詢）。
- 待決：是否依主機/從機數量自動調整間隔。

6) SW8/DIM4 行為定義
- 預設：SW8=8-bit 遮罩；DIM4=4-bit 遮罩 + 4 通道值(0..255)。
- 待決：值域與 bit 順序、位址最終版。

7) 群組設定（自定義 485 協議）
- 預設：同批次下主機指令與從機自定義指令；從機無回覆則排程讀取確認。
- 待決：功能碼/位址/payload 與 index 範圍。

8) 場景設定（自定義 485 協議）
- 預設：同批次下主機與從機指令；8CH/4CH payload 長度不同；設定範圍「FF」需精確定義。
- 待決：「FF」的語意與 8CH/4CH 的長度與欄位順序。

9) 自動讀取（3 秒循環與先後順序）
- 預設：類型 → 燈號 → 調光 → 群組 → 場景；每步記 DB 與 Modbus 傳送，回覆再記接收。
- 待決：是否允許部分步驟失敗、重試策略。

10) 日誌與可觀測性
- 預設：web/modbusPoll/dbPollMb/dbPollDb 四通道；debug 可附 raw PDU。
- 待決：生產是否開啟 raw PDU；批次 batchId 串接規則。

11) API 與資料持久化
- 預設：REST 最小集合（/hosts, /slaves, /modbus/write, /scene/execute...）；群組/場景配置入庫。
- 待決：資料表最終結構與索引。

12) 邊界條件與 UI 語意
- 預設：不使用 unitId=0 廣播；佇列上限 100；群組/場景每列提供執行按鈕，表頭支援批量執行。
- 待決：上限策略與丟棄規則。

## 資料表草案

- device_register_map（主機註冊/查詢從機類型）
	- host_model
	- base_addr: int  // 12000（十進）
	- max_units: int  // 255（支援站號 0..254；若需含 255，last_addr 需到 12255）
	- last_addr: int  // 12000 + (max_units - 1) = 12254（依目前規格）
	- read_fc: smallint  // 3
	- write_fc: smallint // 6
	- type_encoding_json: json // 例如 { "SL_SW8CH": 1, "SL_4CH": 2 }
	- note

- switch_register_map（8CH/4CH 遮罩）
	- base_addr: int // 2000（十進）
	- end_addr: int  // 4032（十進）
	- step_per_unit: int // 8（每個站號位址遞增 8）
	- read_fc: smallint // 3
	- write_fc: smallint // 6
	- bit_width_sw8: smallint // 8（有效值 0..255/0xFF）
	- bit_width_4ch: smallint // 4（有效值 0..15/0x0F）
	- bit_order: enum('LSB_RIGHT') // 低位在最右（0|1|0|1|0|0|0|0 → 00001010b = 10）
	- note

- dim_value_register_map（4CH 調光值）
	- slave_type, value_base_addr, channels, value_min, value_max, write_mode, note

- group_function_map（群組自定義協議）
	- slave_type, fc_host, host_addr, payload_spec_host, fc_slave, payload_spec_slave, read_fc_slave, read_payload_spec_slave, note

- scene_function_map（場景自定義協議）
	- slave_type, fc_host, host_addr, payload_spec_host, fc_slave, payload_spec_slave, read_fc_slave, read_payload_spec_slave, note

## 9 點需求的對應設計摘要

1) 設備註冊：FC03/FC06 + device_register_map；UI 立即正規化並以輪詢回讀確認。
2) 單寄存器讀寫：switch_register_map + dim_value_register_map；DIM4 先用 FC06x4。
3) 群組設定：自定義 485；交易批次（主機+從機）；group_function_map。
4) 場景設定：自定義 485；8CH/4CH 長度不同；scene_function_map；交易批次。
5) 範例命令：待提供後補齊 mapping 與流程圖。
6) 系統資訊（DB）：所有 DB CRUD 事件立即推播 dbPollDb。
7) 系統資訊（Modbus傳送）：送出前記 modbusPoll（ok=undefined）。
8) 系統資訊（Modbus接收）：有回覆即記 dbPollMb；無回覆則安排讀取確認後記錄。
9) 自動讀取：3 秒循環，先後順序固定；與寫入互斥；每步同時記 DB 與傳送，收到再記接收。

## 第二點：單寄存器開關遮罩（結論）

- 位址規則
	- 起始 2000（十進），終點 4032（十進）。
	- 計算：mask_addr(unitId) = 2000 + 8 × unitId。
	- 依此，unitId=0 → 2000；unitId=1 → 2008；unitId=2 → 2016；…
	- 備註：若包含站號 255，最後位址需擴至 4040（目前 4032 對應 0..254）。

- 值域與 bit 規則
	- SW8：8 位遮罩，允許 0..255（0x00..0xFF）。
	- 4CH：4 位遮罩，僅使用低 4 位，允許 0..15（0x0..0xF）。
	- bit 次序採 LSB 在最右，十進值按標準二進制計算。
		- 例：0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 代表 00001010b = 10(dec)。

- 功能碼
	- 讀取：FC03（Read Holding Registers），quantity=1。
	- 寫入：FC06（Preset Single Register）。

- 範例 PDU（示意）
	- 寫入 SW8：unitId=1，地址 2008(0x07D8)，值 10(0x000A)
		- PDU：06 | 0x07 D8 | 0x00 0A
	- 讀回 SW8：unitId=1，地址 2008，quantity=1
		- PDU：03 | 0x07 D8 | 0x00 01
	- 寫入 4CH（僅低 4 位）：unitId=2，地址 2016(0x07E0)，值 0x000F（全開）
		- PDU：06 | 0x07 E0 | 0x00 0F

- 資料表落地（switch_register_map）
	- base_addr=2000，end_addr=4032，step_per_unit=8，read_fc=3，write_fc=6。
	- bit_width_sw8=8，bit_width_4ch=4，bit_order='LSB_RIGHT'。
	- 寫入時對 4CH 僅允許/採用低 4 位（高位忽略）。

- 驗證規則
	- unitId 0..254（若要含 255，end_addr 擴至 4040）。
	- 寫入值：SW8 ∈ [0,255]；4CH ∈ [0,15]；越界視為錯誤。
	- 成功寫入後，UI 立即更新；下一輪 FC03 回讀確認。

	## 第三點：群組設定（寫入，自定義 485 協議）— 結論草案

	- 功能碼分離
		- 群組「寫入」與「讀出」功能碼不同；本節先定義寫入。
		- 寫入功能碼（從機側 fc_slave_write）：0x19（依樣例推定）。

	- 封包結構（全部以 1 byte 為單位；最後 1 byte 為校驗）
		1) unitId        (1B) 例：0x19（=25）
		2) functionCode  (1B) 固定 0x19（寫入群組）
		3) slaveType     (1B) 0x01=8CH；0x02=4CH
		4) groupRange    (1B) 0x01 → 群組 1..16；0x02 → 群組 17..32
		5) groupBytes    (16B) 依序對應 16 個群組的遮罩值（8CH：0x00..0xFF；4CH：0x00..0x0F）
		6) CRC           (1B) 校驗碼（見下）

	- 值與位元規則
		- 二進位由左至右敘述、LSB 在最右；十進輸入需轉為對應 8 位（8CH）或 4 位（4CH）的十六進位。
			- 例：0|1|0|1|0|0|0|0 → 00001010b → 0x0A（十進 10）。
		- 8CH：上限 0xFF；4CH：僅低 4 位有效（上限 0x0F），高 4 位強制為 0。

	- 校驗（CRC/Checksum）推論與建議
		- 樣例封包長度為 21 位元組且只附 1 byte 校驗，非標準 Modbus RTU 16-bit CRC。
		- 依樣例推定為「CRC-8」單位元組（而非 LRC；LRC 兩補數與樣例不符）。
		- 建議嘗試參數：CRC-8 with poly 0x07, init 0x00, refin=false, refout=false, xorout=0x00。
			- 若與實機/樣例不符，次選：CRC-8/MAXIM（poly 0x31, init 0x00, refin=true, refout=true, xorout=0x00）。
		- 一旦你確認哪一種與樣例吻合，我會鎖定為正式規格並在前端實作同參數計算。

	- 樣例解析（你提供）
		1) 19-19-01-01-0F-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-24
			 - unitId=0x19(25), fc=0x19, type=0x01(8CH), range=0x01(群組1..16)
			 - group1=0x0F（前四燈亮），group2..group16=0x00
			 - 校驗=0x24（CRC-8 待最終確認）
		2) 19-19-01-02-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-9C
			 - type=8CH, range=群組17..32，全 0 → 校驗 0x9C
		3) 19-19-02-01-00-...-60
			 - type=4CH, range=群組1..16，全 0 → 校驗 0x60
		4) 19-19-02-02-00-...-C6
			 - type=4CH, range=群組17..32，全 0 → 校驗 0xC6

	- 前端封包組裝步驟（十進 → 十六進）
		1) 將 unitId（十進）轉 1B 十六進位。
		2) functionCode 固定 0x19。
		3) slaveType：8CH→0x01；4CH→0x02。
		4) groupRange：1..16→0x01；17..32→0x02。
		5) 依序填滿 16 個群組值（十進輸入→十六進位；4CH 僅低 4 位）。
		6) 計算 1B 校驗（CRC-8；參數待最終鎖定），附於最後。
		7) 透過 TCP→485 閘道下發（Modbus/TCP over 485 的自定義 PDU）。

	- 資料表落地（group_function_map）建議欄位補強
		- slave_type: enum('SL_SW8CH','SL_4CH')
		- fc_slave_write: smallint // 0x19
		- range_encoding: json // {"1..16": 0x01, "17..32": 0x02}
		- groups_per_range: smallint // 16
		- bytes_per_group: smallint // 1
		- value_constraints: json // {"SL_SW8CH": [0,255], "SL_4CH": [0,15]}
		- crc_kind: enum('CRC8_POLY_0x07','CRC8_MAXIM','TBD') // 先標記 TBD，待你確認樣例對應
		- note

	- 邊界與驗證
		- unitId 0..254（與已定案一致）。
		- groupRange 僅允許 0x01 或 0x02；UI 若以 index（1..32）選擇，需自動對應。
		- 值域檢查：8CH→0..255；4CH→0..15。
		- 送出前先本地重算校驗；與樣例/設備規格一致方送出。

## 第一點：設備註冊（結論）

- 站號與數量
	- 每台主機最多 255 台從機，使用站號 0..254（共 255 個）。
	- 對應暫存器位址範圍：12000（站號 0）~ 12254（站號 254）。
	- 位址計算：addr = 12000 + unitId。
	- 備註：若需包含站號 255，則需擴充最後位址至 12255。

- 類型編碼
	- SL_SW8CH → 1；SL_4CH → 2（以十進位寫入）。
	- 讀寫功能碼：讀 FC03；寫 FC06（Modbus TCP/IP，送出時轉為十六進位 PDU）。

- 範例
	- 設定：將站號 1 設為 4CH → 對位址 12001 寫入 2（FC06）。
		- PDU（功能層）：06 | 0x2E E1 | 0x00 02（12001 十進=0x2EE1；值 2=0x0002）。
	- 讀回：讀取站號 1 類型 → 對位址 12001 讀 1 筆（FC03）。

- 資料表落地（device_register_map）
	- base_addr=12000，max_units=255，last_addr=12254，read_fc=3，write_fc=6。
	- type_encoding_json={"SL_SW8CH":1, "SL_4CH":2}。

- 驗證規則
	- 寫入值僅允許 {1,2}；超出視為錯誤。
	- unitId 必須 0..254（或依實際 last_addr 判定）。
	- 成功寫入後，前端立即正規化 UI，並在下一輪輪詢以 FC03 再確認。

## 決策記錄（會議中填寫）

- 1) 設備註冊：
	- base_addr=12000；max_units=255 → last_addr=12254；addr=12000+unitId。
	- 類型碼：SL_SW8CH=1；SL_4CH=2；read_fc=3；write_fc=6。
	- 備註：是否需要支持站號 255 → 若要，last_addr 調整為 12255（待是否需要再確認）。
- 2) FC16 使用：
- 4) 逾時/重試/節流：
- 6) 值域/位址/bit 順序：
- 7) 群組功能碼/payload：
- 8) 場景功能碼/FF 語意/長度：
- 9) 失敗重試策略：
- 10) raw PDU 在生產：
- 11) 資料表最終鍵與索引：

## 待提供資料（由你提供）

- 主機註冊/查詢、遮罩/調光、群組設定、場景設定之範例命令與每位元意義。
- 主機/從機型號與可能的韌體差異清單。

## 後續動作

- 你確認上述預設與補充樣例後，我會整合為正式規格，回填 `target.prompt.md`，並產出前端/後端落地任務清單。
