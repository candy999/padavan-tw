#!/usr/bin/env python3
"""padavan-tw 後台預覽工具

在電腦上模擬路由器的 httpd：把 .asp / .js 裡的 <% ... %> 換成範例資料、
把 <#key#> 換成 TW.dict 的字串，並套用 www/Makefile 安裝時注入的 viewport 與 tw.css。
不需要路由器，也不會送出任何設定。

用法：
    python3 tools/ui-preview/serve.py [--port 8088] [--lang TW]
然後用瀏覽器開 http://127.0.0.1:8088/
"""
import argparse
import http.server
import json
import os
import re
import socketserver
import time
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WWW = os.path.join(ROOT, 'trunk', 'user', 'www')
WEBUI = os.path.join(WWW, 'n56u_ribbon_fixed')
WEB_EX = os.path.join(ROOT, 'trunk', 'user', 'httpd', 'src', 'web_ex.c')

# 與 www/Makefile 的注入內容保持一致
INJECT_AFTER = '<link rel="stylesheet" type="text/css" href="/bootstrap/css/main.css">'
INJECT = ('\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
          '\n<link rel="stylesheet" type="text/css" href="/bootstrap/css/tw.css">')

# 範例 nvram（Newifi D3、中華電信 PPPoE）
NVRAM = {
    'sw_mode': '1', 'wan_route_x': 'IP_Routed', 'wan_proto': 'pppoe', 'lan_proto_x': '0',
    'log_float_ui': '0', 'preferred_lang': 'TW', 'rt_radio_x': '1', 'wl_radio_x': '1',
    'rt_guest_enable': '0', 'wl_guest_enable': '0', 'nvram_manual': '0', 'link_internet': '1',
    'lan_ipaddr': '192.168.2.1', 'lan_netmask': '255.255.255.0', 'productid': 'NEWIFI3',
    'firmver_sub': '3.4.3.9-099_2026-11', 'computer_name': 'NEWIFI3', 'time_zone': 'CCT-8',
    'ntp_server0': 'time.stdtime.gov.tw', 'ntp_server1': 'tock.stdtime.gov.tw',
    'wl_ssid': 'padavan-tw_5G', 'rt_ssid': 'padavan-tw', 'wl_channel': '149', 'rt_channel': '6', 'wl_country_code': 'TW', 'rt_country_code': 'TW', 'wl_TxPower': '100', 'rt_TxPower': '100', 'tw_acs_daily': '1', 'kuroshio_enable': '1', 'kuroshio_domain': 'home.example.net', 'kuroshio_cf_token': 'x', 'kuroshio_ddns': '1', 'kuroshio_dot': '1', 'kuroshio_doq': '0', 'kuroshio_doh': '1', 'kuroshio_doh_port': '8443', 'kuroshio_doh_wan_port': '443', 'kuroshio_wan': '1', 'kuroshio_access': 'taiwan', 'kuroshio_log': 'warn', 'tw_roam_enable': '1', 'tw_roam_weak': '-75', 'wgs_enable': '1', 'wgs_port': '51820', 'wgs_addr': '10.66.0.1', 'wgs_host': '', 'wgs_lan_nat': '1', 'wgs_pubkey': 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', 'wgs_num_x': '2', 'ddns_enable_x': '0', 'wan0_ipaddr': '1.163.20.30', 'lan_ipaddr': '192.168.2.1', 'lan_netmask': '255.255.255.0', 'tw_acs_hour': '4', 'rt_HT_BW': '0',
    'wan_pppoe_username': '87654321@hinet.net', 'sqm_enable': '0', 'hw_nat_mode': '1',
    'rt_wpa_psk': 'family-2024', 'wl_wpa_psk': 'family-2024', 'rt_auth_mode': 'psk', 'wl_auth_mode': 'psk', 'rt_wpa_mode': '2', 'wl_wpa_mode': '2',
    'rt_guest_ssid': 'padavan-tw_Guest', 'wl_guest_ssid': 'padavan-tw_Guest_5G', 'rt_guest_wpa_psk': 'welcome123', 'rt_guest_auth_mode': 'psk', 'rt_guest_lan_isolate': '1',
    'rt_guest_time_x': '00002359', 'rt_guest_date_x': '1111111', 'macfilter_enable_x': '2', 'macfilter_num_x': '1',
    'wl_HT_BW': '2', 'tw_acs_hour': '4', 'ipv6_service': 'dhcp6', 'wan_dnsenable_x': '1', 'upnp_enable_x': '1', 'wan_mtu': '1500', 'wan_pppoe_mtu': '1492',
    'wan_pppoe_passwd': 'secret', 'wan_ipaddr': '', 'wan_netmask': '', 'wan_gateway': '', 'wan_dns1_x': '', 'wan_dns2_x': '', 'wan_hostname': '',
    'kuroshio_filter': '1', 'kuroshio_cdn': '1', 'reboot_schedule_enable': '1', 'reboot_schedule': '00000010500', 'front_led_all': '1',
    'http_username': 'admin', 'dhcp_static_arp': '0', 'dhcp_static_x': '1', 'dhcp_staticnum_x': '3', 'vts_enable_x': '1', 'vts_num_x': '2', 'dhcp_start': '192.168.2.100', 'dhcp_end': '192.168.2.244',
}

