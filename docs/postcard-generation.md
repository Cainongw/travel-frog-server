# 新明信片图层生成

## 配置、观察与边界

`src/game/travel/postcard_generator.js` 从部署时提供的 `config.eab`、`resources_json` 与可读取 PNG 素材建立构图目录；不会读写账号数据库，也不自动扫描私人备份。配置包含场景、背景/前景名称、青蛙与同行者姿态、中心坐标、地点等。真实存档样本由调用方明确传入，只提取图片编号、资源编号和图层坐标，不读取姓名、余额、邮件文字或凭据。

本次使用：`exports/oneplus-official-20261114-live/assets/eab/config.eab` 与 `exports/dog-apk-build/decoded/assets/game/js/main.min.js`。复用 REA 静态分析 Evidence `ev_54b142b4e7d9807890a683466175fa62c7c2902457d3d25867ff5872c41410e6`（本机包 `exports/rea-merchant-20261115.json`）。REA 对主脚本的语义图为部分覆盖，其余 16 个 JS 文件未分析；精确配置、图层与 PNG 尺寸来自单独的本地静态读取，不冒称为客户端运行证据。

当前素材包配置有382场景，其中375场景直接使用当前配置/素材生成，另外7个退休场景采用下面明示的同地点完整构图替代。默认共382场景可生成，覆盖39 Normal、28 Tools、163 Goal、152 Unique；关闭退休替代时仍是原来的375场景。已读到的206张原始图片提供138个可确认场景的布局样本，礼品盒里缺少 `pic_id` 的原记录不会被猜成某个场景。

七个历史配置的背景资源仍不在当前资源表/素材包中：2033、2035、2040、2041、2042、2075、2076。现在允许保留目标 `pic_id`，从有明确地点证据的当前Goal场景生成完整图层作为**近似退休场景**。这不代表恢复了原始图片，缺失资源仍列在 `coverage().rows[].unresolved`，不会产生不存在的资源编号。

| 退休目标 | 现有完整构图候选 | 同地点证据 |
| --- | --- | --- |
| 2033 香港3、2035 香港5 | 2031、2032、2034 | 配置place=11，香港；包括维多利亚港、怪兽大厦、嘉咸街 |
| 2040、2041、2042 长白山1/2/3 | 2126、2127、2128、2129 | 旧location为“吉林·长白山”，新候选location均明确以“吉林·长白山·”开头，place=30 |
| 2075 海南3、2076 海南4 | 2073、2074、2078 | 配置place=21，海南；亚龙湾、天涯海角、南山海上观音 |

旧目标的 `place` 为空，不能将“undefined相等”当成同地点。实现使用严格的退休ID/原名称/原location清单验证目标，再校验候选的真实place；长白山还额外校验location前缀。没有匹配地点或候选素材也不可用时仍拒绝，不跨地点、不从不可用场景链式替代。

替代结果使用来源的**全部**背景、角色、前景和坐标，不把不同景点的角色/碎片拼进旧布局。优先取该目标的完整真实样本；若没有，再优先同地点有真实样本的候选。来源仍接受季节门槛与可用同行者选择，目标仍接受正常工具/类型/地点筛选。编译定义只在这些退休目标上补充已证实的place，避免它们逃过旅行道具的地点加权；不改动原始传入配置。

`coverage().rows[].layout='approximate-retired-scene'`，并给出 `fallback_place` 和 `fallback_source:[{pic_id,name,place,location,observed}]`，保留缺背景的 `unresolved`。如调用方传入完全可读的同一退休目标真实样本，则使用 `observed-retired-scene`，优先级高于替代。可用 `enableRetiredFallbacks:false` 禁用近似替代；该选项不拒绝真实可用样本。

## 如何构图

- 优先保留同一场景的真实背景/前景整组布局，保持图层次序、随机位移的关联以及半像素坐标。生成新角色组合时不修改原始样本。
- 单张完整背景按真实 PNG 尺寸居中。角色坐标按配置从中心、Y 向上转换为 500×350 画布的左上角位置：`x=250+config.x-width/2`，`y=175-config.y-height/2`。
- 配置有“独自姿态”和“同行姿态”时分别使用。同行图片本身包含青蛙的场景（例如垂丝海棠）不再叠加第二只青蛙。
- 历史角色资源使用缩写（如 `BJ1_QW`）或全名；资源别名映射只解决名称，并不代表恢复官方路线概率。
- 有碎片图层但没有同场景实测布局时，先参考同资源的已知位置，否则使用明确的本地对齐规则。`coverage().rows[].layout` 标为 `approximate-fragments`，不能称为精确官方构图。
- 图层出包前验证资源实际可读、PNG 尺寸合法、坐标有限且数量不超过 64。不能生成的场景返回错误，不静默发空图片。

季节筛选（红/黄叶为秋、雾凇/腊梅为冬、春花为春）以及工具与姿态分级的匹配，是根据名称与道具语义制定的近似策略。官方隐藏的季节开放日期、构图概率、稀有度、事件来源和道具加权尚无充分样本。调用方可以用 `allowedTypes`、`tags`、`place` 控制来源，避免普通旅行直接抽到全部历史活动 Unique 图。预览模式仅绕过季节/持有工具限制，不绕过缺失资源校验。

## 接入

```js
const {PostcardGenerator}=require('./src/game/travel/postcard_generator');
const generator=new PostcardGenerator({
  root:catalog.root,
  config:catalog.config, // 也可省略，从 root/eab/config.eab 读取
  samples:originalPostcards, // 或 {protocols} / {responses} 捕获结构
  random:Math.random, // 可注入固定种子随机源，必须在 [0,1)
  enableRetiredFallbacks:true, // 默认启用同地点退休场景近似；false严格拒绝缺资源场景
});
const picture=generator.generate(postcardId,{
  picId:route.picId,
  companionId:0, // -1 独自，0 壁虎，1 刺猬，2 萤火虫；省略为合法组合中选择
  season:1,
  tools:[2003],
});
```

返回标准 `{id,pic_id,layers,for_ads:false,visit:false}`。`eligible(context)` 返回可选定义，`coverage()` 返回全部场景、缺失资源、支持同行者及近似布局信息。`preview:true` 允许显式预览工具/季节场景；无 `picId` 时默认候选仅为 Normal/Goal/Tools，Unique 必须显式允许。

构造只做只读资源分析，约半秒读取本地目录；建议每进程实例化一次。样本应来自原始保全协议或明确导入的数据，而不是逐次扫描玩家当前相册；原图删除与后续存档操作不应改变服务器构图目录。

## 验证

`node --test tests/postcard_generator_test.js`：10项测试通过。原有中心坐标、合成同行者、半像素样本、工具/季节、坏随机源和缺图拒绝测试继续通过；新增同地完整替代、配置不变、跨地点拒绝、来源季节门槛、目标真实样本优先、来源样本优先、禁用近似，以及实际7目标全部可生成的回归。当前包全部382场景及可用同行组合逐一生成并校验资源可读。另将101个配置推导Goal角色图层坐标与官方捕获逐一比较，仍全部一致。无素材或官方捕获时对应项明确跳过。

本地另合成了 28 张跨类型图片接触表检查，位置见忽略目录 `exports/postcard-analysis/contact-sheet.png`。它证明可渲染性与代表性布局，不代替所有场景在 Android 客户端上的实际浏览。接入旅行后还需按路线图进行客户端收图、保存、重登和回档验证，才能勾选该项端到端完成。
