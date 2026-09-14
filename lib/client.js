/**
 * dsh-llm-app-credentials —— browser half（设置页「应用凭据模型」）。
 *
 * 形态与 dsh-forge / plugins 下既有自研 client bundle 一致：
 * `window.__ModuleLoader__.load({ id, factory })`，`exports.inject` 是**服务等待**
 * （真正决定激活时机），`ctx.slots.register` 注册整页 section。
 *
 * 数据面不自己造 Remote：host 半把配置注册成 settings 命名空间
 * `llm-app-credentials`，本件经官方 `ctx.settingsScope` 服务读写 —— 读走共享的
 * `settings.describe` 镜像，写走 `remote.settings`，revision 冲突由它处理。
 *
 * 分层的可视化是这一页的重点：探测值在 `base`、用户覆盖在 `user`、生效值在
 * `value`。字段「已覆盖」= 该字段出现在 `user` 里（而不是值不相等）—— 与官方
 * 描述符的判定口径一致。
 *
 * 注：本文件为手写产物（不经 tsc），与 package.json 的
 * `exports["./client"] → ./lib/client.js` 对应，重新构建时勿删。
 */
window.__ModuleLoader__.load({
  id: 'dsh-llm-app-credentials',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** settings 命名空间 / 图谱条目 id（与 host 半 NS 一致）。 */
    const NS = 'llm-app-credentials'

    /** 可编辑字段：label → [点路径, 说明]。 */
    const FIELDS = [
      ['displayName', '显示名', '模型选择器里的名字；留空则显示路由名'],
      ['baseURL', '上游根地址', '如 https://host/v2；会自动补 /chat/completions'],
      ['credential.file', '凭据文件', '本机另一个应用落盘的凭据 JSON 绝对路径'],
      ['credential.token', 'token 路径', '在该 JSON 里的点路径，如 auth.accessToken'],
      ['credential.uid', 'uid 路径', '可选；该应用账号 ID 的点路径'],
      ['credential.expiresAt', '过期时间路径', '可选；毫秒时间戳的点路径，过期会直接报 AUTH'],
    ]

    const CSS = [
      '.ac-wrap { padding: 4px 0 8px; color: var(--dsw-alias-label-primary); }',
      '.ac-intro { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); margin: 0 0 12px; }',
      '.ac-status { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }',
      '.ac-chip { font-size: 12px; line-height: 18px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }',
      '.ac-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }',
      '.ac-cardHead { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }',
      '.ac-route { font-size: 14px; font-weight: 600; line-height: 22px; }',
      '.ac-badge { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--dsw-alias-button-info-fill); color: var(--dsw-alias-label-primary); }',
      '.ac-field { display: grid; grid-template-columns: 108px 1fr; gap: 8px; align-items: center; margin-top: 8px; }',
      '.ac-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }',
      '.ac-input { width: 100%; box-sizing: border-box; padding: 5px 9px; border-radius: 6px; font-size: 13px; font-family: inherit; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }',
      '.ac-input:focus { outline: none; border-color: var(--dsw-alias-button-info-fill); }',
      '.ac-hint { grid-column: 2; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); margin-top: -4px; }',
      '.ac-models { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); margin-top: 10px; word-break: break-all; }',
      '.ac-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }',
      '.ac-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 13px; font-family: inherit; }',
      '.ac-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.ac-btn:disabled { opacity: 0.5; cursor: default; }',
      '.ac-btn-primary { background: var(--dsw-alias-button-info-fill); border-color: var(--dsw-alias-button-info-fill); }',
      '.ac-err { font-size: 12px; line-height: 18px; color: #fbbf24; margin-top: 8px; }',
      '.ac-empty { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); padding: 8px 0 14px; }',
      '.ac-add { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 4px; padding-top: 14px; }',
      '.ac-addTitle { font-size: 13px; font-weight: 600; line-height: 20px; margin-bottom: 4px; }',
    ].join('\n')

    exports.inject = ['slots', 'settingsScope']
    exports.apply = (ctx) => {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-llm-app-credentials'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'llm-app-credentials: styles')

      const scope = ctx.settingsScope.bind({ namespace: NS })
      // 幂等预热：镜像只有 idle 时才真的发读请求。设置外壳打开时通常已拉过一次，
      // 这里兜住「直接落到本 section」的场景。
      void ctx.settingsScope.describe().ensure().catch(() => undefined)

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: NS, order: 20, label: () => '应用凭据模型' },
          function AppCredentialsSection() {
            return h(Section, { scope })
          },
        ),
      )
    }

    // ── 组件 ────────────────────────────────────────────────────────────────

    /** 订阅 scope 快照（getSnapshot 契约保证引用稳定，可直接交给 useSyncExternalStore）。 */
    function useSnapshot(scope) {
      return React.useSyncExternalStore(
        React.useCallback((listener) => scope.subscribe(listener), [scope]),
        React.useCallback(() => scope.getSnapshot(), [scope]),
      )
    }

    function Section({ scope }) {
      const snapshot = useSnapshot(scope)
      const [error, setError] = React.useState('')

      const providers = readProviders(snapshot.value)
      const routes = Object.keys(providers)

      return h(
        'div',
        { className: 'ac-wrap' },
        h(
          'p',
          { className: 'ac-intro' },
          '凭据来自本机另一个应用落盘的凭据文件，而不是标准 API key。每次请求都会重读该文件，' +
            '所以对方刷新 token 后无需重启本应用；路由名由你决定，本插件不含任何厂商名。',
        ),
        h(
          'div',
          { className: 'ac-status' },
          h('span', { className: 'ac-chip' }, `命名空间 ${snapshot.status}`),
          h('span', { className: 'ac-chip' }, snapshot.writable ? '可写入' : '只读'),
          h('span', { className: 'ac-chip' }, snapshot.mode === 'host' ? '随文档同步' : '仅本进程'),
          h('span', { className: 'ac-chip' }, `${String(routes.length)} 条路由`),
        ),
        routes.length === 0
          ? h(
              'div',
              { className: 'ac-empty' },
              '未探测到任何已知应用的凭据文件，也没有配置路由。请在下方手动添加一条路由；' +
                '若本机确实装了对应应用并已登录，重开应用后会自动探测出来。',
            )
          : routes.map((route) =>
              h(RouteCard, {
                key: route,
                route,
                profile: providers[route],
                overridden: isOverridden(snapshot.user, route),
                canWrite: snapshot.writable,
                scope,
                onError: setError,
              }),
            ),
        h(AddRouteForm, { scope, canWrite: snapshot.writable, existing: routes, onError: setError }),
        error === '' ? null : h('div', { className: 'ac-err' }, error),
      )
    }

    function RouteCard({ route, profile, overridden, canWrite, scope, onError }) {
      /** 草稿只在挂载时从生效值取一次；写回由保存按钮显式触发。 */
      const [draft, setDraft] = React.useState(() => readDraft(profile))
      const [busy, setBusy] = React.useState(false)

      const save = async () => {
        const ops = buildOps(route, profile, draft)
        if (ops.length === 0) {
          onError('没有改动')
          return
        }
        setBusy(true)
        onError('')
        try {
          await scope.mutate(ops)
        } catch (failure) {
          onError(`${route}: 保存失败 —— ${messageOf(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const reset = async () => {
        setBusy(true)
        onError('')
        try {
          // 去掉整条路由的用户覆盖，回落到探测值 / 默认值。
          await scope.mutate([{ op: 'unset', path: ['providers', route] }])
        } catch (failure) {
          onError(`${route}: 还原失败 —— ${messageOf(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const models = Array.isArray(profile?.models) ? profile.models : []

      return h(
        'div',
        { className: 'ac-card' },
        h(
          'div',
          { className: 'ac-cardHead' },
          h('span', { className: 'ac-route' }, route),
          overridden ? h('span', { className: 'ac-badge' }, '已覆盖') : null,
        ),
        FIELDS.map(([path, label, hint]) =>
          h(
            'div',
            { className: 'ac-field', key: path },
            h('span', { className: 'ac-label' }, label),
            h('input', {
              className: 'ac-input',
              value: draft[path] ?? '',
              disabled: !canWrite || busy,
              onChange: (event) => setDraft({ ...draft, [path]: event.target.value }),
            }),
            h('span', { className: 'ac-hint' }, hint),
          ),
        ),
        h(
          'div',
          { className: 'ac-models' },
          models.length === 0
            ? '模型清单：未声明（该上游仍可接受未列出的模型 id）'
            : `模型清单（${String(models.length)}，建议性）：${models.map((model) => model?.id).filter(Boolean).join(' · ')}`,
        ),
        h(
          'div',
          { className: 'ac-row' },
          h('button', { className: 'ac-btn ac-btn-primary', disabled: !canWrite || busy, onClick: save }, busy ? '保存中…' : '保存'),
          h('button', { className: 'ac-btn', disabled: !canWrite || busy, onClick: reset }, '还原覆盖'),
        ),
      )
    }

    function AddRouteForm({ scope, canWrite, existing, onError }) {
      const [route, setRoute] = React.useState('')
      const [baseURL, setBaseURL] = React.useState('')
      const [file, setFile] = React.useState('')
      const [token, setToken] = React.useState('auth.accessToken')
      const [busy, setBusy] = React.useState(false)

      const add = async () => {
        const name = route.trim()
        if (name === '') return onError('路由名不能为空')
        if (existing.includes(name)) return onError(`路由 ${name} 已存在`)
        if (baseURL.trim() === '') return onError('上游根地址不能为空')
        if (file.trim() === '' || token.trim() === '') return onError('凭据文件与 token 路径都不能为空')
        setBusy(true)
        onError('')
        try {
          // 一条 mutate 内的多个 op 是原子的：必填字段一起写入，只做一次校验。
          await scope.mutate([
            { op: 'set', path: ['providers', name, 'baseURL'], value: baseURL.trim() },
            {
              op: 'set',
              path: ['providers', name, 'credential'],
              value: { file: file.trim(), token: token.trim() },
            },
          ])
          setRoute('')
          setBaseURL('')
          setFile('')
        } catch (failure) {
          onError(`添加失败 —— ${messageOf(failure)}`)
        } finally {
          setBusy(false)
        }
      }

      const field = (label, value, onChange, placeholder) =>
        h(
          'div',
          { className: 'ac-field' },
          h('span', { className: 'ac-label' }, label),
          h('input', {
            className: 'ac-input',
            value,
            placeholder,
            disabled: !canWrite || busy,
            onChange: (event) => onChange(event.target.value),
          }),
        )

      return h(
        'div',
        { className: 'ac-add' },
        h('div', { className: 'ac-addTitle' }, '新增路由'),
        field('路由名', route, setRoute, '如 workbuddy（会出现在模型选择器与 agent-default-model.provider）'),
        field('上游根地址', baseURL, setBaseURL, 'https://host/v2'),
        field('凭据文件', file, setFile, 'C:/Users/<you>/AppData/.../auth/<app>.info'),
        field('token 路径', token, setToken, 'auth.accessToken'),
        h(
          'div',
          { className: 'ac-row' },
          h('button', { className: 'ac-btn ac-btn-primary', disabled: !canWrite || busy, onClick: add }, busy ? '添加中…' : '添加'),
        ),
      )
    }

    // ── 纯函数 ──────────────────────────────────────────────────────────────

    /** 从生效值里取出 providers 字典（形状异常时返回空对象，页面对异常形态不报错）。 */
    function readProviders(value) {
      const providers = value && typeof value === 'object' ? value.providers : undefined
      return providers && typeof providers === 'object' && !Array.isArray(providers) ? providers : {}
    }

    /** 生效值 → 可编辑字符串草稿。 */
    function readDraft(profile) {
      const draft = {}
      for (const [path] of FIELDS) draft[path] = stringAt(profile, path.split('.'))
      return draft
    }

    /** 该路由是否在用户层出现过（出现即「已覆盖」，与值是否相等无关）。 */
    function isOverridden(user, route) {
      const providers = user && typeof user === 'object' ? user.providers : undefined
      return Boolean(providers && typeof providers === 'object' && providers[route] !== undefined)
    }

    /** 草稿与原值比较，产出路径寻址的写入操作（空串 = unset，回落到底层）。 */
    function buildOps(route, profile, draft) {
      const ops = []
      for (const [path] of FIELDS) {
        const next = draft[path] ?? ''
        if (next === stringAt(profile, path.split('.'))) continue
        const at = ['providers', route, ...path.split('.')]
        ops.push(next === '' ? { op: 'unset', path: at } : { op: 'set', path: at, value: next })
      }
      return ops
    }

    function stringAt(object, path) {
      let current = object
      for (const segment of path) {
        if (current === null || typeof current !== 'object') return ''
        current = current[segment]
      }
      return typeof current === 'string' ? current : typeof current === 'number' ? String(current) : ''
    }

    function messageOf(failure) {
      return failure instanceof Error ? failure.message : String(failure)
    }

    return module.exports
  },
})