FUNC_VALUES = {
    # firmware_caps_hook
    'support_ipv6': 1, 'support_ipv6_ppe': 1, 'support_ipv4_ppe': 1, 'support_http_ssl': 0,
    'support_usb': 1, 'support_num_usb': 1, 'support_storage': 1, 'support_num_ephy': 5,
    'support_switch_type': 0, 'support_2g_radio': 1, 'support_5g_radio': 1, 'support_5g_11ac': 1,
    'support_5g_wid': 7612, 'support_2g_wid': 7603, 'support_5g_stream_tx': 2, 'support_5g_stream_rx': 2,
    'support_2g_stream_tx': 2, 'support_2g_stream_rx': 2, 'support_sfe': 1, 'support_5g_txbf': 1,
    'support_max_conn': 16384, 'support_min_vlan': 3,
    'found_app_smbd': 1, 'found_app_nmbd': 1, 'found_app_ftpd': 1, 'found_app_sshd': 1,
    'found_app_ttyd': 1, 'found_app_iperf3': 1, 'found_app_sqm': 1, 'found_app_wireguard': 1,
    'found_app_xupnpd': 1, 'found_app_vpnsvr': 1, 'found_app_vpncli': 1, 'found_app_smartdns': 0,
    'found_app_kuroshio': 1, 'found_app_sqm': 0,
    'found_app_ovpn': 1, 'found_app_l2tp': 1,
    # login_state_hook
    'login_safe': 1, 'login_ip_str': "'192.168.2.12'", 'login_mac_str': "'3C:22:FB:00:00:12'",
    # wanlink
    'wanlink_status': 0, 'wanlink_etherlink': "'1000 Full'", 'wanlink_uptime': 2002800,
    'wanlink_type': "'PPPoE'", 'wanlink_ip4_wan': "'114.32.10.20'", 'wanlink_gw4_wan': "'168.95.98.254'",
    'wanlink_dns': "'168.95.1.1 168.95.192.1'", 'wanlink_mac': "'20:76:93:00:00:01'",
    'wanlink_bytes_rx': 103300000000, 'wanlink_bytes_tx': 9100000000, 'nf_conntrack_count': 3412,
    'board_boot_time': 23, 'board_flash_time': 1, 'get_usb_ports_num': 1,
}


