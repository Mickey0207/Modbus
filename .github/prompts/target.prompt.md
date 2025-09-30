---
mode: agent
---

## Modbus 運作方式：正式藍圖（已定案部分）

本文同步會議結論的已定案內容，持續擴充其餘章節（TBD）。

---

### 1) 設備註冊（主機暫存器，FC03/FC06）

- 站號與數量
	- 每台主機最多 255 台從機，使用站號 0..254（共 255 個）。
	- 類型註冊暫存器位址範圍：12000（站號 0）~ 12254（站號 254）。
	- 位址計算：type_addr(unitId) = 12000 + unitId。
	- 備註：若未來需包含站號 255，最後位址需擴至 12255（目前不含）。

- 類型編碼
	- SL_SW8CH → 1；SL_4CH → 2（以十進位寫入）。
	- 讀寫功能碼：讀 FC03；寫 FC06（Modbus TCP/IP，封包以十六進位 PDU/ADU 送出）。

- 範例
	- 設定：將站號 1 設為 4CH → 對位址 12001 寫入 2（FC06）。
		- PDU（示意）：06 | 0x2E E1 | 0x00 02（12001 十進=0x2EE1；值 2=0x0002）。
	- 讀回：讀取站號 1 類型 → 對位址 12001 讀 1 筆（FC03）。

- 資料表（device_register_map）
	- 欄位建議：
		- host_model
		- base_addr: int  // 12000（十進）
		- max_units: int  // 255（支援站號 0..254）
		- last_addr: int  // 12254（= 12000 + (max_units - 1)）
		- read_fc: smallint  // 3
		- write_fc: smallint // 6
		- type_encoding_json: json // 例如 { "SL_SW8CH": 1, "SL_4CH": 2 }
		- note

- 驗證規則
	- 可寫入的類型值僅 {1,2}；越界視為錯誤。
	- unitId 必須於 0..254（或依 last_addr 自動判斷）。
	- 成功寫入後，前端立即正規化 UI；下一輪輪詢以 FC03 再確認。

---

### 2) 單寄存器開關遮罩（SW8/4CH，共用位址規則）

- 位址規則
	- 遮罩暫存器範圍：起始 2000（十進）~ 終點 4032（十進）。
	- 計算：mask_addr(unitId) = 2000 + 8 × unitId。
	- 例：unitId=0 → 2000；unitId=1 → 2008；unitId=2 → 2016；…
	- 備註：若需包含站號 255，最後位址需擴至 4040（目前 4032 對應 0..254）。

- 值域與 bit 規則
	- SW8：8 位遮罩，允許 0..255（0x00..0xFF）。
	- 4CH：4 位遮罩，僅使用低 4 位，允許 0..15（0x0..0xF）。
	- 二進位自左至右敘述、LSB 在最右；十進值按標準二進制計算。
		- 例：0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 = 00001010b = 10(dec)。

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

- 資料表（switch_register_map）
	- 欄位建議：
		- base_addr: int // 2000（十進）
		- end_addr: int  // 4032（十進）
		- step_per_unit: int // 8（每個站號位址遞增 8）
		- read_fc: smallint // 3
		- write_fc: smallint // 6
		- bit_width_sw8: smallint // 8（有效值 0..255/0xFF）
		- bit_width_4ch: smallint // 4（有效值 0..15/0x0F）
		- bit_order: enum('LSB_RIGHT') // 低位在最右
		- note

- 驗證規則
	- unitId 0..254（若要含 255，end_addr 擴至 4040）。
	- 寫入值：SW8 ∈ [0,255]；4CH ∈ [0,15]；越界視為錯誤。
	- 成功寫入後，UI 立即更新；下一輪 FC03 回讀確認。

---

### 3) 群組設定（寫入，自定義 485 協議）

- 功能碼分離
	- 群組「寫入」與「讀出」功能碼不同；本節先定義「寫入」。
	- 寫入功能碼（從機側）：0x19（依樣例）。

- 封包結構（全為 1 byte；最後 1 byte 為校驗）
	1) unitId        (1B) 例：0x19（=25）
### 3) 群組設定（讀出，自定義 485 協議）

- 讀取功能碼（從機側）：0x17。

- 請求封包（Request）結構（全為 1 byte；最後 1 byte 為校驗）
	1) unitId        (1B) 例：0x19（=25）
	2) functionCode  (1B) 固定 0x17（讀取群組）
	3) slaveType     (1B) 0x01=8CH；0x02=4CH
	4) groupRange    (1B) 0x01 → 群組 1..16；0x02 → 群組 17..32
	5) CRC           (1B) 與寫入相同算法（CRC-8，參數同上）

