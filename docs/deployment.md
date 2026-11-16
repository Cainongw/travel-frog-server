# 狗狗特供版、Docker 和 k8s 部署

## 服务

本轮全功能开发保留快照 #3 和完整库备份。服务端和管理端均已升级为 **0.12.0**，两个 Deployment 各 1/1 Ready；原生玩法的逐项验收仍在继续，进度以 [replication-roadmap.md](replication-roadmap.md) 为准。

Docker Desktop引擎不可用时，可用 `deploy/build_overlay.py` 基于已验证且依赖锁一致的Docker-save镜像生成标准OCI包，再由master的 `ctr images import/push` 发布。脚本已支持层级 `src/**` 服务端与管理台静态文件两种模式，清理旧扁平JS和旧UI，不包含工具、测试、个人资源或凭据。依赖改变时需重建运行时镜像，正常环境优先使用Dockerfile。

`Dockerfile` 提供两个构建目标：`server` 为 Node.js 24 游戏/API 服务，`management` 为独立 Nginx/Svelte 管理端。两个镜像均不包含游戏素材、数据库、管理密钥或 APK。`deploy/k8s.yaml` 在 `travel-frog` 命名空间创建两个 Deployment 和 Service；只有游戏服务挂载 Longhorn PVC，不创建 Ingress。SQLite 使用单副本和 Recreate 更新；数据库与素材都放在 `/data`，需另外备份持久卷。

以下是从仓库根目录复现0.12镜像的命令；执行构建/推送不会自动更新Deployment：

```powershell
docker build --target server -t harbor.k8s.lan/library/travel-frog-server:0.12.0 .
docker build --target management -t harbor.k8s.lan/library/travel-frog-admin:0.12.0 .
docker push harbor.k8s.lan/library/travel-frog-server:0.12.0
docker push harbor.k8s.lan/library/travel-frog-admin:0.12.0
```

实际实例已使用本机现有 Harbor 凭据；私有 registry 应另行配置专用 imagePullSecret。示例镜像放在现有公开 `library` 项目，仅含源码和运行时。

首次启动前，将一致性备份的 `travel-frog.sqlite` 和资源目录 `assets/` 放进 PVC，并设置 UID/GID 为 1000。已有快照、管理记录和原始采集随数据库保留。`/auth`、管理 API、游戏 HTTP 登录和 WebSocket 均共用端口 8080。

2026-11-16 实例已部署：namespace `travel-frog`，Service `travel-frog`，ClusterIP `10.103.166.246:8080`，PVC `travel-frog-data`（5Gi）。镜像已推送 Harbor；Docker Desktop 代理对内网推送返回 EOF，因此使用 master 上的 containerd 导入相同镜像并推送，未修改全局代理或 TLS 校验。原始镜像 manifest 摘要为 `sha256:ff7e14b5e8fa493801789032d036ac8f884c96941e4707db9e836491555635ee`。

迁移时菜农有 207 张图片记录、1749 草、2 券，共 2 个快照（含迁移前快照）。集群内已验证健康检查、管理端未登录拒绝、游戏密码登录、WebSocket 登录后读取菜农角色、SQLite 完整性。电脑上没有运行中的旧服务器；本地数据库保留为迁移备份，不与集群实时双向同步。

0.12 发布记录：服务端摘要 `sha256:035c1a81f9e4912886460b8d9f3518ecb7a2e8fd4b14ebf9b4fd65118f341b47`；管理端摘要 `sha256:042569fd97ba15f095fc2aa2871d16a8b6e416c865d8eecdf0c3ddd22fb1f428`。升级前完整库备份 `/data/backups/pre-0.12-1794827166041.sqlite`。公网健康检查返回0.12.0，管理台已服务含公告/主题的构建，Authentik授权跳转和公告API的未登录拒绝均通过；手机QA副本已自动登录并读取日历、烹饪、探索、周末挑选、自选礼包、插花和百科状态。后台公告发布/停用及深浅主题切换和刷新保留已在隔离浏览器验证。

历史v0.10首次部署时发布了 `travel-frog-server:0.10.0` 和 `travel-frog-admin:0.10.0` 两个镜像，后续版本见当前发布记录。管理端 Service 为 `travel-frog-admin.travel-frog.svc.cluster.local:8080` / `10.106.181.173:8080`。游戏服务通过 `FROG_ADMIN_UI_ORIGIN` 转发 `/admin/` 到管理容器，因此原有公网 `/admin/` 地址继续可用；管理容器的 `/auth/`、`/api/` 和 WebSocket 又转发回游戏服务，所有管理写入与 OAuth 校验仍在唯一后端完成，不共享挂载 SQLite。升级前已在 `/data/backups/pre-0.10-*.sqlite` 创建一致性备份。

雷池/已有反向代理需要为 `travelfrog.caiw.pp.ua:8133` 添加上游 `http://travel-frog.travel-frog.svc.cluster.local:8080`（在集群网络外使用 Service ClusterIP），启用 WebSocket Upgrade，设置合理长连接超时并保留原始 Origin。外部 TLS 在代理终止，客户端使用 HTTPS / WSS。服务不信任代理提供的身份头，也不接受 OAuth 模式下的旧 Bearer 管理密钥。

## Authentik 客户端设置