# 線上裝置（get_static_client：IP、MAC、名稱、類型）與 Wi-Fi 訊號（wl_auth_list）
STATIC_CLIENTS = [
    ('192.168.2.31', '7C:1E:52:00:00:A4', 'LivingRoom-TV.lan', '6'),
    ('192.168.2.105', 'A4:83:E7:00:00:21', 'Ming-iPhone.lan', '6'),
    ('192.168.2.112', '3C:06:30:00:00:35', 'Mom-iPad.lan', '6'),
    ('192.168.2.10', '3C:22:FB:00:00:10', 'DESKTOP-STUDY.lan', '1'),
    ('192.168.2.44', '00:1A:2B:00:00:44', 'roborock-vacuum.lan', '6'),
    ('192.168.2.52', 'F8:46:1C:00:00:52', 'PS5.lan', '6'),
    ('192.168.2.20', '00:11:32:00:00:20', 'DiskStation.lan', '4'),
]
SCAN_2G = [('CHT-Wi-Fi-8F21', 'C0:00:00:00:00:01', '6', '92'), ('TP-Link_5A10', 'C0:00:00:00:00:02', '6', '81'), ('ASUS_2G', 'C0:00:00:00:00:03', '1', '66'),
           ('Xiaomi_3F', 'C0:00:00:00:00:04', '6', '60'), ('MOD-2.4G', 'C0:00:00:00:00:05', '11', '44'), ('FET-家', 'C0:00:00:00:00:06', '6', '40'),
           ('D-Link', 'C0:00:00:00:00:07', '3', '35'), ('HP-Print-B2', 'C0:00:00:00:00:08', '6', '30'), ('TOTOLINK', 'C0:00:00:00:00:09', '11', '22')]
SCAN_5G = [('CHT-Wi-Fi-8F21_5G', 'C0:00:00:00:01:01', '36', '55'), ('ASUS_5G', 'C0:00:00:00:01:02', '157', '41'), ('Xiaomi_3F_5G', 'C0:00:00:00:01:03', '44', '30')]
WL_RSSI = {
    '7C:1E:52:00:00:A4': -78, 'A4:83:E7:00:00:21': -52, '3C:06:30:00:00:35': -61, '00:1A:2B:00:00:44': -70,
}


def rstats_js():
    """rstats 的 24 小時流量（speed_history），每 120 秒一筆，晚上比較高"""
    import math
    n = 720
    rx, tx = [], []
    now = time.time()
    for i in range(n):
        hour = ((now - (n - 1 - i) * 120) / 3600 + 8) % 24
        evening = math.exp(-((hour - 21.5) / 2.2) ** 2)
        night = 0.15 if 1 < hour < 7 else 1
        mbps = (12 + 210 * evening) * night + (math.sin(i * 1.7) + 1) * 15 * night
        rx.append(int(mbps * 1e6 / 8 * 120))
        tx.append(int(mbps * 0.08 * 1e6 / 8 * 120))
    return ("\nnetdev = 'WAN';\nspeed_history = {'WAN': {rx: [%s], tx: [%s]}};\n"
            "data_period = 120;\npoll_next = 120;\n") % (','.join(map(str, rx)), ','.join(map(str, tx)))


# ---------- 未來功能的模擬資料（docs/HANDOFF-UI.md 第 6 節） ----------
MOCK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock')
TIME_KEYS = {'ts', 'start', 'last_handshake_ts', 'cert_expiry_ts', 'published_ts', 'since_ts', 'last_ts', 'until_ts'}


