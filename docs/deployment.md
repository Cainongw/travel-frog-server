# 狗狗特供版、Docker 和 k8s 部署

## 服务

`Dockerfile` 用 Node.js 24 构建，包含 Svelte 管理台及服务端，不包含游戏素材、数据库、管理密钥或 APK。`deploy/k8s.yaml` 创建独立 namespace、单实例 Deployment、Longhorn PVC、ConfigMap 和 ClusterIP Service，不创建 Ingress。SQLite 使用单副本和 Recreate 更新；数据库与素材都放在 `/data`，需另外备份持久卷。

```powershell
docker build -t harbor.k8s.lan/library/travel-frog-server:0.9.0 .
docker push harbor.k8s.lan/library/travel-frog-server:0.9.0
```

实际实例已使用本机现有 Harbor 凭据；私有 registry 应另行配置专用 imagePullSecret。示例镜像放在现有公开 `library` 项目，仅含源码和运行时。

首次启动前，将一致性备份的 `travel-frog.sqlite` 和资源目录 `assets/` 放进 PVC，并设置 UID/GID 为 1000。已有快照、管理记录和原始采集随数据库保留。`/auth`、管理 API、游戏 HTTP 登录和 WebSocket 均共用端口 8080。

2026-11-16 实例已部署：namespace `travel-frog`，Service `travel-frog`，ClusterIP `10.103.166.246:8080`，PVC `travel-frog-data`（5Gi）。镜像已推送 Harbor；Docker Desktop 代理对内网推送返回 EOF，因此使用 master 上的 containerd 导入相同镜像并推送，未修改全局代理或 TLS 校验。原始镜像 manifest 摘要为 `sha256:ff7e14b5e8fa493801789032d036ac8f884c96941e4707db9e836491555635ee`。

迁移时菜农有 207 张图片记录、1749 草、2 券，共 2 个快照（含迁移前快照）。集群内已验证健康检查、管理端未登录拒绝、游戏密码登录、WebSocket 登录后读取菜农角色、SQLite 完整性。电脑上没有运行中的旧服务器；本地数据库保留为迁移备份，不与集群实时双向同步。

雷池/已有反向代理需要为 `travelfrog.caiw.pp.ua:8133` 添加上游 `http://travel-frog.travel-frog.svc.cluster.local:8080`（在集群网络外使用 Service ClusterIP），启用 WebSocket Upgrade，设置合理长连接超时并保留原始 Origin。外部 TLS 在代理终止，客户端使用 HTTPS / WSS。服务不信任代理提供的身份头，也不接受 OAuth 模式下的旧 Bearer 管理密钥。

## Authentik 客户端设置

按 [Authentik OAuth2 Provider 文档](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) 创建 OAuth2/OpenID Provider 与 Application：

| 字段 | 值 |
| --- | --- |
| Application 名称 / slug | 青蛙邮局 / `travel-frog` |
| Client type | Confidential |
| Client ID | `travel-frog-admin` |
| Client secret | 使用已部署 Secret 中的值，或填入新值后更新 Secret |
| Redirect URI | 严格匹配 `https://travelfrog.caiw.pp.ua:8133/auth/callback` |
| Scopes / mappings | `openid`、`profile`、`email`；确保 profile 包含 `groups` 字符串数组 |
| Signing key | 选择 RSA 签名密钥（RS256） |
| Launch URL | `https://travelfrog.caiw.pp.ua:8133/admin/` |

建立 `travel-frog-admins` 用户组，将允许管理此服的用户加入该组，建议同时给 Application 加对应组的访问绑定。若自定义 scope，需通过同名 `groups` 字段返回组名。也可用 `FROG_OIDC_ALLOWED_SUBJECTS` 配置明确的 OIDC sub 白名单。

Discovery URL：`https://auth.caiw.pp.ua:8133/application/o/travel-frog/.well-known/openid-configuration`。使用授权码、PKCE S256、state、nonce 和 ID Token 签名检查，服务端兑换令牌；浏览器仅得到 HttpOnly/Secure/SameSite=Lax 会话 Cookie，默认有效 12 小时。管理写请求另验证 Origin 和 CSRF token。会话存储在 SQLite，刷新网页及重启服务后仍有效；退出清除本应用会话，不退出其他 Authentik 应用。

读取已部署的客户端 Secret（仅在自己的终端执行，不粘贴到 Git）：

```sh
kubectl -n travel-frog get secret travel-frog-oidc -o jsonpath='{.data.FROG_OIDC_CLIENT_SECRET}' | base64 -d
```

如替换凭据，按 `deploy/oidc-secret.example.yaml` 写入实际值并 apply，然后 `kubectl -n travel-frog rollout restart deployment/travel-frog`。尚未创建 Provider 时游戏服务仍可运行，管理端登录会失败并要求检查 Authentik 配置。无客户端凭据时会明确提示未配置，不回退为免登录访问。

## 游戏账号密码

部署开启 `FROG_GAME_AUTH_REQUIRED=1`，游戏先通过 `/api/game/login` 验证账号密码，再使用有效期 24 小时的随机令牌登录 WebSocket。用户名关联一个存档，密码以带独立盐的 scrypt 摘要保存；令牌只保存 SHA-256 摘要，重置密码会撤销该存档已有令牌。每次打开 APK 显示登录表单，不保存明文密码。

管理台选择账号后，在“存档管理 → 游戏账号密码”创建/重置登录名和密码。首次部署的登录名为 `dog`，关联 `official-14762366`（菜农）；初始随机密码只放在本地 `exports/deployment-20261116/credentials.txt`，不放进镜像、APK 或 Git。该 APK 共用的是集群中的菜农存档，操作会影响这份存档。

## APK 构建

对官方原始 APK 在新目录 apktool 解包，再运行参数化构建脚本：

```powershell
$env:FROG_PACKAGE='com.cainong.travelfrog.dog'
$env:FROG_APP_NAME='旅行青蛙·狗狗特供版'
$env:FROG_SERVER_URL='wss://travelfrog.caiw.pp.ua:8133'
$env:FROG_GAME_LOGIN='1'
node build_local_client.js exports/dog-apk-build/decoded
```

然后用 apktool 构建，用本地保存的专用 keystore 对齐并签名；后续升级必须使用同一签名。该包与官方版、本地 USB 版并存。服务器凭据和 OAuth Secret 不进入 APK，游戏静态资源随包提供，停用远端热更新。

开发时默认仍兼容密钥登录及本地测试账号；启动 `start:admin` 并设置 `FROG_ADMIN_AUTH=oidc` 则不生成管理密钥。不要把本地测试模式当作部署配置。
