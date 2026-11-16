# 本地工具

所有工具通过 `src/paths.js` 定位项目。默认资源/输出路径以及 CLI 中的项目相对路径都从项目根解析；绝对路径保持不变，因此可以在任意工作目录调用，不要求先 `cd private_server`。

设备读写工具要求通过 `FROG_DEVICE` 指定 adb 序列号，不在源码中固定个人设备。`--check` 仅检查参数和本地输入，不执行设备操作。

| 目录 | 用途 |
| --- | --- |
| `android/` | APK 本地化、原生登录 Java 编译和补丁注入 |
| `android/patches/` | 序列化后追加到客户端主脚本的补丁，不直接运行 |
| `official/` | 设备备份、官方响应捕获和本地资源整理 |
| `qa/` | WebSocket 烟雾检查和可选客户端 QA 指令队列 |
| `resources/` | EAB 元数据解码、复制后主脚本补丁 |

工具的 `--check` 只检查输入和路径，不编译、不写 APK/设备、不安装官方捕获 hook；`smoke_test.js` 是实际网络检查，不提供该模式。

```powershell
node C:/path/private_server/tools/android/build_local_client.js exports/fresh-apk/decoded --check
node C:/path/private_server/tools/android/build_native_login.js exports/fresh-apk/decoded --check
node C:/path/private_server/tools/official/prepare_official_capture.js --check
node C:/path/private_server/tools/official/official_assets.js exports/capture-root --check
node C:/path/private_server/tools/qa/device_probe.js exports/actions.json --check
```

APK 本地化要求原始 APK 的新解包目录；检查现有已改包目录会输出 `originalPackage:false`，仅说明资源路径可读，不表示允许重复改包。原生登录构建可以重跑，统一从脚本相邻的 `NativeLoginActivity.java` 编译，补丁 require 使用 `android/patches/` 的实际路径。只有设置 `FROG_QA=1` 时追加 QA hook。

可覆盖本地输入路径：`FROG_HOTFIX_SOURCE`、`FROG_ASSETS`、`FROG_ANDROID_TOOLS`、`FROG_NATIVE_BUILD`、`FROG_CAPTURE_ROOT`。官方设备命令要求 `FROG_DEVICE`，可用 `FROG_ADB` 指定 adb。采集工具在导入为模块或使用 `--check` 时不要求连接设备；真正采集/写入之前才校验设备配置。

`exports/` 中的备份、凭据、编译依赖、APK 和 QA 结果均是本地私有产物，不提交源码。`resources` 工具要求输入/输出文件不同，避免覆盖原始资源。