def expand_mock(v, now, key=None):
    """模擬資料的小工具：
    - 時間欄位寫小數字＝相對現在的秒數（"ts": -600 是 10 分鐘前；憑證到期這類未來時間寫正數）
    - {"$gen": "wave", ...}＝產生一段序列，免得 JSON 裡塞幾百個數字"""
    import math
    import random
    if isinstance(v, dict):
        if '$gen' in v:
            rnd = random.Random(v.get('seed', 1))
            n, step = v.get('n', 96), v.get('step', 900)
            base, amp, peak, width = v.get('base', 10), v.get('amp', 0), v.get('peak_hour', 21), v.get('width', 2)
            noise, spikes, nulls = v.get('noise', 0), v.get('spikes', []), v.get('nulls', [])
            out = []
            for i in range(n):
                hour = ((now - (n - 1 - i) * step) / 3600 + 8) % 24
                x = base + amp * math.exp(-((hour - peak) / width) ** 2) + rnd.random() * noise
                for s in spikes:   # [起始索引, 結束索引, 數值]
                    if s[0] <= i <= s[1]:
                        x = s[2] + rnd.random() * noise
                out.append(None if any(a <= i <= b for a, b in nulls) else round(x, v.get('digits', 0)) if v.get('digits') else int(round(x)))
            return out
        return {k: expand_mock(x, now, k) for k, x in v.items()}
    if isinstance(v, list):
        return [expand_mock(x, now, key) for x in v]
    if key in TIME_KEYS and isinstance(v, (int, float)) and abs(v) < 1e9:
        return int(now + v)
    return v


def mock_api(q, scenario):
    """回傳 /tw_api.asp?q=... 的內容。scenario：normal（預設）、problem、empty（資料收集中）、none（現在的韌體＝沒有 API）"""
    if scenario == 'none':
        return ''
    now = time.time()
    names = []
    if scenario and scenario != 'normal':
        names.append('%s.%s.json' % (q, scenario))
    names.append('%s.json' % q)
    if scenario == 'empty' and not os.path.isfile(os.path.join(MOCK, names[0])):
        return json.dumps({'ok': True, 'ts': int(now), 'available': True, 'warming_up': True})
    for n in names:
        p = os.path.join(MOCK, n)
        if os.path.isfile(p):
            data = json.load(open(p, encoding='utf-8'))
            data = expand_mock(data, now)
            data.setdefault('ok', True)
            data.setdefault('ts', int(now))
            data.setdefault('available', True)
            data.setdefault('warming_up', False)
            return json.dumps(data, ensure_ascii=False)
    return json.dumps({'ok': True, 'ts': int(now), 'available': False, 'warming_up': False})


def load_js_functions():
    """從 web_ex.c 找出 httpd 會輸出的所有 JS 函式名稱，以及它回傳字串還是數字。"""
    names = {}
    try:
        src = open(WEB_EX, encoding='utf-8', errors='replace').read()
    except OSError:
        return names
    for m in re.finditer(r'"function ([a-z_0-9]+)\(\) \{ ?return ([^;]*);', src):
        names[m.group(1)] = "''" if "'" in m.group(2) else '0'
    # 其他原始檔（aidisk.c 等）輸出的函式：多半回傳陣列，數量類回傳 0
    srcdir = os.path.dirname(WEB_EX)
    for f in os.listdir(srcdir):
        if not f.endswith('.c'):
            continue
        text = open(os.path.join(srcdir, f), encoding='utf-8', errors='replace').read()
        for name in re.findall(r'function ([a-z_0-9]+)\(', text):
            if name not in names:
                numeric = re.search(r'(num|count|number|size|status|support|found|kilobytes)', name)
                names[name] = '0' if numeric else '[]'
    return names


JS_FUNCS = load_js_functions()
ALL_APPS = False


def js_functions_block():
    out = []
    for name, default in JS_FUNCS.items():
        v = FUNC_VALUES.get(name, default)
        if ALL_APPS and name.startswith('found_app_'):
            v = 1   # --all-apps：假裝韌體包含所有套件，檢查每個頁面都到得了
        out.append('function %s() { return %s; }' % (name, v))
    return '\n'.join(out) + '\n'


def load_dict(lang):
    d = {}
    files = [os.path.join(WWW, 'dict', 'EN.footer')]
    if lang != 'EN':
        files.append(os.path.join(WWW, 'dict', lang + '.dict'))
    for f in files:
        try:
            for line in open(f, encoding='utf-8'):
                line = line.rstrip('\n')
                if '=' in line and not line.startswith('['):
                    k, v = line.split('=', 1)
                    d[k] = v
        except OSError:
            pass
    d.update({'LANG_EN': 'English', 'LANG_TW': '繁體中文（台灣）', 'LANG_CN': '简体中文'})
    return d


