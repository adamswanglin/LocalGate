// 轻量中英双语：跟随系统语言（zh* → 中文，其余 → 英文），运行时不变。
// 词典 key 用点分路径；`t(key, vars)` 以 `{name}` 模板替换变量。

export type Locale = 'zh' | 'en';

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const l = (navigator.language || 'en').toLowerCase();
  return l.startsWith('zh') ? 'zh' : 'en';
}

export const locale: Locale = detectLocale();

export const isZh = locale === 'zh';

type TVars = Record<string, string | number>;

const MESSAGES: Record<string, { zh: string; en: string }> = {
  // ── 通用 ──
  'common.copy': { zh: '复制', en: 'Copy' },
  'common.copied': { zh: '已复制', en: 'Copied' },
  'common.loading': { zh: '加载中…', en: 'Loading…' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.save': { zh: '保存', en: 'Save' },
  'common.enabled': { zh: '启用', en: 'Enabled' },
  'common.disabled': { zh: '停用', en: 'Disabled' },
  'common.yes': { zh: '是', en: 'Yes' },
  'common.no': { zh: '否', en: 'No' },
  'common.saveFailed': { zh: '保存失败', en: 'Save failed' },

  // ── 应用 ──
  'app.name': { zh: 'LocalGate', en: 'LocalGate' },
  'app.tagline': { zh: 'AI 接口代理网关', en: 'AI API Proxy Gateway' },
  'nav.sources': { zh: '上游源', en: 'Sources' },
  'nav.sourcesDesc': { zh: 'AI 服务配置', en: 'AI service config' },
  'nav.channels': { zh: '对外通道', en: 'Channels' },
  'nav.channelsDesc': { zh: 'API 暴露入口', en: 'API entry points' },
  'nav.logs': { zh: '调用日志', en: 'Call Logs' },
  'nav.logsDesc': { zh: '请求记录与调试', en: 'Request history & debugging' },
  'nav.stats': { zh: '统计', en: 'Statistics' },
  'nav.statsDesc': { zh: '用量与调用统计', en: 'Usage & call stats' },

  // ── 协议 ──
  'protocol.chat': { zh: 'OpenAI Chat (/v1/chat/completions)', en: 'OpenAI Chat (/v1/chat/completions)' },
  'protocol.response': { zh: 'OpenAI Response (/v1/responses)', en: 'OpenAI Response (/v1/responses)' },
  'protocol.anthropic': { zh: 'Anthropic (/v1/messages)', en: 'Anthropic (/v1/messages)' },

  // ── 接入地址 BaseURL ──
  'baseurl.title': { zh: '接入地址 BaseURL', en: 'Endpoint BaseURL' },
  'baseurl.protocolPaths': { zh: '协议路径：', en: 'Protocol paths:' },
  'baseurl.callExample': { zh: '调用方式：POST {url}{path}，Header 携带 Authorization: Bearer <token>', en: 'Call: POST {url}{path} with header Authorization: Bearer <token>' },
  'baseurl.noAuth': { zh: '（未配置令牌，无需鉴权）', en: '(no token configured — no auth needed)' },

  // ── 上游源 Sources ──
  'sources.title': { zh: '上游源', en: 'Upstream Sources' },
  'sources.subtitle': { zh: '配置外部 AI 服务的真实地址、密钥、模型与价格（一个源可配多个协议地址）', en: 'Configure real addresses, keys, models & prices for external AI services (one source can have multiple protocol endpoints)' },
  'sources.add': { zh: '新增源', en: 'New Source' },
  'sources.statTotal': { zh: '总上游源', en: 'Total Sources' },
  'sources.statEnabled': { zh: '已启用', en: 'Enabled' },
  'sources.statDisabled': { zh: '已停用', en: 'Disabled' },
  'sources.colName': { zh: '名称', en: 'Name' },
  'sources.colEndpoints': { zh: '协议地址', en: 'Endpoints' },
  'sources.colApiKey': { zh: 'API Key', en: 'API Key' },
  'sources.colModels': { zh: '模型', en: 'Models' },
  'sources.colStatus': { zh: '状态', en: 'Status' },
  'sources.colActions': { zh: '操作', en: 'Actions' },
  'sources.empty': { zh: '暂无上游源', en: 'No sources yet' },
  'sources.emptyDesc': { zh: '点击右上角新增源来添加', en: 'Click "New Source" to add one' },
  'sources.modelsCount': { zh: '{n} 模型', en: '{n} models' },
  'sources.test': { zh: '测试', en: 'Test' },
  'sources.testPrompt': { zh: '请输入一个该上游支持的模型名用于连通测试：', en: 'Enter a model name supported by this source for connectivity test:' },
  'sources.testSuccess': { zh: '连通成功 (HTTP {status})', en: 'Connected (HTTP {status})' },
  'sources.modalEdit': { zh: '编辑源', en: 'Edit Source' },
  'sources.modalCreate': { zh: '新增源', en: 'New Source' },
  'sources.fieldName': { zh: '名称', en: 'Name' },
  'sources.fieldApiKey': { zh: 'API Key（所有协议地址共用一把）', en: 'API Key (shared by all endpoints)' },
  'sources.endpointsLabel': { zh: '协议地址（每个协议独立 Base URL，共用一把 API Key）', en: 'Endpoints (one Base URL per protocol, shared API Key)' },
  'sources.endpointsEmpty': { zh: '尚未配置协议地址，请至少添加一个。', en: 'No endpoints yet — add at least one.' },
  'sources.addEndpoint': { zh: '添加协议地址', en: 'Add Endpoint' },
  'sources.modelsLabel': { zh: '模型与价格（元/百万 token；通道绑定上游后从这些模型中选择）', en: 'Models & prices (CNY/M tokens; channels pick from these when binding)' },
  'sources.modelsEmpty': { zh: '尚未配置模型，请添加。', en: 'No models yet — add one.' },
  'sources.addModel': { zh: '添加模型', en: 'Add Model' },
  'sources.priceInput': { zh: '输入（非缓存）', en: 'Input (uncached)' },
  'sources.priceCached': { zh: '输入（缓存）', en: 'Input (cached)' },
  'sources.priceOutput': { zh: '输出', en: 'Output' },
  'sources.placeholderUrl': { zh: 'https://...', en: 'https://...' },
  'sources.placeholderModel': { zh: '上游模型名，如 doubao-seed-2.0-pro', en: 'Upstream model name, e.g. gpt-4o' },
  'sources.placeholderPrice': { zh: '元/百万', en: 'CNY/M' },
  'sources.alertNameKey': { zh: '请填写名称和 API Key', en: 'Please fill in name and API Key' },
  'sources.alertEndpoint': { zh: '请至少配置一个完整的协议地址（协议 + Base URL）', en: 'Please configure at least one complete endpoint (protocol + Base URL)' },
  'sources.confirmDelete': { zh: '确认删除该上游源？', en: 'Delete this upstream source?' },

  // ── 对外通道 Channels ──
  'channels.title': { zh: '对外通道', en: 'Channels' },
  'channels.subtitle': { zh: '对外模型 + API 类型定位通道；可配置多个上游（源+模型）并人工切换', en: 'Channels are identified by exposed model + API type; bind multiple upstreams (source+model) and switch manually' },
  'channels.add': { zh: '新增通道', en: 'New Channel' },
  'channels.statTotal': { zh: '总通道数', en: 'Total Channels' },
  'channels.statEnabled': { zh: '已启用', en: 'Enabled' },
  'channels.statProtocols': { zh: '协议类型', en: 'Protocol Types' },
  'channels.colModel': { zh: '对外模型名', en: 'Exposed Model' },
  'channels.colUpstream': { zh: '当前上游', en: 'Active Upstream' },
  'channels.colPrice': { zh: '价格 (元/百万)', en: 'Price (CNY/M)' },
  'channels.colStatus': { zh: '状态', en: 'Status' },
  'channels.colActions': { zh: '操作', en: 'Actions' },
  'channels.empty': { zh: '暂无通道', en: 'No channels yet' },
  'channels.emptyDesc': { zh: '点击右上角新增通道来添加', en: 'Click "New Channel" to add one' },
  'channels.noBinding': { zh: '无绑定', en: 'No binding' },
  'channels.switchActive': { zh: '切换当前生效的上游', en: 'Switch active upstream' },
  'channels.modalEdit': { zh: '编辑通道', en: 'Edit Channel' },
  'channels.modalCreate': { zh: '新增通道', en: 'New Channel' },
  'channels.fieldModel': { zh: '对外模型名（客户端请求 body.model 用这个）', en: 'Exposed model name (used as body.model by clients)' },
  'channels.placeholderModel': { zh: '如 gpt-4', en: 'e.g. gpt-4' },
  'channels.fieldProtocol': { zh: '入站 API 类型（上游源需已配置对应协议地址）', en: 'Inbound API type (the upstream source must have a matching protocol endpoint)' },
  'channels.bindingsLabel': { zh: '上游绑定（选择上游源 → 该源已配置的模型；单选生效）', en: 'Upstream bindings (pick source → its models; one active)' },
  'channels.bindingsWarn': { zh: '没有已配置该协议地址的上游源，请先在「上游源」添加对应协议地址并配置模型。', en: 'No upstream source has this protocol endpoint configured — add one in "Sources" first.' },
  'channels.bindingsEmpty': { zh: '尚未添加上游，请点击下方按钮。', en: 'No upstreams yet — click below to add.' },
  'channels.bindingActive': { zh: '生效', en: 'Active' },
  'channels.placeholderSelectSource': { zh: '-- 选择上游源 --', en: '-- Select source --' },
  'channels.placeholderSelectModel': { zh: '-- 选择该上游的模型 --', en: '-- Select model --' },
  'channels.placeholderSelectSourceFirst': { zh: '请先选择上游源', en: 'Select a source first' },
  'channels.addBinding': { zh: '添加上游', en: 'Add Upstream' },
  'channels.alertForm': { zh: '请填写完整：协议、对外模型名', en: 'Please fill in protocol and exposed model name' },
  'channels.alertBindings': { zh: '请至少添加一个上游绑定', en: 'Add at least one upstream binding' },
  'channels.alertBindingRows': { zh: '每个绑定都需要选择上游源和模型', en: 'Each binding needs a source and model' },
  'channels.confirmDelete': { zh: '确认删除该通道？', en: 'Delete this channel?' },
  'channels.alertSwitchFailed': { zh: '切换失败', en: 'Switch failed' },

  // ── 访问令牌 Tokens（并入对外通道页） ──
  'tokens.title': { zh: '访问令牌', en: 'Access Tokens' },
  'tokens.subtitleNone': { zh: '未配置令牌：代理开放访问，空 key 即可调用', en: 'No tokens configured: proxy is open, empty key works' },
  'tokens.subtitleSome': { zh: '已配置令牌：客户端必须携带有效令牌（Authorization: Bearer <token> 或 x-api-key）', en: 'Tokens configured: clients must send a valid token (Authorization: Bearer <token> or x-api-key)' },
  'tokens.add': { zh: '新增令牌', en: 'New Token' },
  'tokens.createdBanner': { zh: '令牌已创建（完整值仅显示这一次，请立即保存）', en: 'Token created (full value shown only once — save it now)' },
  'tokens.exampleCall': { zh: '示例调用：curl -H "Authorization: Bearer {token}" ...', en: 'Example call: curl -H "Authorization: Bearer {token}" ...' },
  'tokens.colName': { zh: '名称', en: 'Name' },
  'tokens.colToken': { zh: 'Token', en: 'Token' },
  'tokens.colStatus': { zh: '状态', en: 'Status' },
  'tokens.colCreated': { zh: '创建时间', en: 'Created' },
  'tokens.colLastUsed': { zh: '最近使用', en: 'Last Used' },
  'tokens.notUsed': { zh: '未使用', en: 'Never used' },
  'tokens.empty': { zh: '暂无令牌', en: 'No tokens' },
  'tokens.emptyDesc': { zh: '未配置时代理不鉴权，空 key 可访问', en: 'Open access when none configured' },
  'tokens.modalEdit': { zh: '编辑令牌', en: 'Edit Token' },
  'tokens.modalCreate': { zh: '新增令牌', en: 'New Token' },
  'tokens.fieldName': { zh: '名称', en: 'Name' },
  'tokens.placeholderName': { zh: '如 桌面端 / CI / 测试', en: 'e.g. Desktop / CI / Test' },
  'tokens.fieldToken': { zh: 'Token（留空自动生成）', en: 'Token (auto-generate if empty)' },
  'tokens.placeholderToken': { zh: '留空则自动生成', en: 'Leave empty to auto-generate' },
  'tokens.hintEdit': { zh: '可编辑名称或启用状态；重置 Token 请删除后新建。', en: 'You can edit name or enabled status; reset a token by deleting and recreating it.' },
  'tokens.hintCreate': { zh: '令牌用于代理接口鉴权；创建后完整值仅显示一次，请立即保存。', en: 'Tokens authenticate proxy calls; the full value is shown only once on creation.' },
  'tokens.confirmDelete': { zh: '确认删除该令牌？删除后使用此令牌的请求将无法通过。', en: 'Delete this token? Requests using it will stop working.' },
  'tokens.statTotal': { zh: '令牌数', en: 'Tokens' },
  'tokens.statEnabled': { zh: '已启用', en: 'Enabled' },
  'tokens.statDisabled': { zh: '已停用', en: 'Disabled' },
  'tokens.alertName': { zh: '请填写名称', en: 'Please enter a name' },

  // ── 调用日志 Logs ──
  'logs.title': { zh: '调用日志', en: 'Call Logs' },
  'logs.total': { zh: '共 {total} 条记录', en: '{total} records' },
  'logs.clear': { zh: '清空', en: 'Clear' },
  'logs.confirmClear': { zh: '清空全部非收藏调用日志？收藏的记录会保留。此操作不可恢复。', en: 'Clear all non-starred logs? Starred records are kept. This cannot be undone.' },
  'logs.globalConfig': { zh: '全局配置', en: 'Global Config' },
  'logs.logIo': { zh: '记录出入参', en: 'Log requests & responses' },
  'logs.logStreamBody': { zh: '捕获流式 body', en: 'Capture stream body' },
  'logs.statTotal': { zh: '总记录', en: 'Total' },
  'logs.statAvgLatency': { zh: '平均耗时', en: 'Avg Latency' },
  'logs.statErrors': { zh: '错误数', en: 'Errors' },
  'logs.statPage': { zh: '当前页', en: 'Current Page' },
  'logs.filterProtocol': { zh: '全部协议', en: 'All Protocols' },
  'logs.filterStatus': { zh: '全部状态', en: 'All Status' },
  'logs.filterOk': { zh: '成功 (<400)', en: 'Success (<400)' },
  'logs.filterError': { zh: '失败 (≥400)', en: 'Failed (≥400)' },
  'logs.filterStarred': { zh: '仅看收藏', en: 'Starred only' },
  'logs.clearFilters': { zh: '清除筛选', en: 'Clear Filters' },
  'logs.colTime': { zh: '时间', en: 'Time' },
  'logs.colStar': { zh: '收藏', en: 'Starred' },
  'logs.colChannel': { zh: '通道', en: 'Channel' },
  'logs.colProtocol': { zh: '协议', en: 'Protocol' },
  'logs.colModel': { zh: '模型', en: 'Model' },
  'logs.colTags': { zh: '标签', en: 'Tags' },
  'logs.colStream': { zh: '流式', en: 'Stream' },
  'logs.colStatus': { zh: '状态', en: 'Status' },
  'logs.colLatency': { zh: '耗时', en: 'Latency' },
  'logs.colTokens': { zh: 'Token(入/出)', en: 'Tokens (in/out)' },
  'logs.empty': { zh: '暂无日志', en: 'No logs' },
  'logs.emptyDesc': { zh: '调用接口后日志将显示在这里', en: 'Logs appear here after calls' },
  'logs.starOn': { zh: '取消收藏', en: 'Unstar' },
  'logs.starOff': { zh: '收藏', en: 'Star' },
  'logs.tagsLabel': { zh: '标签', en: 'Tags' },
  'logs.tagsPick': { zh: '选择标签（匹配任一）', en: 'Select tags (match any)' },
  'logs.tagsClear': { zh: '清除', en: 'Clear' },
  'logs.tagsNone': { zh: '暂无标签', en: 'No tags' },
  'logs.prev': { zh: '上一页', en: 'Prev' },
  'logs.next': { zh: '下一页', en: 'Next' },
  'logs.alertSaveFailed': { zh: '保存失败', en: 'Save failed' },
  'logs.alertStarFailed': { zh: '收藏失败', en: 'Star failed' },

  // ── 日志详情 LogDetail ──
  'detail.notFound': { zh: '未找到', en: 'Not found' },
  'detail.back': { zh: '返回列表', en: 'Back to list' },
  'detail.title': { zh: '日志 #{id}', en: 'Log #{id}' },
  'detail.viewFormatted': { zh: '格式化', en: 'Formatted' },
  'detail.viewRaw': { zh: '原始', en: 'Raw' },
  'detail.metaChannel': { zh: '通道', en: 'Channel' },
  'detail.metaModel': { zh: '模型', en: 'Model' },
  'detail.metaLatency': { zh: '耗时', en: 'Latency' },
  'detail.metaTime': { zh: '时间', en: 'Time' },
  'detail.metaReqLog': { zh: '入参记录', en: 'Request logged' },
  'detail.metaResLog': { zh: '出参记录', en: 'Response logged' },
  'detail.metaTokens': { zh: 'Token', en: 'Tokens' },
  'detail.metaCost': { zh: '费用', en: 'Cost' },
  'detail.metaError': { zh: '错误', en: 'Error' },
  'detail.sectionRequest': { zh: '入参 Request', en: 'Request' },
  'detail.sectionResponse': { zh: '出参 Response', en: 'Response' },
  'detail.copyBody': { zh: '复制正文', en: 'Copy body' },
  'detail.copyJson': { zh: '复制 JSON', en: 'Copy JSON' },
  'detail.chunksTitle': { zh: '解析的 chunk 序列 ({n} 条)', en: 'Parsed chunks ({n})' },
  'detail.chunksDisabled': { zh: '未启用流式 body 捕获', en: 'Stream body capture disabled' },
  'detail.rawSse': { zh: '原始 SSE 文本', en: 'Raw SSE text' },
  'detail.rawStream': { zh: '原始流式报文', en: 'Raw stream payload' },
  'detail.tagsLabel': { zh: '标签', en: 'Tags' },
  'detail.tagsPlaceholder': { zh: '添加标签…', en: 'Add tag…' },
  'detail.tagsPlaceholder2': { zh: '输入标签后回车添加…', en: 'Type a tag and press Enter…' },
  'detail.tagsSaving': { zh: '保存中…', en: 'Saving…' },
  'detail.noMessages': { zh: '无可解析的对话消息', en: 'No parseable messages' },
  'detail.noText': { zh: '未能解析出文本内容（可在「原始」视图中查看完整报文）', en: 'No text parsed (see full payload in Raw view)' },
  'detail.emptyCode': { zh: '（空）', en: '(empty)' },
  'detail.authAnthropic': { zh: 'Anthropic: 客户端用 x-api-key 鉴权，header: x-api-key: <暴露key>', en: 'Anthropic: clients authenticate with x-api-key header: x-api-key: <key>' },
  'detail.authOpenai': { zh: 'OpenAI: 客户端用 Authorization: Bearer <暴露key>', en: 'OpenAI: clients authenticate with Authorization: Bearer <key>' },

  // ── 统计 Stats ──
  'stats.title': { zh: '统计', en: 'Statistics' },
  'stats.subtitle': { zh: '上游源 / 对外通道 的 Token 与调用量统计', en: 'Token & call volume stats for sources / channels' },
  'stats.groups.day': { zh: '按天', en: 'Daily' },
  'stats.groups.month': { zh: '按月', en: 'Monthly' },
  'stats.groups.source': { zh: '按上游源', en: 'By Source' },
  'stats.groups.channel': { zh: '按通道', en: 'By Channel' },
  'stats.groups.model': { zh: '按模型', en: 'By Model' },
  'stats.seriesInput': { zh: '输入(非缓存)', en: 'Input (uncached)' },
  'stats.seriesCached': { zh: '输入(缓存)', en: 'Input (cached)' },
  'stats.seriesOutput': { zh: '输出', en: 'Output' },
  'stats.statInput': { zh: '输入 Token (不含缓存)', en: 'Input Tokens (uncached)' },
  'stats.statCached': { zh: '输入 Token (缓存)', en: 'Input Tokens (cached)' },
  'stats.statOutput': { zh: '输出 Token', en: 'Output Tokens' },
  'stats.statCalls': { zh: '调用次数', en: 'Calls' },
  'stats.statCost': { zh: '总费用 (元)', en: 'Total Cost (CNY)' },
  'stats.filterTitle': { zh: '筛选条件', en: 'Filters' },
  'stats.filterProtocol': { zh: '协议', en: 'Protocol' },
  'stats.filterAllProtocols': { zh: '全部协议', en: 'All Protocols' },
  'stats.filterSource': { zh: '上游源', en: 'Source' },
  'stats.filterAllSources': { zh: '全部上游源', en: 'All Sources' },
  'stats.filterChannel': { zh: '通道', en: 'Channel' },
  'stats.filterAllChannels': { zh: '全部通道', en: 'All Channels' },
  'stats.filterModel': { zh: '模型', en: 'Model' },
  'stats.filterModelPlaceholder': { zh: '模型名', en: 'Model name' },
  'stats.filterStart': { zh: '开始日期', en: 'Start date' },
  'stats.filterEnd': { zh: '结束日期', en: 'End date' },
  'stats.chartTrend': { zh: 'Token 趋势', en: 'Token Trend' },
  'stats.chartCompare': { zh: 'Token 对比', en: 'Token Comparison' },
  'stats.chartTrendDesc': { zh: '按时间维度查看变化趋势', en: 'View trend over time' },
  'stats.chartCompareDesc': { zh: '按分类维度对比分析', en: 'Compare across categories' },
  'stats.empty': { zh: '暂无数据', en: 'No data' },
  'stats.emptyDesc': { zh: '调整筛选条件或先产生一些调用', en: 'Adjust filters or make some calls' },
  'stats.tableTitle': { zh: '详细数据', en: 'Details' },
  'stats.tableCount': { zh: '{rows} 条记录', en: '{rows} records' },
  'stats.tableGroup': { zh: '分组', en: 'Group' },
  'stats.tableInput': { zh: '输入(非缓存)', en: 'Input (uncached)' },
  'stats.tableCached': { zh: '输入(缓存)', en: 'Input (cached)' },
  'stats.tableOutput': { zh: '输出', en: 'Output' },
  'stats.tableCalls': { zh: '调用次数', en: 'Calls' },
  'stats.tableCost': { zh: '费用 (元)', en: 'Cost (CNY)' },
  'stats.total': { zh: '合计', en: 'Total' },
  'stats.stackDim1': { zh: '上游每日用量（按上游堆叠）', en: 'Per-source daily usage (stacked by source)' },
  'stats.stackDim2': { zh: '上游·模型用量（按模型堆叠）', en: 'Source × model usage (stacked by model)' },
  'stats.stackDim3': { zh: '通道·模型用量（按模型堆叠）', en: 'Channel × model usage (stacked by model)' },
  'stats.stackDim4': { zh: '单上游·每日模型用量', en: 'Single source · daily model usage' },
  'stats.stackTitle': { zh: '堆叠分析', en: 'Stack Analysis' },
  'stats.stackDesc': { zh: '多维度构成分析', en: 'Multi-dimensional composition analysis' },
  'stats.stackToken': { zh: 'Token', en: 'Tokens' },
  'stats.stackCalls': { zh: '调用次数', en: 'Calls' },
  'stats.stackCost': { zh: '费用', en: 'Cost' },
  'stats.stackPickSource': { zh: '请选择上游', en: 'Select a source' },
  'stats.stackPickSourceDesc': { zh: '该维度需选定单个上游源', en: 'This dimension requires a single source' },
  'stats.stackEmpty': { zh: '暂无数据', en: 'No data' },
};

export function t(key: string, vars?: TVars): string {
  const entry = MESSAGES[key];
  const str = entry ? entry[locale] : key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleString(isZh ? 'zh-CN' : 'en-US', { hour12: false });
  } catch {
    return s;
  }
}

export function fmtMoney(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '¥0';
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return `¥${s}`;
}

// 供组件使用；locale 运行时不变，返回稳定引用即可
export function useI18n() {
  return { t, locale, isZh, fmtDate, fmtMoney };
}
