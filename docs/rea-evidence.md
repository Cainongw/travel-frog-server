# APK 静态分析记录（2026-11-05）

使用 `reverse-engineer-anything` 技能的静态 JavaScript 路线。会话未暴露 REA MCP；初始 doctor 指出当前 PATH 中 Node 25 不在支持范围。已使用现有的 Node 24.22.2 与已安装 REA 公共 CLI 继续，未修改 MCP 配置、全局 Node 或执行游戏代码。

分析输入：`旅行青蛙·中国之旅/assets/game/js`，仅选择 `main.min.js`，其余 16 个库存文件未做源代码分析。

- 原始分析 Evidence：`ev_3b83b5ccf117d83b7b312c758a6c3549e0626f5562f4565d64cbe50264179875`
- 摘要 Evidence：`ev_7566948c82bb2904a16aab361af8b286dece077d7b5c0797d781d8c984f09b61`
- 输入目录库存 SHA-256：`440566df94556568eb8ee0846faf0c69f78bae94208445ba47fb6f2c2f4bb6fb`
- 本机完整包：`exports/rea-furniture-20261105.json`（约 49 MB，包含衍生代码，不提交 Git）。

CLI 命令：

```text
rea analyze-javascript-application <extracted-assets/game/js> --source-path main.min.js --detail summary --evidence_output <new-evidence.json> --format json
```

语法解析完成；语义图是部分覆盖，达到每文件 20,000 个语义节点与未知记录的保留上限，别名展开亦有限制。没有为了扩大同一图而重复分析。此结果不证明运行时行为或全部 APK 逻辑已被恢复。

家具和邻居的精确字段继续通过普通本地脚本读取选定文件与解码 `config.eab` 获得；它们属于独立的源码片段证据，不能冒称为 REA 的运行时观察。具体定位、调用路径和未恢复规则分别记录在 `furniture-protocol.md`、`neighbors-protocol.md`。服务器数据库测试与 WebSocket 测试只能验证私服实现，原生客户端的最终画面仍需设备验证。
