# dsh-llm-app-credentials

一个 **LLM 适配器插件**：它调用 OpenAI 兼容的 chat-completions 上游，但**凭据不是
标准 API key，而是本机另一个应用落盘的凭据文件**。

## 为什么它单独存在

能配 API key 的通用适配器（`dsh-llm-pi-ai`）已经解决了「用户提供 key」这一类。
本插件存在的**唯一理由**是凭据来源不标准：某些桌面应用自己管理登录会话并把
accessToken 写在自己的文件里，用户不想、也没法把它搬进凭据库。

所以：

- 包名、插件 id、settings 命名空间里**不出现任何厂商名**；
- 厂商只出现在 `providers` 的**键**（路由名）上，由使用者自己起；
- 将来接第二个应用 = 加一段配置，**插件名与代码一行都不用改**。

内置探测表（`src/detect.ts`）是唯一提到具体应用的地方，它是**可选便利**：
显式配置永远优先，把该表清空后插件依然完整可用，只是路由得手写。

## 关键行为

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
| 推理档位 | 每条路由**必定**声明「关闭」档并将其设为默认。harness 对「请求了但模型未声明」的档位是**直接拒绝**（`UNSUPPORTED_REASONING_EFFORT`，且发生在任何网络 I/O 之前），而一条不带档位的存量选择必须落到某个值上——所以「关闭」恒在且为默认；「关闭」不上线，其余档位按 id 原样作为 `reasoning_effort` 发送 |

### 推理档位（`reasoningEfforts`）

`reasoningEfforts` 是该路由**除「关闭」之外**可选档位的**线上拼写**，默认
`[low, medium, high]`（OpenAI 兼容 `reasoning_effort` 的常规取值；参考部署实测
`high` 可用）。三个要点：

- **默认选中的是「关闭」**，此时完全不发 `reasoning_effort`——所以指向一个不认该
  字段的上游也不会出事，除非你主动选了别的档位。
- 上游若不认某个档位，会以 `400` 返回（本插件会把上游原文原样带出），从列表里
  删掉它即可。
- 只想开放「关闭」就写 `reasoningEfforts: []`。

## 安装

### dsh-forge

一条命令（幂等，可反复跑）：

```bash
node scripts/install-forge.cjs                    # 自动探测宿主与 $DSH_HOME
node scripts/install-forge.cjs --forge E:/Projects/DSH/desktop --home C:/Users/me/.dsh
node scripts/install-forge.cjs --uninstall        # 卸载
```

它做三件事：

1. `scripts/link-peers.cjs` —— 把 `@deepseek-ai/*` 等依赖以 **junction** 链到宿主
   的 `node_modules`。这一步是**正确性要求**而不是省事：ESM 模块身份必须与宿主
   一致，否则 `LlmAdapter` / `LlmError` 基类来自第二份副本，注册与错误分类都会
   对不上。junction 在 Windows 上不需要管理员权限。
2. 在 `<DSH_HOME>/profiles/node_modules/` 建一个 junction 指向本插件目录。
3. 在 `<DSH_HOME>/profiles/dsh-forge/cordis.patch.yml` 写一行 insert。

**之后必须重启 dsh-forge**（外部插件在进程启动时发现）。

手动安装等价于上面三步；只想拷一份而不链接，用 `--copy`。

### 官方 dsh CLI

```bash
dsh plugin --profile <name> add dsh-llm-app-credentials
```

包内 `cordis.patch.yml` 提供了 bundle 行，`package.json` 的 `dsh.bundle` /
`dsh.client` 与官方双半约定一致。

## 配置

三层叠加，高的赢：

1. **设置页**（应用内「设置 → 应用凭据模型」）→ 写进 settings 用户层
2. **插件条目 config**（`cordis.patch.yml` 里那一行的 `config:`）
3. **内置探测**（只在凭据文件真实存在时生效）
4. **schema 默认值**

### 零配置

装好后如果本机已有对应应用的凭据文件，路由会**自动出现**并可立即选用：

```yaml
# $DSH_HOME/settings.yaml
agent-default-model:
  provider: workbuddy          # = 探测出来的路由名（也可在设置页改）
  model: deepseek-v4.1-flash
```

### 显式配置

```yaml
- insert:
    - id: llm-app-credentials
      name: dsh-llm-app-credentials
      config:
        providers:
          workbuddy:                      # ← 路由名由你起，会出现在模型选择器里
            displayName: WorkBuddy
            baseURL: https://www.workbuddy.ai/v2   # 会自动补 /chat/completions
            credential:
              file: C:/Users/<you>/AppData/Local/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info
              token: auth.accessToken     # 在凭据 JSON 里的点路径
              uid: account.uid            # 可选
              expiresAt: auth.expiresAt   # 可选（毫秒时间戳；过期直接报 AUTH）
            attribution:                  # 可选；不写就用插件身份
              product: <your-white-label>
              version: '0.1.0'
              url: https://example.invalid
            models:                       # 建议性清单，上游仍接受未列出的 id
              - id: deepseek-v4.1-flash
                name: DeepSeek V4.1 Flash
                contextWindow: 300000
                maxTokens: 128000
            reasoningEfforts: [low, medium, high]   # 可选；见下「推理档位」
          # 第二个应用：加一段就行，代码不用动
          # otherapp:
          #   baseURL: https://api.example.com/v1
          #   credential: { file: 'C:/.../other.json', token: data.session.jwt }
```

> **国际版 / 国内版是两套独立部署**：端点与凭据文件必须配对。设置页会
> 按路由分别展示，两个版本可以同时配成两条路由，在模型选择器里切换。

## 开发

```bash
node scripts/link-peers.cjs     # 链接依赖（首次/宿主换位置后）
npm run build                   # tsc → lib/（ESM + .d.ts）
npm run typecheck
```

目录约定与 `plugins/` 下其它插件一致：

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
`settings.section` 整页，读写走官方 `ctx.settingsScope`（读走 `settings.describe`
镜像、写走 `remote.settings`），因此**不需要自造 Remote**。

## 卸载

```bash
node scripts/install-forge.cjs --uninstall
```

然后重启 dsh-forge。`$DSH_HOME/profiles/dsh-forge/` 目录与其中的 `package.json`
可以留着（那是装载点，不是插件本体）；要彻底清掉就删掉里面的那一行。

## 验收对照

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

## 已知边界

- **模型清单是建议性的**，且两个版本不通用；不要照抄本地缓存里的混合目录。
- 刷新凭据的职责在**源应用**。本插件不实现 refresh；源应用登出后本插件报
  `MISSING_CREDENTIAL`，凭据过期报 `AUTH`。
- 走 Node 栈的模型请求**不受**桌面「网络设置」的代理影响（那个设置作用于
  Chromium 栈）；需要代理时按上游要求配置进程级代理。
- 设置页当前展示配置分层与生效值，不做凭据在线探测（那需要一个 typert Remote
  命名空间，属后续增强）。
