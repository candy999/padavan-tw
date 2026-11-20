#!/usr/bin/env python3
"""padavan-tw 社群機型相容度預測

依「台灣版改了哪些東西、每一項依賴什麼硬體」，逐台讀上游的機型設定，
推測套用台灣版後大概能不能用、可能卡在哪裡。只讀設定檔，不編譯、不連實機。

  python tools/compat/predict.py               全部機型，輸出 Markdown
  python tools/compat/predict.py K2P MI-R4A    只看指定機型（附細節）
  python tools/compat/predict.py --json        給其他程式用

讀檔用 `git show HEAD:<路徑>`（sparse checkout 也能用）；--worktree 改讀工作目錄。
規則寫在下方 RULES 前的註解與 docs/COMPAT.md，改了台灣版的程式記得一起更新這裡。
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
USE_GIT = '--worktree' not in sys.argv

# 已知的韌體大小（2026-11-20，8b141d4，含黑潮 DNS 3.4.0）
SIZE_USB = 15_974_655      # NEWIFI3（MT7603＋MT7612、USB 功能全開）
SIZE_NOUSB = 13_686_850    # CR660x（MT7915、沒有 USB）
# 已實機或編譯驗證過的硬體
TESTED_HW = {'MT7603E': 'D3 實機', 'MT7612E': 'D3 實機', 'MT7915': 'CR6608 編譯通過、未實機'}
OURS = {'NEWIFI3': 'D3 實機驗證', 'CR660x': '每次編譯、未實機'}


def read(path):
    if USE_GIT:
        r = subprocess.run(['git', '-C', ROOT, 'show', 'HEAD:' + path], capture_output=True)
        return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else ''
    p = os.path.join(ROOT, path)
    return open(p, encoding='utf-8', errors='replace').read() if os.path.exists(p) else ''


def boards():
    if USE_GIT:
        out = subprocess.run(['git', '-C', ROOT, 'ls-tree', '--name-only', 'HEAD', 'trunk/configs/templates/'],
                             capture_output=True, text=True).stdout.split()
    else:
        d = os.path.join(ROOT, 'trunk/configs/templates')
        out = ['trunk/configs/templates/' + f for f in os.listdir(d)]
    return sorted(os.path.basename(f)[:-7] for f in out if f.endswith('.config'))


def kv(text):
    """CONFIG_X=y／CONFIG_X="s"／# CONFIG_X is not set → dict"""
    d = {}
    for line in text.splitlines():
        m = re.match(r'\s*(CONFIG_[A-Za-z0-9_]+)=(.*)$', line)
        if m:
            d[m.group(1)] = m.group(2).strip().strip('"')
            continue
        m = re.match(r'#\s*(CONFIG_[A-Za-z0-9_]+) is not set', line)
        if m:
            d[m.group(1)] = 'n'
    return d


def flash_info(dtb, kern):
    """回傳 (類型, 韌體分割區位元組數或 None, 有沒有黑潮資料區)"""
    dts = read('trunk/linux-4.4.x/arch/mips/boot/dts/ralink/%s.dts' % dtb) if dtb else ''
    kuro = bool(re.search(r'label\s*=\s*"Kuroshio"', dts))
    m = re.search(r'mt7621-spi-(\d+)m-layout', dts)
    if m:
        lay = read('trunk/linux-4.4.x/arch/mips/boot/dts/ralink/mt7621-spi-%sm-layout.dtsi' % m.group(1))
        fw = re.search(r'label\s*=\s*"firmware";\s*reg\s*=\s*<\s*0x[0-9a-f]+\s+(0x[0-9a-f]+)', lay, re.S)
        own = re.search(r'label\s*=\s*"firmware";\s*reg\s*=\s*<\s*0x[0-9a-f]+\s+(0x[0-9a-f]+)', dts, re.S)
        size = int((own or fw).group(1), 16) if (own or fw) else None
        return 'SPI %s MB' % m.group(1), size, kuro
    fw = re.search(r'label\s*=\s*"firmware";\s*reg\s*=\s*<\s*0x[0-9a-f]+\s+(0x[0-9a-f]+)', dts, re.S)
    nand = kern.get('CONFIG_MTD_NAND_MTK') == 'y' or 'nand' in dts.lower()
    return ('NAND' if nand else 'SPI（自訂分割）'), (int(fw.group(1), 16) if fw else None), kuro


def wifi_chips(kern):
    chips = []
    for slot in ('FIRST', 'SECOND', 'THIRD'):
        for k, v in kern.items():
            m = re.match(r'CONFIG_%s_IF_([A-Z0-9]+)$' % slot, k)
            if m and v == 'y' and m.group(1) not in ('NONE', 'EPAELNA', 'IPAILNA', 'EPAILNA', 'IPAELNA'):
                chips.append(m.group(1))
    return chips


