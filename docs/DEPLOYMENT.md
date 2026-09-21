# Ubuntu 24.04 自托管

## 拓扑

浏览器 → HTTPS / Nginx → 127.0.0.1:5173 / Node.js → 本机 SQLite + 共享媒体目录。
GitHub Pages 可单独放项目介绍和入口，完整应用放在同源 HTTPS 站点，避免手机浏览器拦截跨站会话。

## 安装顺序

1. 安装 Node.js 22.16+（推荐 Node 24 LTS）、Nginx 和 python3-venv；放行 80/443，SSH 保持原有限制。
2. 代码放 `/opt/lingo-scholar`，使用专用低权限 `lingo` 用户。私有资料单独传输，禁止把本地旧数据库打包上传。
3. 开发机 `npm ci && npm run build:web`，服务器安装生产依赖 `npm ci --omit=dev --ignore-scripts`。
4. 将 `deploy/production.env.example` 复制为 `/etc/lingo-scholar.env`，权限 600，按需修改账号上限。不要直接暴露 5173。
5. 创建可写的 `data/` 与 `LingoScholar/`，设置归属 `lingo`，代码本身只读。安装 `lingo-scholar.service`，执行 `systemctl daemon-reload`。
6. 取得有效证书后，用公网 IP 替换 `deploy/nginx.conf.template` 的 `SERVER_IP`。执行 `nginx -t` 后 reload。
7. 启动应用；使用服务器一次性令牌创建管理员；普通用户可以直接邮箱注册。

不要覆盖一台机器上已有的站点或服务。检查现有 Nginx 配置、监听端口和部署目录后再安装。

## 不买域名的 HTTPS

Let's Encrypt 已支持短期公网 IP 证书，需较新的 Certbot（至少 5.4）。官方说明：
[IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、[Certbot instructions](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。

```sh
sudo python3 -m venv /opt/lingo-certbot
sudo /opt/lingo-certbot/bin/pip install certbot
sudo /opt/lingo-certbot/bin/certbot certonly --webroot \
  --webroot-path /var/www/html --preferred-profile shortlived --ip-address YOUR_PUBLIC_IP
```

先在测试 CA 验证挑战流程，再申请正式证书。配置 `lingo-cert-renew.timer` 每天检查两次，并保持 HTTP-01 验证目录在 80 端口可达。IP 证书有效期短，不能只申请一次后不管。

## 备份

```sh
sudo systemctl enable --now lingo-backup.timer lingo-cert-renew.timer
sudo systemctl start lingo-backup.service
sudo systemctl list-timers
```

`scripts/cloud-backup.mjs` 通过 SQLite VACUUM INTO 产生一致性快照并检查完整性，不将实时数据库和 WAL 分开复制。每天 04:15（服务器时区）备份；不自动删除历史备份，需监控磁盘和制定保留政策。

恢复必须先停止应用，保留当前库和 WAL，再从完整快照恢复。请在备用目录先验证，不能覆盖正在写入的数据库。

## 容量不是按注册人数简单计算

- 媒体只保存一份，不会为每个账号复制 PDF/音频。
- 账号资料较小，长期增长来自学习日志、答题记录、收藏和备份。
- 2 核 / 4GB 适合作为小圈子起点；并发播放的瓶颈通常是套餐带宽和流量，不是用户表。
- 粗略上限应按 `可用出口带宽 ÷ 单路音频码率` 估算，还要留请求、TLS 和波动余量。
- 默认 1000 注册额度只是保护配置；开放给更多人前，用真实数据检查 CPU、RSS、P95 接口时延、磁盘和出网账单。
- 不在这种机器上后台跑大模型识别。规模增长可先把媒体迁对象存储/CDN，再评估独立数据库。

## 手机

HTTPS 页面有 viewport、安全区和触控适配。iPhone Safari、Android Chrome 可添加到主屏幕。公开测试包含 Chromium 320/375/390/430/768/1280 宽度和触控模拟，不等于真机 Safari 测试；系统语音发音取决于设备安装的语言包。
