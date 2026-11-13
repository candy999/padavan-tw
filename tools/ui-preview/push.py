#!/usr/bin/env python3
"""把後台檔案即時推到路由器測試（不用重刷韌體；docs/HANDOFF-UI.md 2.2）

路由器的 /www 是唯讀的 squashfs：第一次執行會把它複製到 /tmp/www-dev 再 bind mount 回 /www。
.asp 會照 www/Makefile 注入 viewport 與 tw.css（與安裝時相同）。路由器重開機後就恢復原狀。

用法：
    python3 tools/ui-preview/push.py                  # 推送 git 有變更或新增的 www 檔案
    python3 tools/ui-preview/push.py tw_ui.js index.asp
    python3 tools/ui-preview/push.py --host admin@192.168.2.1 --all-tw
需要 ssh 金鑰登入（ssh admin@192.168.2.1 不用輸入密碼）。
"""
import argparse
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WEBUI = os.path.join(ROOT, 'trunk', 'user', 'www', 'n56u_ribbon_fixed')
REL = 'trunk/user/www/n56u_ribbon_fixed/'
INJECT_AFTER = '<link rel="stylesheet" type="text/css" href="/bootstrap/css/main.css">'
INJECT = ('\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
          '\n<link rel="stylesheet" type="text/css" href="/bootstrap/css/tw.css">')


def changed_files():
    out = subprocess.run(['git', '-C', ROOT, 'status', '--porcelain', '--untracked-files=all', '--', REL],
                         capture_output=True, text=True, encoding='utf-8', check=True).stdout
    files = []
    for line in out.splitlines():
        path = line[3:].strip().strip('"')
        if line[:2].strip() != 'D' and path.startswith(REL):
            files.append(path[len(REL):])
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='*', help='相對於 n56u_ribbon_fixed 的路徑')
    ap.add_argument('--host', default='admin@192.168.2.1')
    ap.add_argument('--all-tw', action='store_true', help='推送所有 tw_* 與共用檔案')
    a = ap.parse_args()
    files = a.files or changed_files()
    if a.all_tw:
        files += [f for f in os.listdir(WEBUI) if f.startswith('tw_')] + ['index.asp', 'state.js', 'bootstrap/css/tw.css', 'Main_NetMap.asp']
    files = sorted(set(files))
    if not files:
        print('沒有要推送的檔案')
        return
    ssh = ['ssh', '-o', 'BatchMode=yes', a.host]
    # httpd 啟動時已經 chdir 到原本的 /www，掛上副本後要重啟 httpd 才看得到
    subprocess.run(ssh + ['mount | grep -q " /www " || { rm -rf /tmp/www-dev && cp -a /www /tmp/www-dev && mount -o bind /tmp/www-dev /www && '
                          'killall httpd; sleep 1; httpd; echo "已把 /www 換成記憶體副本並重啟 httpd"; }'], check=True)
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            src = os.path.join(WEBUI, f)
            if not os.path.isfile(src):
                print('略過（不存在）：' + f)
                continue
            data = open(src, 'rb').read()
            if f.endswith('.asp'):
                text = data.decode('utf-8')
                if INJECT_AFTER in text and 'tw.css' not in text:
                    text = text.replace(INJECT_AFTER, INJECT_AFTER + INJECT, 1)
                data = text.encode('utf-8')
            # 用 ssh cat 寫入：路由器的 dropbear 不一定有 sftp-server
            d = os.path.dirname(f)
            cmd = ('mkdir -p /www/%s && ' % d if d else '') + 'cat > /www/%s' % f
            subprocess.run(ssh + [cmd], input=data, check=True)
            print('已推送：' + f)
    print('完成。瀏覽器強制重新整理即可；改了字典要重啟 httpd。')


if __name__ == '__main__':
    sys.exit(main())