- 回覆封包（Response）結構（全為 1 byte；最後 1 byte 為校驗）
	1) unitId        (1B) 回覆的從機站號
	2) group1        (1B) 該範圍第一個群組的遮罩值
	3) group2        (1B)
	...
	17) group16      (1B) 該範圍第 16 個群組的遮罩值
	18) CRC          (1B) 與寫入相同算法（CRC-8，參數同上）

- 說明
	- 回覆不包含 functionCode/slaveType/groupRange 欄位，需由請求上下文比對。
	- 8CH 值域 0..255；4CH 僅低 4 位 0..15（高位忽略）。
	- 二進位規則與十進/十六進換算與寫入一致（左到右描述、LSB 在最右）。

- 範例
	- 讀取：19-17-01-01-CRC
		- unitId=0x19, fc=0x17, type=0x01(8CH), range=0x01(1..16), CRC=1B
	- 回覆：19-0F-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-CRC
		- unitId=0x19；group1=0x0F；group2..group16=0x00；CRC=1B

- 資料表（group_function_map）補充欄位
	- fc_slave_read: smallint // 0x17
	- response_layout: json // {"bytes": 18, "order": ["unitId", "group[16]", "crc"]}
	- 備註：回覆無 function/type/range，需由請求上下文綁定。

	2) functionCode  (1B) 固定 0x19（寫入群組）
	3) slaveType     (1B) 0x01=8CH；0x02=4CH
	4) groupRange    (1B) 0x01 → 群組 1..16；0x02 → 群組 17..32
	6) CRC           (1B) 校驗（見下）

- 值與位元規則
	- 二進位由左至右描述、LSB 在最右；十進輸入需轉為 8 位（8CH）或 4 位（4CH）的十六進值。
		- 例：0|1|0|1|0|0|0|0 → 00001010b → 0x0A（十進 10）。
	- 8CH：上限 0xFF；4CH：僅低 4 位有效（上限 0x0F）。

- 校驗（CRC/Checksum）
	- 封包為 21 bytes 並附 1 byte 校驗，非標準 Modbus RTU 16-bit CRC。
	- 推定採「CRC-8」單位元組；待最終確認參數。
		- 建議優先：CRC-8(poly 0x07, init 0x00, refin=false, refout=false, xorout=0x00)。
		- 次選比對：CRC-8/MAXIM（poly 0x31, init 0x00, refin=true, refout=true, xorout=0x00）。

- 樣例（你方提供）
	1) 19-19-01-01-0F-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-24
		 - unitId=0x19(25), fc=0x19, type=0x01(8CH), range=0x01(群組1..16)
		 - group1=0x0F，group2..group16=0x00；校驗=0x24
	2) 19-19-01-02-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-9C
		 - type=8CH, range=17..32，全 0；校驗=0x9C
	3) 19-19-02-01-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-60
		 - type=4CH, range=1..16，全 0；校驗=0x60
	4) 19-19-02-02-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-C6
		 - type=4CH, range=17..32，全 0；校驗=0xC6

- 前端封包組裝（十進 → 十六進）
	1) unitId（十進）→ 1B 十六進。
	2) functionCode=0x19。
	3) slaveType：8CH→0x01；4CH→0x02。
	4) groupRange：1..16→0x01；17..32→0x02。
	5) 依序 16 個群組值（十進→十六進；4CH 僅低 4 位）。
	6) 計算 CRC-8（參數待鎖定）附於結尾。
	7) 透過 TCP→485 下發自定義 PDU（隧穿）。

- 資料表（group_function_map）建議欄位
	- slave_type: enum('SL_SW8CH','SL_4CH')
	- fc_slave_write: smallint // 0x19
	- range_encoding: json // {"1..16": 0x01, "17..32": 0x02}
	- groups_per_range: smallint // 16
	- bytes_per_group: smallint // 1
	- value_constraints: json // {"SL_SW8CH": [0,255], "SL_4CH": [0,15]}
	- crc_kind: enum('CRC8_POLY_0x07','CRC8_MAXIM','TBD') // 先標記 TBD
	- note

- 驗證
	- unitId 0..254；groupRange ∈ {0x01,0x02}。
	- 8CH 值域 0..255；4CH 僅低 4 位 0..15；越界錯誤。
	- 送出前本地計算 CRC 與封包匹配方送出。

---

後續章節（TBD）
- 3) 群組設定（自定義 485 協議：讀出）
- 4) 場景設定（自定義 485 協議）
- 5) 範例命令與映射清單
- 6) 系統資訊（DB CRUD 推播）
- 7) 系統資訊（Modbus 傳送）
- 8) 系統資訊（Modbus 接收）
- 9) 自動讀取（3 秒循環與先後順序）