def kvr_flags(kern, chips):
    """各晶片 11k／11v／11r 有沒有編進去（依驅動的 Kconfig 名稱）"""
    res = {}
    for c in chips:
        if c == 'MT7603E':
            f = [kern.get('CONFIG_MT7603E_DOT11K_RRM_SUPPORT'), kern.get('CONFIG_MT7603E_WNM_SUPPORT'),
                 kern.get('CONFIG_MT7603E_DOT11R_FT_SUPPORT')]
        elif c in ('MT7612E', 'MT7602E'):
            # mt76x2：11v 的程式在但 Makefile 沒接（見 docs/ROAM-COOP.md 第 8 節）
            f = [kern.get('CONFIG_RT_DOT11K_RRM'), 'n', kern.get('CONFIG_RT_DOT11R_FT')]
        else:  # MT7615E、MT7915
            f = [kern.get('CONFIG_DOT11K_RRM_SUPPORT'), kern.get('CONFIG_WNM_SUPPORT'), kern.get('CONFIG_DOT11R_FT_SUPPORT')]
        res[c] = ''.join(x for x, on in zip('kvr', f) if on == 'y') or '無'
    return res


def analyze(b):
    tpl = kv(read('trunk/configs/templates/%s.config' % b))
    tpl.update(kv(read('trunk/configs/tw/common.config')))
    tpl.update(kv(read('trunk/configs/tw/%s.config' % b)))
    bd = b if read('trunk/configs/boards/%s/board.mk' % b) else tpl.get('CONFIG_FIRMWARE_PRODUCT_ID', b)
    kern = kv(read('trunk/configs/boards/%s/kernel-4.4.x.config' % bd))
    kern.update(kv(read('trunk/configs/tw/kernel-%s.config' % b)))
    mk = read('trunk/configs/boards/%s/board.mk' % bd)
    bh = read('trunk/configs/boards/%s/board.h' % bd)
    ram = re.search(r'CONFIG_BOARD_RAM_SIZE\s*=\s*(\d+)', mk)
    ram = int(ram.group(1)) if ram else None
    usb = tpl.get('CONFIG_FIRMWARE_ENABLE_USB') == 'y'
    chips = wifi_chips(kern)
    dbdc = 'MT7615_DBDC' if 'MT7615_DBDC' in mk else ('MT7915_DBDC' if 'MT7915_DBDC' in mk else '')
    has5g = bool(re.search(r'BOARD_HAS_5G_11AC\s+1', bh)) or bool(dbdc) or len(chips) > 1
    ftype, fwsize, kuro_part = flash_info(kern.get('CONFIG_RALINK_BUILTIN_DTB_NAME', ''), kern)
    gmac2 = kern.get('CONFIG_RAETH_GMAC2') == 'y'
    ports = all(kern.get('CONFIG_RAETH_ESW_PORT_LAN%d' % i) for i in range(1, 5))

    issues = []   # (嚴重度 4 不建議／3 高／2 中／1 低, 項目, 短句, 說明)

    def add(sev, item, msg, short=''):
        issues.append((sev, item, short or msg, msg))

    # 1. 平台：台灣版只在 MT7621＋4.4 核心上驗證
    if tpl.get('CONFIG_PRODUCT') != 'MT7621' or tpl.get('CONFIG_LINUXDIR') != 'linux-4.4.x':
        add(3, '平台', '不是 MT7621＋4.4 核心，台灣版的核心修補（硬體 NAT 殘留標記、STP 急速連線）都沒有在這個平台驗證')

    # 2. Flash：韌體要放得進分割區
    need = SIZE_USB if usb else SIZE_NOUSB
    if fwsize:
        margin = fwsize - need
        if margin < -3_000_000:
            add(4, 'Flash', '分割區只有 %.2f MB，韌體約 %.2f MB，差太多，關功能也放不下' % (fwsize / 1e6, need / 1e6), 'Flash 太小')
        elif margin < 0:
            add(3, 'Flash', '韌體約 %.2f MB，分割區只有 %.2f MB（差 %d KB）：要關掉一些功能%s' % (
                need / 1e6, fwsize / 1e6, -margin // 1024,
                '（USB 的 Samba／FTP／NTFS 其中幾項，或 OpenVPN）' if usb else '（例如 OpenVPN、ttyd）'), '韌體超過分割區 %d KB' % (-margin // 1024))
        elif margin < 1_000_000:
            add(2, 'Flash', '分割區 %.2f MB，只剩約 %d KB：Wi-Fi 驅動比 D3／CR6608 大時可能放不下' % (fwsize / 1e6, margin // 1024), 'Flash 剩不到 1 MB')
        else:
            add(0, 'Flash', '分割區 %.2f MB，估計剩約 %.1f MB' % (fwsize / 1e6, margin / 1e6))
    else:
        add(1, 'Flash', '%s，讀不到韌體分割區大小，請自行比對韌體大小（含 USB 約 %.1f MB、不含約 %.1f MB）' % (
            ftype, SIZE_USB / 1e6, SIZE_NOUSB / 1e6))

    # 3. 記憶體：黑潮 DNS 的快取會長到約 110 MB（記憶體保護會讓出快取）
    if ram is not None:
        if ram <= 64:
            add(3, '記憶體', '%d MB：黑潮 DNS 放不下，請在 tw/%s.config 關掉 CONFIG_FIRMWARE_INCLUDE_KUROSHIO，改用 dnsmasq' % (ram, b), '記憶體 %d MB，要關黑潮 DNS' % ram)
        elif ram <= 128:
            add(2, '記憶體', '%d MB：黑潮 DNS 可以跑，但快取會被記憶體保護一直壓縮，大量查詢時可能變慢；建議實測' % ram, '記憶體 %d MB，黑潮快取受限' % ram)

    # 4. Wi-Fi 晶片：迴圈保護、急速連線、掃描頁、自動選頻規則、出廠預設值是在哪些晶片驗證的
    for c in dict.fromkeys(chips):
        if c in TESTED_HW:
            if c == 'MT7915':
                add(1, 'Wi-Fi', 'MT7915：跟 CR6608 同驅動，編譯驗證過、還沒實機')
        else:
            add(2, 'Wi-Fi', '%s：台灣版沒在這顆晶片上實測（Wi-Fi 迴圈保護、急速連線、掃描頁解析、自動選頻排除 165、TxBF 顯示），先確認掃描頁與 Wi-Fi 重啟後的連線' % c, '%s 未實測' % c)
    if not chips:
        add(2, 'Wi-Fi', '讀不到 Wi-Fi 晶片設定', 'Wi-Fi 晶片不明')
    if not has5g:
        add(1, 'Wi-Fi', '只有 2.4G：後台的 5G 卡片會隱藏，漫遊的頻段引導不適用')

    # 5. 交換器與 MOD：MOD 專用孔、IGMP 固定上游孔用交換器的 WAN 埠
    if gmac2:
        add(2, 'MOD／IPTV', 'WAN 走 GMAC2（不經內建交換器）：MOD 專用孔的橋接與「WAN 設成 IGMP 固定上游孔」可能沒作用，接 MOD 前要實測', 'WAN 走 GMAC2，MOD 要實測')
    if not ports:
        add(2, 'MOD／IPTV', '沒有 LAN1～4 的交換器埠對照：MOD 不會從 MAC 表找機上盒（換孔、路由器重開不會自動跟著）', '沒有 LAN 孔對照')
    else:
        add(0, 'MOD／IPTV', 'LAN 孔對照沿用上游設定（LAN1～4＝埠 %s）；孔位標錯時 MOD 會設到別的孔' % '/'.join(
            kern.get('CONFIG_RAETH_ESW_PORT_LAN%d' % i) for i in range(1, 5)))

    # 6. 重開機：上游 CONFIG_32M_REBOOT_FIXUP 在 4.4 會讓重開機卡住（D3 踩過）
    if tpl.get('CONFIG_32M_REBOOT_FIXUP') == 'y':
        add(2, '重開機', '開了 CONFIG_32M_REBOOT_FIXUP：4.4 的 mtd_write 找不到 mtd1，重開機可能卡住（D3 已關掉；這台要在 tw/%s.config 設 n 並實測）' % b, '重開機修正要關')

    # 7. 黑潮學習資料：D3 有專用 JFFS2 分割區、NAND 機型用 RWFS
    if not kuro_part and ftype.startswith('SPI'):
        add(1, '黑潮 DNS', '沒有黑潮資料區：學習資料只存在記憶體，重開機後要重新學（約幾小時）')

    kvr = kvr_flags(kern, chips)
    sev = max([x[0] for x in issues] or [0])
    level = {0: '預期可用', 1: '預期可用（有小差異）', 2: '大致可用，要實測', 3: '需要調整才能用', 4: '不建議'}[sev]
    if b in OURS:
        level = '正式維護（%s）' % OURS[b]
    return dict(board=b, level=level, severity=sev, chips=chips, dbdc=dbdc, ram=ram, usb=usb, flash=ftype,
                fw_size=fwsize, gmac2=gmac2, kvr=kvr, has5g=has5g,
                issues=[dict(sev=s, item=i, short=sh, msg=m) for s, i, sh, m in sorted(issues, key=lambda x: -x[0])])


def md_table(rows):
    out = ['| 機型 | 預測 | Wi-Fi 晶片 | 記憶體 | Flash | 11k/v/r 編譯 | 主要待確認點 |', '|---|---|---|---|---|---|---|']
    for r in rows:
        chips = '＋'.join(r['chips']) + ('（DBDC）' if r['dbdc'] else '')
        kvr = '、'.join('%s:%s' % (c, f) for c, f in r['kvr'].items()) or '-'
        top = '；'.join(i['short'] for i in r['issues'] if i['sev'] >= 2) or '-'
        out.append('| `%s` | %s | %s | %s MB | %s%s | %s | %s |' % (
            r['board'], r['level'], chips or '-', r['ram'] or '?', r['flash'], '＋USB' if r['usb'] else '', kvr, top))
    return '\n'.join(out)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    rows = [analyze(b) for b in (args or boards())]
    if '--json' in sys.argv:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    print(md_table(rows))
    if args:
        for r in rows:
            print('\n### %s：%s' % (r['board'], r['level']))
            for i in r['issues']:
                print('- [%s] %s：%s' % ('—低中高✕'[i['sev']], i['item'], i['msg']))


if __name__ == '__main__':
    main()