按 [Authentik OAuth2 Provider 文档](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) 创建 OAuth2/OpenID Provider 与 Application：

| 字段 | 值 |
| --- | --- |
| Application 名称 / slug | 青蛙邮局 / `travel-frog-admin`（实际已创建） |
| Client type | Confidential |
| Client ID | `travel-frog-admin` |
| Client secret | 使用已部署 Secret 中的值，或填入新值后更新 Secret |
| Redirect URI | 严格匹配 `https://travelfrog.caiw.pp.ua:8133/auth/callback` |
| Scopes / mappings | `openid`、`profile`、`email`；确保 profile 包含 `groups` 字符串数组 |
| Signing key | 选择 RSA 签名密钥（RS256） |
| Launch URL | `https://travelfrog.caiw.pp.ua:8133/admin/` |

部署允许 `travel-frog-admins` 或 `authentik Admins` 用户组。专用组在本次检查时尚未创建；现有 Authentik 管理员可以直接进入，其他需要授权的用户请加入专用组，并同步检查 Application 的访问绑定。若自定义 scope，需通过同名 `groups` 字段返回组名。也可用 `FROG_OIDC_ALLOWED_SUBJECTS` 配置明确的 OIDC sub 白名单。

Discovery URL：`https://auth.caiw.pp.ua:8133/application/o/travel-frog-admin/.well-known/openid-configuration`。本次已将专用 Provider 设置为严格匹配回调，选择现有 RSA 签名证书，并将 Kubernetes Secret 同步为用户配置的实际 Client Secret。发现文档与授权跳转已从运行容器验证通过。使用授权码、PKCE S256、state、nonce 和 ID Token 签名检查，服务端兑换令牌；浏览器仅得到 HttpOnly/Secure/SameSite=Lax 会话 Cookie，默认有效 12 小时。管理写请求另验证 Origin 和 CSRF token。会话存储在 SQLite，刷新网页及重启服务后仍有效；退出清除本应用会话，不退出其他 Authentik 应用。

读取已部署的客户端 Secret（仅在自己的终端执行，不粘贴到 Git）：

```sh
kubectl -n travel-frog get secret travel-frog-oidc -o jsonpath='{.data.FROG_OIDC_CLIENT_SECRET}' | base64 -d
```

如替换凭据，按 `deploy/oidc-secret.example.yaml` 写入实际值并 apply，然后 `kubectl -n travel-frog rollout restart deployment/travel-frog`。尚未创建 Provider 时游戏服务仍可运行，管理端登录会失败并要求检查 Authentik 配置。无客户端凭据时会明确提示未配置，不回退为免登录访问。

## 游戏账号密码

部署开启 `FROG_GAME_AUTH_REQUIRED=1`，游戏先通过 `/api/game/login` 验证账号密码，再使用有效期 24 小时的随机令牌登录 WebSocket。用户名关联一个存档，密码以带独立盐的 scrypt 摘要保存，令牌只保存 SHA-256 摘要。v0.10 同时返回续期凭据，30 天不使用后过期；Android 只在应用私有 SharedPreferences 保存续期凭据，冷启动通过 `/api/game/refresh` 自动恢复登录，不保存明文密码。密码重置、禁用、撤销会话或删除登录账号都会撤销该登录名的全部访问/续期凭据，不影响共用存档的其他登录名。

管理台独立“账号管理”页支持列出登录名、关联存档、状态、最近登录和有效续期凭据数；可创建、重置密码、禁用/启用、退出所有设备，以及确认删除登录账号。删除仅移除登录权限，游戏存档保留。新存档仍通过侧栏创建，然后选择关联；多个登录名可共用同一存档。管理变更写入 `game_user_audit`，不记录密码、摘要或令牌；这些认证数据不随账号快照回档。

首次部署的登录名为 `dog`，关联 `official-14762366`（菜农）；初始随机密码只放在本地 `exports/deployment-20261116/credentials.txt`，不放进镜像、APK 或 Git。该 APK 共用的是集群中的菜农存档，操作会影响这份存档。

## APK 构建

对官方原始 APK 在新目录 apktool 解包，再运行参数化构建脚本：

```powershell
$env:FROG_PACKAGE='com.cainong.travelfrog.dog'
$env:FROG_APP_NAME='旅行青蛙·狗狗特供版'
$env:FROG_SERVER_URL='wss://travelfrog.caiw.pp.ua:8133'
$env:FROG_GAME_LOGIN='1'
node tools/android/build_local_client.js exports/dog-apk-build/decoded
node tools/android/build_native_login.js exports/dog-apk-build/decoded
```

原生构建依赖见 [native-login.md](native-login.md)。然后用 apktool 构建，用本地保存的专用 keystore 对齐并签名；后续升级必须使用同一签名。新包 versionCode 为 22、最低 Android 5.0，与官方版、本地 USB 版并存。服务器凭据和 OAuth Secret 不进入 APK，游戏静态资源随包提供，停用远端热更新。已通过 adb 安装到 `c8e8d4e1` 并确认 Android 原生输入框、密码框和按钮可见，首次账号密码登录及重启进入游戏由用户继续实测。

开发时默认仍兼容密钥登录及本地测试账号；启动 `start:admin` 并设置 `FROG_ADMIN_AUTH=oidc` 则不生成管理密钥。不要把本地测试模式当作部署配置。