def system_status_json():
    return ('{ lavg: "0.21 0.18 0.15", uptime: {days: 23, hours: 4, minutes: 12}, '
            'ram: {total: 524288, used: 190464, free: 333824, buffers: 8192, cached: 61440}, '
            'swap: {total: 0, used: 0, free: 0}, '
            'cpu: {busy: 0x2f0000, user: 0x100000, nice: 0x0, system: 0x150000, idle: 0xd00000, '
            'iowait: 0x0, irq: 0x10000, sirq: 0x80000, total: 0x1000000}, '
            'wifi2: {state: 1, guest: 0}, wifi5: {state: 1, guest: 0}, logmt: 0 }')


def call_hook(name, args):
    if name == 'nvram_get_x' or name == 'nvram_get':
        return NVRAM.get(args[-1], '')
    if name == 'nvram_char_to_ascii':
        return urllib.parse.quote(NVRAM.get(args[-1], ''), safe='')
    if name == 'nvram_match_x':
        return args[3] if NVRAM.get(args[1], '') == args[2] else ''
    if name == 'nvram_double_match_x':
        ok = NVRAM.get(args[1], '') == args[2] and NVRAM.get(args[4], '') == args[5]
        return args[6] if ok else ''
    if name == 'json_system_status':
        return system_status_json()
    if name == 'uptime':
        return 'Thu, 12 Nov 2026 21:40:35 +0800(23 days, 04:12:08)'
    if name in ('firmware_caps_hook', 'hardware_pins', 'login_state_hook', 'wanlink', 'lanlink',
                'disk_pool_mapping_info', 'available_disk_names_and_sizes', 'get_usb_ports_info',
                'get_ext_ports_info'):
        return js_functions_block()
    if name == 'netdev':
        # 計數器隨時間增加，讓前端算得出即時速率（約下行 38 Mbps、上行 4 Mbps）
        t = time.time()
        rx = 0x180000000 + int(t * 4_750_000) % 0x100000000
        tx = 0x22000000 + int(t * 500_000) % 0x100000000
        return ("\nnetdevs = {\n 'WAN':{rx:0x%x,tx:0x%x},\n"
                " 'LAN':{rx:0x30000000,tx:0x170000000},\n 'WLAN2':{rx:0x8000000,tx:0x40000000},\n"
                " 'WLAN5':{rx:0x20000000,tx:0x120000000}\n};\n") % (rx, tx)
    if name == 'get_nvram_list' and args[-1] == 'ManualDHCPList':
        # 與 httpd 相同：欄位依 variables.c 的順序（MAC 不含冒號、IP、名稱），不附索引
        return ('["3C22FB000010","192.168.2.10","書房桌機"],'
                '["7C1E520000A4","192.168.2.31","客廳電視"],'
                '["001A2B000044","192.168.2.44","掃地機器人"]')
    if name == 'get_nvram_list' and args[-1] == 'VSList':
        return '["3478:3480","192.168.2.52","","BOTH","","","PS5"],["5001","192.168.2.20","","TCP","","","NAS 遠端存取"]'
    if name == 'get_nvram_list' and 'WGSPeerList' in args:
        return '["我的手機","Hj8kZ3T0aB9cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV0wX=","*","2"],["公司筆電","Qw1eR2tY3uI4oP5aS6dF7gH8jK9lZ0xC1vB2nM3qW4=","*","3"]'
    if name == 'kuroshio_status':
        return 'function kuroshio_status() { return 2;}\n'
    if name == 'nf_values':
        return "function nf_conntrack_count() { return '3412';}\n"
    if name == 'get_static_client':
        return ', '.join('["%s", "%s", "%s", "%s", "0", "0"]' % (c[0], c[1], c[2], c[3]) for c in STATIC_CLIENTS)
    if name == 'wl_auth_list':
        return ', '.join('"%s":%d' % (mac, rssi) for mac, rssi in WL_RSSI.items())
    if name == 'get_nvram_list' and args[-1] == 'MFList':
        return '["5CE50C000077","00002359","1111111"]'
    if name in ('wl_scan_2g', 'wl_scan_5g'):
        import urllib.parse as up
        aps = SCAN_2G if name == 'wl_scan_2g' else SCAN_5G
        return '[' + ', '.join('["%s", "%s", "%s", "%s"]' % (up.quote(a[0], safe=''), a[1], a[2], a[3]) for a in aps) + ']'
    if name == 'bandwidth':
        if args and args[0] == 'history':
            return "\nnetdev = 'WAN';\nnetdevs = ['WAN'];\ndaily_history = [];\nmonthly_history = [];\npoll_next = 120;\n"
        return rstats_js()
    if name == 'get_static_ccount':
        return '0'
    if name == 'shown_language_option':
        return '<option value="TW" selected>繁體中文（台灣）</option><option value="EN">English</option>'
    return ''


