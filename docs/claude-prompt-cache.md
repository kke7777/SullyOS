# Claude 原生接口与提示词缓存

适用于支持 Anthropic `/v1/messages` 及 `cache_control` 的中转。仅入口存在不能证明缓存计费正确；实际优惠由服务商决定。

## 使用

1. 使用主动消息 2.0 的用户先在设置中更新自己的 Worker，并重新连接。当前 bundle 为 `2026-10-15.1`。
2. 设置 → API → 接口方式，选「Claude 原生接口 · 5 分钟缓存」。URL 由原先的 `https://中转/v1` 变为 `https://中转/v1/messages`；Key 与渠道模型名仍用自己的配置。保存配置。角色独立 API 有同一个选项。
3. 正常聊天，在缓存有效期内继续聊天。API 调用记录显示缓存读取与写入，均已包含在输入 token 总量中，不能再加一次。
4. 对照中转站账单检查缓存读取价与写入价。首次写入可能比普通输入贵；中途改人设、工具、历史窗口或缓存过期都会影响命中，不能保证每轮优惠。连接测试的 Hi 太短，不能拿来判断缓存是否生效。

切回「OpenAI 兼容接口」并保存即可恢复原调用方式。备份、预设和角色配置仍保存完整的 URL/Key/Model；不新增凭据副本。

## 实现

- 原生完整 endpoint 是显式选择标志。现有调用点内部仍使用 OpenAI 消息结构；`utils/claudeTransport.ts` 在网络出口转换，发送到 `/messages`，使用 `x-api-key` 和 `anthropic-version`。实际消息、人设与功能开关不被删减。
- 前端统一 fetch 出口覆盖聊天及各 App、连接测试和模型发现。模型列表地址还原为同一 base 的 `/models`。
- Worker 打包时通过 esbuild inject 将 free `fetch` 与 `globalThis.fetch` 引用绑定到同一叶子转换器；不改 `@rei-standard/*` 包、不修改 runtime 全局 fetch，不拦截普通 URL。
- 使用显式 5 分钟断点：稳定开头 system 及可复用历史末端。实时尾段不写缓存。不会定时预热或为了维持缓存额外调用模型。
- 支持会话内 system 的模型按原位置发送（遵守官方位置限制）。旧模型或不合法的 system 排列使用官方兼容层同样的 system 提升方式；稳定开头独立缓存，但实时 system 在历史之前时，不给历史加断点。这样保留 system 权限，历史缓存收益会减少。
- 图片、并行工具结果、原生 tool_use/tool_result、思考及签名续传均在边界转换。现代 Claude 的思考使用 adaptive；原生请求不自动添加中转专用的 `-thinking` 模型后缀。流式增量转为既有聊天格式，在完整 message_stop 后输出终止标记，保留末尾用量。
- `usage.prompt_tokens` 为普通输入＋缓存读取＋缓存写入的总和；缓存计数单独显示。即时对话仍沿用末轮用量标记，带工具时不代表整轮所有请求。
- 「本次发送统计」抓取转换后的真实原生请求，顶层 system 单列。
- 转换器不重发付费请求，不在原生失败时换回其它接口或模型。错误交给现有调用管线。

## 验证

`pnpm vitest run utils/claudeTransport.test.ts scripts/claude-worker-transport.test.ts`

额外回归 safeApi 流式、API 日志、角色配置、云端即时对话与 Worker fire 管线。网络使用模拟响应，不会调用真实模型或消耗用户额度。

文档：https://platform.claude.com/docs/en/build-with-claude/prompt-caching 、https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
