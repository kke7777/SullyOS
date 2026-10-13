# 咲咲的安卓安装包

应用名称：SullyOS·糯米机。独立包名：`com.kke7777.nuomi`，可与原作者的安装包并存。
保留当前首页布局、图标名称、独立日程页和聊天提示词；安卓状态栏隐藏，系统时间照常提供给应用。

## 原生推送

Android 原生插件 `AmsgUnifiedPush` 使用官方 UnifiedPush connector 3.3.5，支持加密 Web Push。
本 APK 不接入 Firebase / FCM，不需要 google-services.json 或 Firebase 项目。
官方连接器负责分发服务选择、订阅、发送者校验与解密；糯米机插件负责本机收件箱、分片重组、
系统通知、通知点击及与网页聊天数据库的交接。分片协议与仓库当前 `@rei-standard/amsg-shared` 一致。

手机上还需要一个 UnifiedPush 分发服务。按现有代码默认引导，使用 ntfy 的无 Firebase 版本。
它维持服务器连接，糯米机的 receiver/service 接收消息，因此不需要一直打开糯米机界面。
这不能绕过安卓的「强行停止」或厂商的后台限制；系统实际送达需要手机和用户 Worker 联调。

1. 安装并打开 ntfy 的无 Firebase 版本，确认其推送服务器在手机网络上可访问。
2. 允许 ntfy 后台运行，并允许糯米机显示通知。
3. 在糯米机的主动消息设置中填写并验证自己的 Worker 地址，再开启通知与推送订阅。
4. 在应用内发送测试通知，再回桌面或锁屏测试；点击通知应打开对应角色聊天。

消息先保存到本机 SQLite，再交给现有聊天管线。网页入库成功才确认删除本机待处理行，失败则保留，
启动或回前台时重试。长消息支持乱序、重复分片与 UTF-8 重组；普通正文、情绪、后台任务结果和失败事件
按各自管线处理。订阅地址变动时重新登记到当前用户 Worker。不同通知各自携带正确的点击目标。

## 构建与升级

安装 Node、pnpm、JDK 17、Android SDK 34 / Build Tools 34.0.0，设置 `ANDROID_HOME`。

```sh
pnpm install --frozen-lockfile
pnpm build:android
```

默认生成已签名开发包。正式版提供环境变量后运行相同命令：

- `NUOMI_KEYSTORE`：个人签名文件的绝对路径。
- `NUOMI_STORE_PASSWORD`：签名文件密码。
- `NUOMI_KEY_ALIAS`：密钥名称。
- `NUOMI_KEY_PASSWORD`：密钥密码。

本次提示词精简版本的 Android versionCode 为 3，沿用原包的包名与签名，可以覆盖安装。
后续覆盖升级须使用同一签名并递增 versionCode。签名文件和密码不提交到仓库。
本 APK 没有原作者的 ApkInstaller 插件，因此不接入原作者 APK 自动更新地址；更新包可手动覆盖安装。

本版替换主动消息 2.0 的自主联系说明和排程限制文案，保留用户名、剩余额度、间隔、
任务名额及循环／必发开关的动态生成。云端共用文案的 Worker 版本为 `2026-10-13.1`；
覆盖安装后，在主动消息 2.0 设置里复制新版 Worker 代码，更新原有 Cloudflare Worker。
本地聊天使用安装包内的新文案；即时对话和到点生成使用更新后的云端文案。

网页版、原版 APK 与此独立 APK 各自保存数据。首次迁移在原应用「备份与恢复」导出，
再在本 APK 导入。联网对话和语音继续使用用户自行填写的 API。

构建与自动化模拟测试不等同于真机端到端验收。录音、键盘、分享和实际后台推送需在手机上确认。

参考：https://unifiedpush.org/kdoc/connector/ 、https://unifiedpush.org/developers/spec/android/
