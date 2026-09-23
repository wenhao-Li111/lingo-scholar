# 开发与本地运行

## 安卓轻量安装版构建

发布新安装版时递增 AndroidManifest.xml 的 versionCode 与 versionName，运行构建脚本。脚本生成对应 APK、SHA256SUMS.txt 和 latest.json；将三者一并发布到 `site/downloads/`，Pages 上线后应用内检查即可发现新版。签名私钥不得放入 GitHub，CI 仅构建未签名检查产物；不是每次 GitHub Release 都自动生成签名 APK。

## 正式 Release 自动部署

推送经过审核的 `vX.Y.Z` 注释标签，release.yml 先测试和构建，再创建正式 GitHub Release；也可在 GitHub 手动发布对应正式 Release。服务器的 root-owned 控制器每约五分钟拉取最新正式 Release，不使用 GitHub SSH 私钥或访问令牌。仓库发布权因此等同网站部署权，请保护账号与发布权限。

服务器安装：审核 `deploy/` 下的 release-poller.mjs、两个 systemd 单元、release-working-directory.conf 和 install-release-poller.sh，上传到同一临时目录，以 sudo 运行安装脚本。它保留 `/opt/lingo-scholar` 的数据、内容和旧运行文件；新版本位于 `/opt/lingo-releases`，`/opt/lingo-current` 指向当前代码，应用 WorkingDirectory 通过 systemd drop-in 切换。npm 构建以独立低权限 lingobuild 用户执行，切换前收回代码目录写权限。不会在 root 身份下执行仓库 npm 脚本。

运行状态：`sudo cat /var/lib/lingo-deploy/status.json`；日志：`sudo journalctl -u lingo-release-poller.service`。暂停：`sudo systemctl stop lingo-release-poller.timer`。失败版本 ID 会记住，避免不断重试；请发布修正版本。保留版本不自动清理，定期检查磁盘。健康失败只自动回退代码，不恢复数据库，以免丢失新写入；破坏性数据库迁移必须另行维护，不能依赖自动回滚。

控制器安装在 `/usr/local/lib/lingo-deploy`，不会随公开仓库版本自行替换。修改控制器必须重新审核并由管理员安装。

源码在 `apps/android`。安装 JDK 17 与 Android SDK 的 `platforms;android-35`、`build-tools;35.0.0`，设置 `JAVA_HOME` 和 `ANDROID_HOME` 后运行 `node scripts/build-android.mjs`。无需 Gradle 或第三方 Java 依赖。

输出为 `dist/android/lingo-scholar-1.1.1.apk` 与 SHA-256 校验文件。默认首次在 `data/deploy-private/android-signing` 创建签名密钥和密码；该目录必须保持私密并异地备份。也可用 `LINGO_ANDROID_KEY_DIR` 指定受限目录。之后使用同一密钥才能覆盖升级，切勿将密钥、密码或签名文件提交 Git。

CI 只运行 `node scripts/build-android.mjs --unsigned` 检查构建，不持有发布密钥；CI 的 unsigned artifact 不能直接安装。对外下载只提供维护者本地签名并验证的 APK。它是 Custom Tabs 在线伴随应用，不是 TWA、WebView 内核或离线课程引擎。

一个以「词在句中」为中心的自托管 IELTS 学习网站。每天背一点，在阅读和听力中认出它，再和熟悉的朋友一起坚持。

React + TypeScript · Express · SQLite · 响应式网页 / PWA

## 可以做什么

- 每日随机 20 词；四选一词义、看义拼写、听音默写。
- 释义按词性显示，配音标；答题后高亮例句中的单词，并显示中文译文。
- 云端保存词库进度、练习位置、阅读位置、听力播放位置、笔记及分类收藏。
- 邮箱 + 密码注册登录，无邮件服务也可运行；恢复码用于密码重置。
- 通过完整邮箱发送好友申请，双方确认后查看周榜和累计星星榜。
- 20 题星星挑战：服务器判分、重复请求幂等、跨设备继续、每天最多 5 组。
- 站内音频、原文/译文显示、时间轴字幕、PDF canvas 阅读器。
- 适配桌面与移动浏览器，支持添加到主屏幕；**不是原生 Android / iOS 应用**。

## 代码公开，私人资料不公开

本仓库不包含个人账号、数据库、服务器密钥、完整商业教材 PDF、剑桥听力音频或未获再分发许可的词典。
私人部署可导入自己有权使用的资料；「网上能下载」不等于「可以开源再分发」。
公开演示使用本仓库编写的小型例句词库，不代表完整备考资料数量。原部署资料来源参考见 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 本地启动

需要 Node.js 22.16+（推荐 24 LTS），npm，现代浏览器。

```sh
npm ci
node scripts/demo-content.mjs
npm run setup
npm run build:web
npm start
```

打开 `http://127.0.0.1:5173`，用初始化输出的一次性令牌创建管理员。没有默认密码。
演示数据脚本不会覆盖已有词库。完整版课程测试需要私有课程文件；公开版可先运行 `npm run test:unit`。

如需开放邮箱直接注册，启动前设置 `LINGO_PUBLIC_SIGNUP=1`。Windows PowerShell：

```powershell
$env:LINGO_PUBLIC_SIGNUP='1'
npm start
```

开启公开注册之后，管理员初始化入口为 `/#/bootstrap`，仍需服务器生成的一次性令牌。普通注册永远不获得管理员权限。

## 星星规则

| 一组 20 题正确率 | 星星变化 |
|---|---:|
| 95–100% | +10 |
| 85–94% | +7 |
| 70–84% | +4 |
| 60–69% | +1 |
| 低于 60% | −2，总数不低于 0 |

只计算第一次答案，每日最多 5 组；当天已抽过的词不重复抽取。退出、断网、普通自由练习不扣星。
日期和周榜统一采用北京时间，周一开启新统计周期，累计星星不重置。周榜是净变化，可能出现负数。
星星与旧版课程积分是两个独立系统，旧版复习规则不会扣好友星星。
这是学习激励，不是考试监考系统：用户仍可借助词典或其他途径查答案。

## 部署与安全

- [Ubuntu 部署、HTTPS、备份及容量](DEPLOYMENT.md)
- [账号、同步和隐私边界](SECURITY.md)
- `deploy/` 提供 systemd / Nginx 模板，不含实际凭据。
- GitHub Pages 只能托管静态介绍页，不能承载本项目 Node.js 后端和 SQLite。

邮箱不验证即注册意味着邮箱仅是账号标识，不能证明现实身份。添加好友请线下核实。
忘记密码需要恢复码，遗失恢复码不能通过邮箱自动找回。
这是面向小型学习社区的自托管项目，不宣称无限并发或生产级反作弊。

## 目录

```text
apps/web/          学习界面与 PWA
apps/server/       鉴权、学习状态、好友、星星和媒体接口
packages/domain/   课程与复习规则
packages/content/  课程格式与校验
services/voice/    可选本地语音适配（Windows SAPI 不适用于 Ubuntu）
scripts/           初始化、构建、演示数据与备份
deploy/            单机部署模板
tests/             单元、集成与浏览器测试
```

维护说明：`npm run build:web` 构建前端；`npx tsc --noEmit -p apps/web/tsconfig.json` 检查类型。浏览器回归脚本需要本机 Chrome。

## 许可证

本仓库原创代码与演示内容采用 MIT。第三方依赖遵循各自许可证，外部学习资料不自动适用本仓库许可证。详见 [LICENSE](../LICENSE)。