ASP_BLOCK = re.compile(r'<%(.*?)%>', re.S)
ASP_CALL = re.compile(r'([A-Za-z_][A-Za-z_0-9]*)\s*\((.*?)\)\s*;')
ASP_ARG = re.compile(r'"((?:[^"\\]|\\.)*)"')
DICT_TOKEN = re.compile(r'<#([A-Za-z0-9_]+)#>')


def render(text, dct):
    def block(m):
        out = []
        for c in ASP_CALL.finditer(m.group(1)):
            out.append(call_hook(c.group(1), ASP_ARG.findall(c.group(2))))
        return ''.join(out)
    text = ASP_BLOCK.sub(block, text)
    text = DICT_TOKEN.sub(lambda m: dct.get(m.group(1), m.group(1)), text)
    text = text.replace('ZVMODELVZ', 'NEWIFI3').replace('ZVCOPYRVZ', '2026 padavan-tw')
    return text


class Handler(http.server.SimpleHTTPRequestHandler):
    lang = 'TW'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEBUI, **kw)

    def do_POST(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        if path in ('', '/'):
            path = '/index.asp'
        if path == '/tw_api.asp':
            qv = urllib.parse.parse_qs(url.query)
            body = mock_api(qv.get('q', [''])[0], qv.get('scenario', [''])[0])
            self._send(body.encode('utf-8'), 'text/html; charset=utf-8')
            return
        if path.startswith('/update.cgi') or path.endswith('.cgi'):
            self._send(b'', 'text/plain')
            return
        if path == '/console_response.asp':
            self._send('介面 ppp0（目前 MTU 1480），測試範圍 1280～1492：\n  168.95.1.1：1492\n  8.8.8.8：1492\n  1.1.1.1：1492\n建議 MTU：1492\nMTU=1492\n'.encode('utf-8'), 'text/plain; charset=utf-8')
            return
        local = os.path.join(WEBUI, path.lstrip('/'))
        if os.path.isfile(local) and os.path.splitext(local)[1] in ('.asp', '.js', '.htm', '.html'):
            text = open(local, encoding='utf-8', errors='replace').read()
            text = render(text, load_dict(self.lang))
            if local.endswith('.asp') and INJECT_AFTER in text:
                text = text.replace(INJECT_AFTER, INJECT_AFTER + INJECT, 1)
            ctype = 'application/javascript' if local.endswith('.js') else 'text/html; charset=utf-8'
            self._send(text.encode('utf-8'), ctype)
            return
        super().do_GET()

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8088)
    ap.add_argument('--lang', default='TW')
    ap.add_argument('--all-apps', action='store_true', help='假裝韌體包含所有套件（found_app_* 都是 1）')
    args = ap.parse_args()
    global ALL_APPS
    ALL_APPS = args.all_apps
    Handler.lang = args.lang
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', args.port), Handler) as srv:
        print('padavan-tw 後台預覽：http://127.0.0.1:%d/' % args.port)
        srv.serve_forever()


if __name__ == '__main__':
    main()
