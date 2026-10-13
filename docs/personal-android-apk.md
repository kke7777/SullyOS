# 咲咲的安卓安装包

源版本：`ea1c8703a0451129c6ce5d2b13df0e9e19e885bf`。

应用名称：SullyOS·糯米机。独立包名：`com.kke7777.nuomi`，可与原作者的安装包并存。
网页代码随 APK 打包，包含当前首页布局、图标名称、单独的日程页和聊天提示词。
安卓状态栏隐藏，系统时间照常提供给应用；系统导航和键盘保留。

## 构建

安装 Node、pnpm、JDK 17、Android SDK 34 / Build Tools 34.0.0，设置 `ANDROID_HOME`。

```sh
pnpm install --frozen-lockfile
pnpm build:android
```

默认生成已签名的开发安装包。正式版需提供以下环境变量，再运行相同命令：

- `NUOMI_KEYSTORE`：个人签名文件的绝对路径。
- `NUOMI_STORE_PASSWORD`：签名文件密码。
- `NUOMI_KEY_ALIAS`：密钥名称。
- `NUOMI_KEY_PASSWORD`：密钥密码。

后续覆盖升级须沿用相同包名和签名密钥，并递增 `android/app/build.gradle` 的 `versionCode`。
不要将签名文件或密码提交到仓库。独立 APK 不使用原作者的 APK 更新地址。

## 数据与功能范围

网页版、原版 APK 和这个独立 APK 各自保存本机数据。请在原应用的「备份与恢复」导出，
再在本 APK 导入；浏览器记录不会自动迁移。对话、语音等联网功能继续使用用户自己填写的 API。

仓库不含原作者 Windows 本地包装工程里的 `AmsgUnifiedPush`、`ApkInstaller` 原生插件。
因此本版本关闭这些插件对应的自动初始化和原作者更新入口。关闭应用后的远程系统推送未接通，
后续版本可补充原生插件和推送服务。应用内的主动消息、云端任务及其配置仍保留，
但不能把应用内收取等同于关闭应用后收到系统通知。

构建与签名检查不等同于安卓真机验收；录音、键盘、文件分享和厂商系统的后台行为需在手机上确认。
