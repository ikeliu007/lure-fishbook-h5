#!/bin/bash
# 隧道守护脚本 - 检查 VPS 的 18899 是否可用，不通则重建隧道

LOG=/tmp/tunnel-watchdog.log
VPS=root@150.109.193.239
KEY=/root/.ssh/id_rsa
LOCAL_PORT=8899

check_tunnel() {
  sshpass -p 'Sd2028065' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
    $VPS "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18899 --max-time 5" 2>/dev/null
}

rebuild_tunnel() {
  echo "$(date): 隧道不通，重建..." >> $LOG
  # 杀旧进程
  pkill -f "ssh.*18899.*$VPS\|ssh.*$VPS.*18899" 2>/dev/null
  sleep 2
  # 重建
  nohup bash /root/.openclaw/workspace/lure-fishbook-h5/tunnel-keep.sh >> $LOG 2>&1 &
  disown
  echo "$(date): 重建命令已发出" >> $LOG
}

STATUS=$(check_tunnel)
if [ "$STATUS" != "200" ]; then
  rebuild_tunnel
else
  echo "$(date): 隧道正常 ✅" >> $LOG
fi
