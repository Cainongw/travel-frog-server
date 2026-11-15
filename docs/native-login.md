# Android 原生登录与自动恢复

## 原版渠道登录的边界

对本机提供的热更新客户端静态读取可见，`EjoyChannel` 调用 `ALISDK.LoginSDK.instance().Login(...)`，取得 `pinfo` 和 `game_token`；失败码由渠道 SDK 处理。该界面与阿里身份服务绑定，不能把私服用户名/密码直接当作原版 SDK 凭据。此结论来自 `main.min.js` 的 `EjoyChannel` 源码片段（UTF-16 起点约 22902），不表示已经复原该 SDK 的完整认证协议。

本项目保留原游戏主体，另外增加 Android Activity 的 `EditText`、密码输入框与 `Button`。它替换上一版在 Egret 游戏画布上绘制的登录页；不冒充阿里账号登录。

## 流程

1. Launcher 为 `com.cainong.travelfrog.NativeLoginActivity`，首次打开输入游戏账号和密码。
2. HTTPS `/api/game/login` 返回 24 小时访问令牌与 30 天不活跃过期的续期凭据。仅后者保存在应用私有 SharedPreferences，不保存密码。
3. 冷启动有续期凭据时请求 `/api/game/refresh`，成功后直接进入原 MainActivity；网络失败保留凭据，服务明确拒绝时要求重新登录。
4. Android 将本次访问令牌写入应用内部 `files/jsdata/frog-native-session.json`。Egret 的既有 `core.PlatformFile.getPath/readFile` 桥读取它并完成原游戏 WebSocket 握手，画布内不再显示另一个登录表单。
5. 管理员重置密码、禁用、撤销会话或删除登录名后，后端拒绝旧访问/续期令牌。多个登录名共享存档时，权限按登录名隔离。

`getPath` 与 `readFile` 的桥调用来自客户端源码；原采集脚本写出的 `frog-official-export.json` 位于 `files/jsdata/`，为该路径映射提供了设备证据。新的 Activity 和凭据格式是本项目实现，不是原版渠道代码。

切换账号可以打开 `dogfrog://account`；设备测试命令：

```powershell
adb shell am start -a android.intent.action.VIEW -d dogfrog://account com.cainong.travelfrog.dog
```

## 可重复构建

`android/NativeLoginActivity.java` 为源码，`build_native_login.js` 调用 javac 与 D8 生成新增的 `classes4.dex`，修改 Launcher，并追加 `native_login_patch.js`。最低 Android 5.0，versionCode 22；原始三个 DEX 不重编译。

本机构建依赖位于忽略的 `exports/android-tools/`：

- Android API 编译 stub：`https://repo.maven.apache.org/maven2/com/google/android/android/4.1.1.4/android-4.1.1.4.jar`
- 平台自带 org.json 的编译依赖：`https://repo.maven.apache.org/maven2/org/json/json/20090211/json-20090211.jar`（不打入 DEX）
- D8/R8：`https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.3.37/r8-8.3.37.jar`

依赖文件分别命名 `android.jar`、`json.jar`、`r8.jar`。生成并构建 APK 后，用 `exports/dog-apk-build/dog-release.p12` 与本地保存的密码签名，勿替换签名或提交私钥。

验证包括后端续期/撤销/共享存档隔离测试、原生会话桥测试、签名与 ZIP 对齐检查、adb 安装和原生表单可见性。公网 HTTPS 登录、WSS 握手和经管理容器转发的 WSS 均验证通过；首次在手机输入密码后完整进入游戏、再次冷启动的实测仍需用户完成。
