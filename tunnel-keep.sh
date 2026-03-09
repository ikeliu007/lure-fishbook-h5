#!/bin/bash
VPS=root@150.109.193.239
while true; do
  echo "$(date): 清理VPS旧端口..." >> /tmp/tunnel.log
  sshpass -p 'Sd2028065' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
    $VPS "fuser -k 18899/tcp 2>/dev/null; true"
  sleep 2
  echo "$(date): 建立隧道..." >> /tmp/tunnel.log
  ssh -i /root/.ssh/id_rsa \
      -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=10 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 18899:127.0.0.1:8899 \
      -N $VPS
  echo "$(date): 断开重连" >> /tmp/tunnel.log
  sleep 3
done
