# dsh-llm-app-credentials

把**本机另一个桌面应用已经登录好的凭据**，直接变成 DSH Forge 里可选的模型路由 ——
不需要申请 API key，也不需要把 token 搬进凭据库。

```text
你用别的应用登录过一次  →  本插件读它落盘的凭据文件  →  DSH Forge 里多一条模型路由
```

> 本文档面向使用者。底层设计与开发约定见文末「[开发者](#开发者)」一节。

## 三句话看懂

1. **什么时候用它**：你想在 DSH Forge 里用某个桌面应用已经买好的模型额度，但那个应用
   只把登录凭据写在自己的文件里，既没给你 API key，也没法导出。
2. **支持哪些应用**：默认**自动认出 WorkBuddy（国际版 / 国内版）**；接别的应用只需加一段
   配置，**代码不用改**（见「[支持哪些应用](#支持哪些应用)」）。
3. **装完怎么用**：设置里选中该路由 → 正常聊天。凭据每次请求自动重读，**源应用换了
   token 也不用重启**。

## 安装（一条命令）

先在**托盘里退出** DSH Forge（外部插件只在进程启动时装配，热装载做不到），然后：

```powershell
& "$env:LOCALAPPDATA\Programs\dsh-forge\DSH Forge.exe" --install-plugin github:lansi-ai/dsh-llm-app-credentials
```

cmd 用户（`&` 是 PowerShell 的调用运算符，cmd 里没有）：

```bat
"%LOCALAPPDATA%\Programs\dsh-forge\DSH Forge.exe" --install-plugin github:lansi-ai/dsh-llm-app-credentials
```

> 安装目录是**包名** `dsh-forge`，不是产品名 `DSH Forge`；便携版 / 解压版的路径换成你
> 手上那个 exe（不确定就看桌面快捷方式的「目标」）。

这条命令自己完成全链：**下载 → 解包 → 落位 → 写装载行 → 继续启动**，本次启动即生效。
**不需要** Node、pnpm、官方 `dsh` CLI，也不需要你手工准备依赖。

其他写法：

```bash
--install-plugin=<spec>                      # 等号形式
github:owner/repo@<ref>                      # 锁分支 / 标签 / 提交
--install-plugin "E:\path\to\plugin-dir"     # 本地目录旁加载（离线 / 网络不通时）
```

失败会**弹错误框并退出**（不静默）；若目标位置已被之前的安装占着，它会明确拒绝而不会
误删你的目录（处理见「[故障排查](#故障排查)」）。

## 快速上手（3 步）

1. 打开 **设置 → 应用凭据模型**：本机若已装过 WorkBuddy（并在其中登录过），路由会
   **自动出现**并可立即使用。
2. 打开 **设置 → 模型**（或会话里的模型选择器），选到该路由下的模型。
3. 发一句话验证。工具调用、多轮对话都走同一条路由。

就这样 —— 没有第 4 步。默认选中的是**推理档位「关闭」**（此时完全不发
`reasoning_effort`），所以即使上游不认这个字段也不会出问题；想用推理档位再主动选。

## 支持哪些应用

### 默认自动认出这两个（同一应用的两套独立部署）

凭据文件都在 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\`：

| 模型选择器里显示 | 上游 | 凭据文件 |
|---|---|---|
| WorkBuddy | `https://www.workbuddy.ai/v2` | `workbuddy-desktop-ai.info` |
| WorkBuddy（国内版） | `https://www.codebuddy.cn/v2` | `workbuddy-desktop.info` |

> 两个部署的端点与凭据文件必须**配对**使用；可以两个都配成路由，在模型选择器里随时切。

### 接别的应用：加一段配置，代码不用改

路由名由**你**起（插件里不出现任何厂商名），只要能满足下面两条就能接：

| 要求 | 说明 |
|---|---|
| ✅ 凭据是**本地 JSON 文件里的静态串** | 给文件绝对路径 + token 的点路径即可；`uid` / `expiresAt` 可选 |
| ✅ 上游是 **OpenAI 兼容**的 chat-completions | 会自动补 `/chat/completions` |

接不上的情况（先看这一条，能省很多时间）：

- ❌ 凭据**不是 JSON**：存在 sqlite、加密二进制、系统凭据库（Windows Credential Manager 等）；
- ❌ 凭据需要**你自己跑 OAuth 刷新流程**：本插件不实现 refresh，只重读源应用写好的文件；
- ❌ 上游**不是 OpenAI 兼容协议**。

最小示例（改三个值就能用）：

```yaml
- insert:
    - id: llm-app-credentials
      name: dsh-llm-app-credentials
      config:
        providers:
          myapp:                                    # ← 路由名，你起，会出现在模型选择器里
            displayName: My App
            baseURL: https://api.example.com/v1     # 会自动补 /chat/completions
            credential:
              file: C:/Users/<you>/AppData/Local/SomeApp/auth.json
              token: data.session.accessToken       # token 在 JSON 里的点路径
```

## 配置

生效顺序（高的赢）：**设置页 → 插件条目 `config` → 内置探测 → schema 默认值**。
也就是说自动探测出来的值随时可以被你逐字段覆盖。

```yaml
# $DSH_HOME/profiles/dsh-forge/cordis.patch.yml
- insert:
    - id: llm-app-credentials
      name: dsh-llm-app-credentials
      config:
        providers:
          workbuddy:                      # 覆盖/新增一条路由；名字随你
            displayName: WorkBuddy
            baseURL: https://www.workbuddy.ai/v2
            credential:
              file: C:/Users/<you>/AppData/Local/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info
              token: auth.accessToken     # 必填：token 的点路径
              uid: account.uid            # 可选
              expiresAt: auth.expiresAt   # 可选（毫秒时间戳；过期直接报 AUTH）
            attribution:                  # 可选；不写则用插件自己的身份
              product: <your-white-label>
              version: '0.1.0'
              url: https://example.invalid
            models:                       # 建议性清单，上游仍接受未列出的 id
              - id: deepseek-v4.1-flash
                name: DeepSeek V4.1 Flash
                contextWindow: 300000
                maxTokens: 128000
            reasoningEfforts: [low, medium, high]   # 可选；见下
```

| 字段 | 必填 | 作用 |
|---|---|---|
| `baseURL` | ✅ | 上游根地址（自动补 `/chat/completions`） |
| `credential.file` / `.token` | ✅ | 凭据文件绝对路径 / token 的点路径 |
| `credential.uid` / `.expiresAt` | — | 账户 id / 过期时间（毫秒时间戳）的点路径 |
| `displayName` | — | 模型选择器里显示的名字，默认用路由名 |
| `models` | — | 建议性清单（含 `contextWindow` / `maxTokens`） |
| `attribution` | — | 白标归因，不写用插件身份 |
| `reasoningEfforts` | — | 除「关闭」外可选的档位（按上游 `reasoning_effort` 的拼写写） |
| `quirks` | — | 上游行为开关：`forceStream` / `ensureSystemFirst` / `defaultSystemPrompt` |
| `streamIdleTimeoutMs` | — | 单次流读取的最大空闲时间 |

### 推理档位

- 每条路由**必定**有「关闭」档且为默认：此时**完全不发** `reasoning_effort`，所以指向一个
  不认该字段的上游也不会出事。
- `reasoningEfforts` 只列**除「关闭」之外**的档位；上游不认某个档位时它会以 `400` 返回
  （上游原文会原样带出来），从列表里删掉即可。
- 只想开放「关闭」：写 `reasoningEfforts: []`。

## 故障排查

| 症状 | 处理 |
|---|---|
| 模型选择器里**没有**这条路由 | ① 本机对应应用的凭据文件存在吗（见「支持哪些应用」的表格路径）？② 手工配置的 `credential.file` 路径对吗？③ 装完重启过 DSH Forge 吗（外部插件只在启动时装配） |
| 发消息报 `MISSING_CREDENTIAL` | 源应用登出过 / 凭据文件被删：**去源应用重新登录**一次即可 |
| 发消息报 `AUTH` | 凭据过期（或 `expiresAt` 指向的字段已过期）：同样在**源应用**里重新登录；本插件不实现刷新 |
| 报 `NO_ADAPTER` | 请求了一个没配过的路由 —— 检查路由名拼写 |
| 报 `EMPTY_RESPONSE` / `STREAM_CLOSED` | 上游给了空补全 / 流被中途掐断；重试一次，持续出现就换档位或换模型 |
| 上游返回 `400 {"code":11128}` | 归因被拒：给该路由配上 `attribution`（`product` / `version` / `url`） |
| 敲了 `--install-plugin` 但没反应 | 已有实例在跑：该参数只会把窗口拉到前台。**完全退出**（含托盘）再执行 |
| `系统找不到指定的路径` | 安装目录是**包名** `dsh-forge`，不是产品名 |
| 错误框「落点已被链接占用」 | 之前用脚本装过、落点还是链接：`rmdir "<DSH_HOME>\profiles\node_modules\dsh-llm-app-credentials"`（**不要加 /S**，加递归会删到源目录）后重装 |
| 启动报 `atomic-write: timed out waiting for the writer lock at …\.credentials.yaml.lock` | **孤儿锁**：强杀进程留下的 `.lock`（上游不做自动回收）。删掉该 `.lock` 再启动。**退出应用请走托盘，不要 `taskkill /F`** —— 它正是孤儿锁的成因 |
| GitHub 拉不动 | 主进程下载走 Node `fetch`，**不读** `HTTP_PROXY`/`HTTPS_PROXY`；应用内「网络设置」只管 Chromium 栈。请离线取包后 `--install-plugin <本地目录>` |
| 装完在设置里看不到 | 看启动日志（GUI 子系统没有控制台）：`Start-Process ... -RedirectStandardOutput "$env:TEMP\forge.log"` |

## 卸载

先退出应用，然后二选一。

```bash
node scripts/install-forge.cjs --uninstall      # 摘落点 + 把补丁层那行还原为 []
```

或手工两步：

1. 删 `<DSH_HOME>/profiles/node_modules/dsh-llm-app-credentials`
   （若它是链接，用 `rmdir`，**别加 /S**）；
2. 把 `<DSH_HOME>/profiles/dsh-forge/cordis.patch.yml` 里那段 `- insert:` 改成 `[]`。
   **文件为空或只剩注释会导致启动失败** —— 要停用这一层就显式写 `[]`。

`<DSH_HOME>/profiles/dsh-forge/` 目录与其中的 `package.json` 是**装载点**（不是插件本体），
可以留着；要彻底清干净就删掉该目录。

---

## 开发者

使用者可以到此为止。以下是底层设计与开发约定。

### 为什么它单独存在

能配 API key 的通用适配器（`dsh-llm-pi-ai`）已经解决了「用户提供 key」这一类。
本插件存在的**唯一理由**是凭据来源不标准：某些桌面应用自己管理登录会话并把 accessToken
写在自己的文件里，用户不想、也没法把它搬进凭据库。

所以包名、插件 id、settings 命名空间里**不出现任何厂商名**；厂商只出现在 `providers` 的
**键**（路由名）上，由使用者自己起；将来接第二个应用 = 加一段配置，代码一行都不用改。

内置探测表（`src/detect.ts`）是唯一提到具体应用的地方，它是**可选便利**：显式配置永远优先，
把该表清空后插件依然完整可用，只是路由得手写。

### 关键行为

| 行为 | 说明 |
|---|---|
| 凭据热更新 | 每次请求重读凭据文件。对方刷新 token 后**不需要重启本应用**，本插件也不实现 refresh 流程 |
| 白标归因 | 强制发送自己的 `User-Agent`。省略会退化成 harness 身份，被这类上游以 `HTTP 400 {"code":11128}` 拒掉；路由没配 `attribution` 时用插件身份兜底 |
| 首条 system | 上游硬要求 `messages[0]` 是 system，由 `quirks.ensureSystemFirst` 保证（可关） |
| 强制流式 | 上游只吃流式；`quirks.forceStream`（默认开） |
| 不发 `stream_options` | 参考上游对它 400，默认不发 |
| usage 互斥换算 | 上游的 `prompt_tokens` 含缓存命中，harness 的计数是互斥的，所以缓存读会被减出 `inputTokens`；会话统计里的 `cacheWrite=0` 那行不会出现 |
| 空补全 | 「正常 stop 但零内容块」归为 `EMPTY_RESPONSE`（而不是产出一条空 assistant 消息静默结束回合） |
| 流截断 | SSE 没有 `[DONE]` 就结束 → `STREAM_CLOSED`（而不是当成正常结束写进会话） |
| 文本专用 | 本路由声明 text-only。历史里的图片 / 文件块降级为文本占位，不抛错——否则一条历史附件会让整段长会话再也发不出请求 |
| 路由未配置 | 请求一个不在 `providers` 里的路由 → `NO_ADAPTER`，不静默走默认 |
| 推理档位 | 每条路由**必定**声明「关闭」档并将其设为默认。harness 对「请求了但模型未声明」的档位是**直接拒绝**（`UNSUPPORTED_REASONING_EFFORT`，且发生在任何网络 I/O 之前），而一条不带档位的存量选择必须落到某个值上——所以「关闭」恒在且为默认 |

### 认知边界

- **模型清单是建议性的**，且两套部署不通用；不要照抄本地缓存里的混合目录。
- 刷新凭据的职责在**源应用**：源应用登出后报 `MISSING_CREDENTIAL`，凭据过期报 `AUTH`。
- 走 Node 栈的模型请求**不受**桌面「网络设置」的代理影响（那个设置作用于 Chromium 栈）。
- 设置页展示配置分层与生效值，不做凭据在线探测（那需要一个 typert Remote 命名空间，属后续增强）。

### 装法三选一（dsh-forge / 官方宿主 / 开发态）

```bash
# ① 应用内一条命令（面向使用者，见上文「安装」）
& "...\DSH Forge.exe" --install-plugin github:lansi-ai/dsh-llm-app-credentials

# ② 仓库自带脚本：开发态首选（落点是链接，改完 npm run build 即生效）
node scripts/install-forge.cjs [--forge <宿主目录>] [--home <DSH_HOME>] [--copy] [--uninstall]

# ③ 官方 dsh CLI（目标是官方宿主时）
dsh plugin --profile <宿主自己的 profile 名> add dsh-llm-app-credentials
```

host 侧 peer 由宿主在装载前自动供给（开发态 junction；打包态生成指向 `app.asar` 的 ESM
代理入口），因此 `link-peers.cjs` **现在只是开发便利**，不是运行前提；打包态跑它没有意义。
`--profile` 必须与宿主自己的 profile 名一致（dsh-forge 的 profile 名就是 `dsh-forge`）。

### 代码地图

```bash
npm run build        # tsc → lib/（ESM + .d.ts）
npm run typecheck
```

```
src/index.ts     # name / inject / NS / PLUGIN_IDENTITY / Config / apply
src/config.ts    # schemastery 配置 schema（settings 命名空间与条目 config 共用）
src/detect.ts    # 内置探测表（唯一提到具体应用的地方）
src/credential.ts / pick.ts      # 读凭据文件
src/serialize.ts / sse.ts / translate.ts / failure.ts   # wire 处理四件套
src/adapter.ts   # LlmAdapter 实现
lib/client.js    # 浏览器半：**手写产物**，不经 tsc，重新构建时勿删
```

`lib/client.js` 手写（与 dsh-forge 自研 client 件同风格，零 bundler 依赖）；它注册
`settings.section` 整页，读写走官方 `ctx.settingsScope`（读走 `settings.describe` 镜像、
写走 `remote.settings`），因此**不需要自造 Remote**。

### 验收对照

| # | 检查项 | 判据 |
|---|---|---|
| 1 | 文本推理 | 设置页选中该路由后发一句 → 有正常回复 |
| 2 | 工具调用往返 | 「运行 `echo X` 并报告 stdout」→ 模型真的调工具并复述结果 |
| 3 | 多轮工具 | 工具结果回传后还有第二轮请求 |
| 4 | 归因白标 | 抓包确认 `User-Agent` 不含 `deepseek-harness` |
| 5 | 凭据热更新 | 源应用刷新 token 后**不重启**，下一个请求仍成功 |
| 6 | 空补全 | 构造零内容补全 → `EMPTY_RESPONSE`，不产生空消息 |
| 7 | 中止 | 中途打断 → 收到 aborted finish，进程不崩 |
| 8 | 路由未配置 | 请求未配置的路由 → `NO_ADAPTER` |
| 9 | 多路由 | 配两条路由 → 都出现在模型选择器里且都能跑 |
| 10 | 设置页分层 | 「已覆盖」徽标只在字段真的进了用户层时出现；「还原覆盖」后回落探测值 |
