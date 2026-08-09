// 轻量多语：跟随系统语言（可被用户选择覆盖）。
// 词典 key 用点分路径；`t(key, vars)` 以 `{name}` 模板替换变量。
// locale 运行时可在 i18n-provider 中切换：`currentLocale` 是模块级镜像，
// 由 Provider 在 render 期间同步写回，`t()` 始终读取最新值。

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';
export type LocaleSetting = Locale | 'auto'; // 'auto' = 跟随系统

export const LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
export const DEFAULT_SETTING: LocaleSetting = 'auto';

const STORAGE_KEY = 'localgate.locale';

// 语种选项（各语种用自身母语名展示；'auto' 单独走 t('lang.auto')）
export const LANGUAGES: { value: LocaleSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

// 取得操作系统 / 浏览器的首选语言列表。
// Electron 桌面壳里优先用主进程暴露的 app.getPreferredSystemLanguages()，
// 否则回退 navigator.languages —— 修复「中文系统却显示英文」的问题。
export function getSystemLanguages(): string[] {
  if (typeof window !== 'undefined') {
    const an = (window as any).appNative;
    if (an && typeof an.systemLanguages === 'function') {
      try {
        const ls = an.systemLanguages();
        if (Array.isArray(ls) && ls.length) return ls.map((x: unknown) => String(x));
      } catch { /* ignore */ }
    }
  }
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages) && navigator.languages.length) {
      return navigator.languages.map((x) => String(x));
    }
    if (navigator.language) return [navigator.language];
  }
  return ['en'];
}

export function detectLocale(): Locale {
  for (const raw of getSystemLanguages()) {
    const l = String(raw || '').toLowerCase();
    if (!l) continue;
    if (l.startsWith('zh')) {
      if (
        l.includes('hant') || l.includes('tw') || l.includes('hk') ||
        l.includes('mo') || l.includes('taiwan') || l.includes('hong kong') || l.includes('macau')
      ) {
        return 'zh-TW';
      }
      return 'zh-CN';
    }
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
  }
  return 'en';
}

export function resolveLocale(setting: LocaleSetting): Locale {
  return setting === 'auto' ? detectLocale() : setting;
}

// ── 模块级当前 locale 镜像（由 I18nProvider 同步更新） ──
let currentLocale: Locale = detectLocale();
export function setLocaleMirror(l: Locale): void {
  currentLocale = l;
}
export function getLocale(): Locale {
  return currentLocale;
}

// ── 持久化 ──
export function loadLocaleSetting(): LocaleSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (v === 'auto' || (LOCALES as string[]).includes(v))) return v as LocaleSetting;
  } catch { /* ignore */ }
  return DEFAULT_SETTING;
}
export function saveLocaleSetting(s: LocaleSetting): void {
  try { localStorage.setItem(STORAGE_KEY, s); } catch { /* ignore */ }
}

type TVars = Record<string, string | number>;
type Entry = Partial<Record<Locale, string>>;

const MESSAGES: Record<string, Entry> = {
  // ── 通用 ──
  'common.copy': { 'zh-CN': '复制', 'zh-TW': '複製', en: 'Copy', ja: 'コピー', ko: '복사' },
  'common.copied': { 'zh-CN': '已复制', 'zh-TW': '已複製', en: 'Copied', ja: 'コピーしました', ko: '복사됨' },
  'common.loading': { 'zh-CN': '加载中…', 'zh-TW': '載入中…', en: 'Loading…', ja: '読み込み中…', ko: '불러오는 중…' },
  'common.cancel': { 'zh-CN': '取消', 'zh-TW': '取消', en: 'Cancel', ja: 'キャンセル', ko: '취소' },
  'common.save': { 'zh-CN': '保存', 'zh-TW': '儲存', en: 'Save', ja: '保存', ko: '저장' },
  'common.enabled': { 'zh-CN': '启用', 'zh-TW': '啟用', en: 'Enabled', ja: '有効', ko: '활성화' },
  'common.disabled': { 'zh-CN': '停用', 'zh-TW': '停用', en: 'Disabled', ja: '無効', ko: '비활성화' },
  'common.yes': { 'zh-CN': '是', 'zh-TW': '是', en: 'Yes', ja: 'はい', ko: '예' },
  'common.no': { 'zh-CN': '否', 'zh-TW': '否', en: 'No', ja: 'いいえ', ko: '아니오' },
  'common.saveFailed': { 'zh-CN': '保存失败', 'zh-TW': '儲存失敗', en: 'Save failed', ja: '保存に失敗しました', ko: '저장 실패' },

  // ── 应用 ──
  'app.name': { 'zh-CN': 'LocalGate', 'zh-TW': 'LocalGate', en: 'LocalGate', ja: 'LocalGate', ko: 'LocalGate' },
  'app.tagline': { 'zh-CN': 'AI 接口代理网关', 'zh-TW': 'AI 介面代理閘道', en: 'AI API Proxy Gateway', ja: 'AI API プロキシゲートウェイ', ko: 'AI API 프록시 게이트웨이' },
  'nav.sources': { 'zh-CN': '上游源', 'zh-TW': '上游源', en: 'Sources', ja: '上流ソース', ko: '업스트림 소스' },
  'nav.sourcesDesc': { 'zh-CN': 'AI 服务配置', 'zh-TW': 'AI 服務設定', en: 'AI service config', ja: 'AI サービス設定', ko: 'AI 서비스 설정' },
  'nav.modelEntries': { 'zh-CN': '模型入口', 'zh-TW': '模型入口', en: 'Model Entries', ja: 'モデルエントリ', ko: '모델 엔트리' },
  'nav.modelEntriesDesc': { 'zh-CN': 'API 暴露入口', 'zh-TW': 'API 暴露入口', en: 'API entry points', ja: 'API 公開エントリ', ko: 'API 노출 엔트리' },
  'nav.logs': { 'zh-CN': '调用日志', 'zh-TW': '呼叫日誌', en: 'Call Logs', ja: 'コールログ', ko: '호출 로그' },
  'nav.logsDesc': { 'zh-CN': '请求记录与调试', 'zh-TW': '請求記錄與除錯', en: 'Request history & debugging', ja: 'リクエスト履歴とデバッグ', ko: '요청 기록 및 디버깅' },
  'nav.stats': { 'zh-CN': '统计', 'zh-TW': '統計', en: 'Statistics', ja: '統計', ko: '통계' },
  'nav.statsDesc': { 'zh-CN': '用量与调用统计', 'zh-TW': '用量與呼叫統計', en: 'Usage & call stats', ja: '使用量と呼び出し統計', ko: '사용량 및 호출 통계' },

  // ── 协议 ──
  'protocol.chat': { en: 'OpenAI Chat (/v1/chat/completions)', 'zh-CN': 'OpenAI Chat (/v1/chat/completions)', 'zh-TW': 'OpenAI Chat (/v1/chat/completions)', ja: 'OpenAI Chat (/v1/chat/completions)', ko: 'OpenAI Chat (/v1/chat/completions)' },
  'protocol.response': { en: 'OpenAI Response (/v1/responses)', 'zh-CN': 'OpenAI Response (/v1/responses)', 'zh-TW': 'OpenAI Response (/v1/responses)', ja: 'OpenAI Response (/v1/responses)', ko: 'OpenAI Response (/v1/responses)' },
  'protocol.anthropic': { en: 'Anthropic (/v1/messages)', 'zh-CN': 'Anthropic (/v1/messages)', 'zh-TW': 'Anthropic (/v1/messages)', ja: 'Anthropic (/v1/messages)', ko: 'Anthropic (/v1/messages)' },

  // ── 接入地址 BaseURL ──
  'baseurl.title': { 'zh-CN': '接入地址 BaseURL', 'zh-TW': '接入位址 BaseURL', en: 'Endpoint BaseURL', ja: 'エンドポイント BaseURL', ko: '엔드포인트 BaseURL' },
  'baseurl.protocolPaths': { 'zh-CN': '协议路径：', 'zh-TW': '協議路徑：', en: 'Protocol paths:', ja: 'プロトコルパス:', ko: '프로토콜 경로:' },
  'baseurl.callExample': { 'zh-CN': '调用方式：POST {url}{path}，Header 携带 Authorization: Bearer <token>', 'zh-TW': '呼叫方式：POST {url}{path}，Header 攜帶 Authorization: Bearer <token>', en: 'Call: POST {url}{path} with header Authorization: Bearer <token>', ja: '呼び出し：POST {url}{path}、ヘッダー Authorization: Bearer <token>', ko: '호출: POST {url}{path}, 헤더 Authorization: Bearer <token>' },
  'baseurl.noAuth': { 'zh-CN': '（未配置令牌，无需鉴权）', 'zh-TW': '（未設定權杖，無需鑑權）', en: '(no token configured — no auth needed)', ja: '（トークン未設定・認証不要）', ko: '（토큰 미설정 — 인증 불필요）' },

  // ── 上游源 Sources ──
  'sources.title': { 'zh-CN': '上游源', 'zh-TW': '上游源', en: 'Upstream Sources', ja: '上流ソース', ko: '업스트림 소스' },
  'sources.subtitle': { 'zh-CN': '配置外部 AI 服务的真实地址、密钥、模型与价格（一个源可配多个协议地址）', 'zh-TW': '設定外部 AI 服務的真實位址、金鑰、模型與價格（一個源可設多個協議位址）', en: 'Configure real addresses, keys, models & prices for external AI services (one source can have multiple protocol endpoints)', ja: '外部 AI サービスの実際のアドレス、キー、モデル、価格を設定（1ソースに複数プロトコルを設定可能）', ko: '외부 AI 서비스의 실제 주소, 키, 모델, 가격을 설정 (하나의 소스에 여러 프로토콜 엔드포인트 설정 가능)' },
  'sources.add': { 'zh-CN': '新增源', 'zh-TW': '新增源', en: 'New Source', ja: 'ソース追加', ko: '소스 추가' },
  'sources.statTotal': { 'zh-CN': '总上游源', 'zh-TW': '總上游源', en: 'Total Sources', ja: 'ソース合計', ko: '전체 소스' },
  'sources.statEnabled': { 'zh-CN': '已启用', 'zh-TW': '已啟用', en: 'Enabled', ja: '有効', ko: '활성화' },
  'sources.statDisabled': { 'zh-CN': '已停用', 'zh-TW': '已停用', en: 'Disabled', ja: '無効', ko: '비활성화' },
  'sources.colName': { 'zh-CN': '名称', 'zh-TW': '名稱', en: 'Name', ja: '名前', ko: '이름' },
  'sources.colEndpoints': { 'zh-CN': '协议地址', 'zh-TW': '協議位址', en: 'Endpoints', ja: 'エンドポイント', ko: '엔드포인트' },
  'sources.colApiKey': { en: 'API Key', 'zh-CN': 'API Key', 'zh-TW': 'API Key', ja: 'API Key', ko: 'API Key' },
  'sources.colModels': { 'zh-CN': '模型', 'zh-TW': '模型', en: 'Models', ja: 'モデル', ko: '모델' },
  'sources.colStatus': { 'zh-CN': '状态', 'zh-TW': '狀態', en: 'Status', ja: 'ステータス', ko: '상태' },
  'sources.colActions': { 'zh-CN': '操作', 'zh-TW': '操作', en: 'Actions', ja: '操作', ko: '작업' },
  'sources.empty': { 'zh-CN': '暂无上游源', 'zh-TW': '暫無上游源', en: 'No sources yet', ja: 'ソースがありません', ko: '소스가 없습니다' },
  'sources.emptyDesc': { 'zh-CN': '点击右上角新增源来添加', 'zh-TW': '點擊右上角新增源來新增', en: 'Click "New Source" to add one', ja: '右上の「ソース追加」をクリックして追加', ko: '우측 상단 "소스 추가"를 눌러 추가' },
  'sources.modelsCount': { 'zh-CN': '{n} 模型', 'zh-TW': '{n} 模型', en: '{n} models', ja: '{n} モデル', ko: '{n} 모델' },
  'sources.test': { 'zh-CN': '测试', 'zh-TW': '測試', en: 'Test', ja: 'テスト', ko: '테스트' },
  'sources.testPrompt': { 'zh-CN': '请输入一个该上游支持的模型名用于连通测试：', 'zh-TW': '請輸入一個該上游支援的模型名用於連通測試：', en: 'Enter a model name supported by this source for connectivity test:', ja: 'この上流が対応するモデル名を入力して接続テスト：', ko: '이 업스트림이 지원하는 모델 이름을 입력해 연결 테스트:' },
  'sources.testSuccess': { 'zh-CN': '连通成功 (HTTP {status})', 'zh-TW': '連通成功 (HTTP {status})', en: 'Connected (HTTP {status})', ja: '接続成功 (HTTP {status})', ko: '연결 성공 (HTTP {status})' },
  'sources.modalEdit': { 'zh-CN': '编辑源', 'zh-TW': '編輯源', en: 'Edit Source', ja: 'ソース編集', ko: '소스 편집' },
  'sources.modalCreate': { 'zh-CN': '新增源', 'zh-TW': '新增源', en: 'New Source', ja: 'ソース追加', ko: '소스 추가' },
  'sources.fieldName': { 'zh-CN': '名称', 'zh-TW': '名稱', en: 'Name', ja: '名前', ko: '이름' },
  'sources.fieldApiKey': { 'zh-CN': 'API Key（所有协议地址共用一把）', 'zh-TW': 'API Key（所有協議位址共用一把）', en: 'API Key (shared by all endpoints)', ja: 'API Key（全エンドポイント共通）', ko: 'API Key (모든 엔드포인트 공통)' },
  'sources.endpointsLabel': { 'zh-CN': '协议地址（每个协议独立 Base URL，共用一把 API Key）', 'zh-TW': '協議位址（每個協議獨立 Base URL，共用一把 API Key）', en: 'Endpoints (one Base URL per protocol, shared API Key)', ja: 'エンドポイント（プロトコルごとに Base URL、API Key は共通）', ko: '엔드포인트 (프로토콜별 Base URL, API Key 공통)' },
  'sources.endpointsEmpty': { 'zh-CN': '尚未配置协议地址，请至少添加一个。', 'zh-TW': '尚未設定協議位址，請至少新增一個。', en: 'No endpoints yet — add at least one.', ja: 'エンドポイント未設定・少なくとも1つ追加してください。', ko: '엔드포인트가 없습니다 — 최소 하나를 추가하세요.' },
  'sources.addEndpoint': { 'zh-CN': '添加协议地址', 'zh-TW': '新增協議位址', en: 'Add Endpoint', ja: 'エンドポイント追加', ko: '엔드포인트 추가' },
  'sources.modelsLabel': { 'zh-CN': '模型与价格（元/百万 token；模型入口绑定上游后从这些模型中选择）', 'zh-TW': '模型與價格（元/百萬 token；模型入口綁定上游後從這些模型中選擇）', en: 'Models & prices (CNY/M tokens; model entries pick from these when binding)', ja: 'モデルと価格（元/百万トークン、モデルエントリは上流バインド時にここから選択）', ko: '모델 및 가격 (위안/백만 토큰; 모델 엔트리는 업스트림 바인딩 시 여기서 선택)' },
  'sources.modelsEmpty': { 'zh-CN': '尚未配置模型，请添加。', 'zh-TW': '尚未設定模型，請新增。', en: 'No models yet — add one.', ja: 'モデル未設定・追加してください。', ko: '모델이 없습니다 — 추가하세요.' },
  'sources.addModel': { 'zh-CN': '添加模型', 'zh-TW': '新增模型', en: 'Add Model', ja: 'モデル追加', ko: '모델 추가' },
  'sources.priceInput': { 'zh-CN': '输入（非缓存）', 'zh-TW': '輸入（非快取）', en: 'Input (uncached)', ja: '入力（非キャッシュ）', ko: '입력 (캐시 미사용)' },
  'sources.priceCached': { 'zh-CN': '输入（缓存）', 'zh-TW': '輸入（快取）', en: 'Input (cached)', ja: '入力（キャッシュ）', ko: '입력 (캐시)' },
  'sources.priceOutput': { 'zh-CN': '输出', 'zh-TW': '輸出', en: 'Output', ja: '出力', ko: '출력' },
  'sources.placeholderUrl': { en: 'https://...', 'zh-CN': 'https://...', 'zh-TW': 'https://...', ja: 'https://...', ko: 'https://...' },
  'sources.placeholderModel': { 'zh-CN': '上游模型名，如 doubao-seed-2.0-pro', 'zh-TW': '上游模型名，如 doubao-seed-2.0-pro', en: 'Upstream model name, e.g. gpt-4o', ja: '上流モデル名（例: gpt-4o）', ko: '업스트림 모델명, 예: gpt-4o' },
  'sources.placeholderPrice': { 'zh-CN': '元/百万', 'zh-TW': '元/百萬', en: 'CNY/M', ja: '元/百万', ko: '위안/백만' },
  'sources.alertNameKey': { 'zh-CN': '请填写名称和 API Key', 'zh-TW': '請填寫名稱和 API Key', en: 'Please fill in name and API Key', ja: '名前と API Key を入力してください', ko: '이름과 API Key를 입력하세요' },
  'sources.alertEndpoint': { 'zh-CN': '请至少配置一个完整的协议地址（协议 + Base URL）', 'zh-TW': '請至少設定一個完整的協議位址（協議 + Base URL）', en: 'Please configure at least one complete endpoint (protocol + Base URL)', ja: '完全なエンドポイント（プロトコル + Base URL）を少なくとも1つ設定してください', ko: '최소 하나의 완전한 엔드포인트(프로토콜 + Base URL)를 설정하세요' },
  'sources.confirmDelete': { 'zh-CN': '确认删除该上游源？', 'zh-TW': '確認刪除該上游源？', en: 'Delete this upstream source?', ja: 'この上流ソースを削除しますか？', ko: '이 업스트림 소스를 삭제하시겠습니까?' },

  // ── 模型入口 Model Entries ──
  'modelEntries.title': { 'zh-CN': '模型入口', 'zh-TW': '模型入口', en: 'Model Entries', ja: 'モデルエントリ', ko: '모델 엔트리' },
  'modelEntries.subtitle': { 'zh-CN': '一个对外模型 ID 可配置多个 API 类型，每个类型可绑定多个上游并人工切换', 'zh-TW': '一個對外模型 ID 可設定多個 API 類型，每個類型可綁定多個上游並手動切換', en: 'One exposed model ID can serve multiple API types; each type binds multiple upstreams you can switch manually', ja: '1つの公開モデル ID に複数の API タイプを設定可能、各タイプは複数の上流をバインドし手動切替可', ko: '하나의 노출 모델 ID에 여러 API 타입을 설정 가능, 각 타입은 여러 업스트림을 바인딩해 수동 전환' },
  'modelEntries.add': { 'zh-CN': '新增入口', 'zh-TW': '新增入口', en: 'New Entry', ja: 'エントリ追加', ko: '엔트리 추가' },
  'modelEntries.statTotal': { 'zh-CN': '总入口数', 'zh-TW': '總入口數', en: 'Total Entries', ja: 'エントリ合計', ko: '전체 엔트리' },
  'modelEntries.statEnabled': { 'zh-CN': '已启用', 'zh-TW': '已啟用', en: 'Enabled', ja: '有効', ko: '활성화' },
  'modelEntries.statProtocols': { 'zh-CN': '协议类型', 'zh-TW': '協議類型', en: 'Protocol Types', ja: 'プロトコルタイプ', ko: '프로토콜 타입' },
  'modelEntries.tabTokens': { en: 'AccessToken', 'zh-CN': 'AccessToken', 'zh-TW': 'AccessToken', ja: 'AccessToken', ko: 'AccessToken' },
  'modelEntries.tabModel': { en: 'Model', 'zh-CN': 'Model', 'zh-TW': 'Model', ja: 'Model', ko: 'Model' },
  'modelEntries.newModel': { 'zh-CN': '新增模型', 'zh-TW': '新增模型', en: 'New Model', ja: 'モデル追加', ko: '모델 추가' },
  'modelEntries.editGroup': { 'zh-CN': '编辑', 'zh-TW': '編輯', en: 'Edit', ja: '編集', ko: '편집' },
  'modelEntries.deleteGroup': { 'zh-CN': '删除模型', 'zh-TW': '刪除模型', en: 'Delete model', ja: 'モデル削除', ko: '모델 삭제' },
  'modelEntries.confirmDeleteGroup': { 'zh-CN': '确认删除该模型？将移除其所有 API 类型与上游绑定。', 'zh-TW': '確認刪除該模型？將移除其所有 API 類型與上游綁定。', en: 'Delete this model? All its API types and upstream bindings will be removed.', ja: 'このモデルを削除しますか？すべての API タイプと上流バインドが削除されます。', ko: '이 모델을 삭제하시겠습니까? 모든 API 타입과 업스트림 바인딩이 제거됩니다.' },
  'modelEntries.colModel': { 'zh-CN': '对外模型名', 'zh-TW': '對外模型名', en: 'Exposed Model', ja: '公開モデル', ko: '노출 모델' },
  'modelEntries.colUpstream': { 'zh-CN': '当前上游', 'zh-TW': '當前上游', en: 'Active Upstream', ja: '現在の上流', ko: '활성 업스트림' },
  'modelEntries.colPrice': { 'zh-CN': '价格 (元/百万)', 'zh-TW': '價格 (元/百萬)', en: 'Price (CNY/M)', ja: '価格 (元/百万)', ko: '가격 (위안/백만)' },
  'modelEntries.colStatus': { 'zh-CN': '状态', 'zh-TW': '狀態', en: 'Status', ja: 'ステータス', ko: '상태' },
  'modelEntries.colActions': { 'zh-CN': '操作', 'zh-TW': '操作', en: 'Actions', ja: '操作', ko: '작업' },
  'modelEntries.empty': { 'zh-CN': '暂无模型', 'zh-TW': '暫無模型', en: 'No models yet', ja: 'モデルがありません', ko: '모델이 없습니다' },
  'modelEntries.emptyDesc': { 'zh-CN': '点击「新增模型」来添加一个对外模型 ID', 'zh-TW': '點擊「新增模型」來新增一個對外模型 ID', en: 'Click "New Model" to add an exposed model ID', ja: '「モデル追加」をクリックして公開モデル ID を追加', ko: '"모델 추가"를 눌러 노출 모델 ID를 추가' },
  'modelEntries.noBinding': { 'zh-CN': '无绑定', 'zh-TW': '無綁定', en: 'No binding', ja: 'バインドなし', ko: '바인딩 없음' },
  'modelEntries.switchActive': { 'zh-CN': '切换当前生效的上游', 'zh-TW': '切換當前生效的上游', en: 'Switch active upstream', ja: '現在の有効な上流を切替', ko: '활성 업스트림 전환' },
  'modelEntries.modalEdit': { 'zh-CN': '编辑模型', 'zh-TW': '編輯模型', en: 'Edit Model', ja: 'モデル編集', ko: '모델 편집' },
  'modelEntries.modalCreate': { 'zh-CN': '新增模型', 'zh-TW': '新增模型', en: 'New Model', ja: 'モデル追加', ko: '모델 추가' },
  'modelEntries.fieldName': { 'zh-CN': '名称（可选）', 'zh-TW': '名稱（可選）', en: 'Name (optional)', ja: '名前（任意）', ko: '이름 (선택)' },
  'modelEntries.placeholderName': { 'zh-CN': '如 对外聊天入口', 'zh-TW': '如 對外聊天入口', en: 'e.g. Chat Gateway', ja: '例: チャットゲートウェイ', ko: '예: 챗 게이트웨이' },
  'modelEntries.fieldModel': { 'zh-CN': '对外暴露的模型 ID（客户端请求 body.model 用这个）', 'zh-TW': '對外暴露的模型 ID（客戶端請求 body.model 用這個）', en: 'Exposed model ID (used as body.model by clients)', ja: '公開モデル ID（クライアントの body.model に使用）', ko: '노출 모델 ID (클라이언트의 body.model에 사용)' },
  'modelEntries.placeholderModel': { en: 'e.g. gpt-4', 'zh-CN': '如 gpt-4', 'zh-TW': '如 gpt-4', ja: '例: gpt-4', ko: '예: gpt-4' },
  'modelEntries.fieldApiTypes': { 'zh-CN': 'API 类型（每个类型可配多个上游）', 'zh-TW': 'API 類型（每個類型可設多個上游）', en: 'API types (each can bind multiple upstreams)', ja: 'API タイプ（各タイプに複数上流を設定可）', ko: 'API 타입 (각 타입에 여러 업스트림 설정 가능)' },
  'modelEntries.fieldApiTypesHint': { 'zh-CN': '默认展示全部三类；未配置上游的类型不会保存。', 'zh-TW': '預設展示全部三類；未設定上游的類型不會儲存。', en: 'All three types are shown by default; types with no upstream configured are not saved.', ja: 'デフォルトで3タイプ表示、上流未設定のタイプは保存されません。', ko: '기본적으로 세 타입 모두 표시; 업스트림이 설정되지 않은 타입은 저장되지 않습니다.' },
  'modelEntries.typeUnconfigured': { 'zh-CN': '未配置（留空不保存）', 'zh-TW': '未設定（留空不儲存）', en: 'Not configured (left empty — not saved)', ja: '未設定（空欄は保存されません）', ko: '미설정 (빈 칸은 저장 안 됨)' },
  'modelEntries.legacyNoName': { 'zh-CN': '（旧入口·未命名，建议删除或编辑补全）', 'zh-TW': '（舊入口·未命名，建議刪除或編輯補全）', en: '(legacy entry · unnamed — delete or edit to set a model ID)', ja: '（旧エントリ・名前なし、削除または編集でモデル ID を設定してください）', ko: '(기존 엔트리 · 이름 없음 — 삭제하거나 편집해 모델 ID 설정)' },
  'modelEntries.fieldProtocol': { 'zh-CN': '入站 API 类型（上游源需已配置对应协议地址）', 'zh-TW': '入站 API 類型（上游源需已設定對應協議位址）', en: 'Inbound API type (the upstream source must have a matching protocol endpoint)', ja: 'インバウンド API タイプ（上流ソースに対応するプロトコルエンドポイントが必要）', ko: '인바운드 API 타입 (업스트림 소스에 일치하는 프로토콜 엔드포인트 필요)' },
  'modelEntries.bindingsLabel': { 'zh-CN': '上游绑定（选择上游源 → 该源已配置的模型；单选生效）', 'zh-TW': '上游綁定（選擇上游源 → 該源已設定的模型；單選生效）', en: 'Upstream bindings (pick source → its models; one active)', ja: '上流バインド（ソース選択 → そのモデル、1つ有効）', ko: '업스트림 바인딩 (소스 선택 → 해당 모델; 하나 활성)' },
  'modelEntries.bindingsWarn': { 'zh-CN': '没有已配置该协议地址的上游源，请先在「上游源」添加对应协议地址并配置模型。', 'zh-TW': '沒有已設定該協議位址的上游源，請先在「上游源」新增對應協議位址並設定模型。', en: 'No upstream source has this protocol endpoint configured — add one in "Sources" first.', ja: 'このプロトコルエンドポイントを持つ上流ソースがありません — 先に「ソース」で追加してください。', ko: '이 프로토콜 엔드포인트를 가진 업스트림 소스가 없습니다 — 먼저 "소스"에서 추가하세요.' },
  'modelEntries.bindingsEmpty': { 'zh-CN': '尚未添加上游，请点击下方按钮。', 'zh-TW': '尚未新增上游，請點擊下方按鈕。', en: 'No upstreams yet — click below to add.', ja: '上流未追加、下のボタンをクリック。', ko: '업스트림 없음 — 아래 버튼을 클릭해 추가.' },
  'modelEntries.bindingActive': { 'zh-CN': '生效', 'zh-TW': '生效', en: 'Active', ja: '有効', ko: '활성' },
  'modelEntries.placeholderSelectSource': { 'zh-CN': '-- 选择上游源 --', 'zh-TW': '-- 選擇上游源 --', en: '-- Select source --', ja: '-- ソースを選択 --', ko: '-- 소스 선택 --' },
  'modelEntries.placeholderSelectModel': { 'zh-CN': '-- 选择该上游的模型 --', 'zh-TW': '-- 選擇該上游的模型 --', en: '-- Select model --', ja: '-- モデルを選択 --', ko: '-- 모델 선택 --' },
  'modelEntries.placeholderSelectSourceFirst': { 'zh-CN': '请先选择上游源', 'zh-TW': '請先選擇上游源', en: 'Select a source first', ja: '先にソースを選択', ko: '먼저 소스를 선택' },
  'modelEntries.addBinding': { 'zh-CN': '添加上游', 'zh-TW': '新增上游', en: 'Add Upstream', ja: '上流追加', ko: '업스트림 추가' },
  'modelEntries.alertForm': { 'zh-CN': '请填写对外模型 ID', 'zh-TW': '請填寫對外模型 ID', en: 'Please fill in the exposed model ID', ja: '公開モデル ID を入力してください', ko: '노출 모델 ID를 입력하세요' },
  'modelEntries.alertBindings': { 'zh-CN': '请至少添加一个上游绑定', 'zh-TW': '請至少新增一個上游綁定', en: 'Add at least one upstream binding', ja: '少なくとも1つの上流バインドを追加', ko: '최소 하나의 업스트림 바인딩을 추가' },
  'modelEntries.alertBindingRows': { 'zh-CN': '每个绑定都需要选择上游源和模型', 'zh-TW': '每個綁定都需要選擇上游源和模型', en: 'Each binding needs a source and model', ja: '各バインドにソースとモデルを選択', ko: '각 바인딩마다 소스와 모델을 선택' },
  'modelEntries.confirmDelete': { 'zh-CN': '确认删除该模型入口？', 'zh-TW': '確認刪除該模型入口？', en: 'Delete this model entry?', ja: 'このモデルエントリを削除しますか？', ko: '이 모델 엔트리를 삭제하시겠습니까?' },
  'modelEntries.alertSwitchFailed': { 'zh-CN': '切换失败', 'zh-TW': '切換失敗', en: 'Switch failed', ja: '切替失敗', ko: '전환 실패' },

  // ── 访问令牌 Tokens ──
  'tokens.title': { 'zh-CN': '访问令牌', 'zh-TW': '存取權杖', en: 'Access Tokens', ja: 'アクセストークン', ko: '액세스 토큰' },
  'tokens.subtitleNone': { 'zh-CN': '未配置令牌：代理开放访问，空 key 即可调用', 'zh-TW': '未設定權杖：代理開放存取，空 key 即可呼叫', en: 'No tokens configured: proxy is open, empty key works', ja: 'トークン未設定：プロキシはオープン、空キーで呼び出し可', ko: '토큰 미설정: 프록시 개방, 빈 키로 호출 가능' },
  'tokens.subtitleSome': { 'zh-CN': '已配置令牌：客户端必须携带有效令牌（Authorization: Bearer <token> 或 x-api-key）', 'zh-TW': '已設定權杖：客戶端必須攜帶有效權杖（Authorization: Bearer <token> 或 x-api-key）', en: 'Tokens configured: clients must send a valid token (Authorization: Bearer <token> or x-api-key)', ja: 'トークン設定済み：クライアントは有効なトークン必須（Authorization: Bearer <token> または x-api-key）', ko: '토큰 설정됨: 클라이언트는 유효한 토큰 필수 (Authorization: Bearer <token> 또는 x-api-key)' },
  'tokens.add': { 'zh-CN': '新增令牌', 'zh-TW': '新增權杖', en: 'New Token', ja: 'トークン追加', ko: '토큰 추가' },
  'tokens.createdBanner': { 'zh-CN': '令牌已创建（完整值仅显示这一次，请立即保存）', 'zh-TW': '權杖已建立（完整值僅顯示這一次，請立即儲存）', en: 'Token created (full value shown only once — save it now)', ja: 'トークン作成済み（完全な値は今回のみ表示、今すぐ保存）', ko: '토큰 생성됨 (전체 값은 한 번만 표시 — 지금 저장)' },
  'tokens.exampleCall': { 'zh-CN': '示例调用：curl -H "Authorization: Bearer {token}" ...', 'zh-TW': '範例呼叫：curl -H "Authorization: Bearer {token}" ...', en: 'Example call: curl -H "Authorization: Bearer {token}" ...', ja: '呼び出し例: curl -H "Authorization: Bearer {token}" ...', ko: '호출 예: curl -H "Authorization: Bearer {token}" ...' },
  'tokens.colName': { 'zh-CN': '名称', 'zh-TW': '名稱', en: 'Name', ja: '名前', ko: '이름' },
  'tokens.colToken': { en: 'Token', 'zh-CN': 'Token', 'zh-TW': 'Token', ja: 'Token', ko: 'Token' },
  'tokens.colStatus': { 'zh-CN': '状态', 'zh-TW': '狀態', en: 'Status', ja: 'ステータス', ko: '상태' },
  'tokens.colCreated': { 'zh-CN': '创建时间', 'zh-TW': '建立時間', en: 'Created', ja: '作成', ko: '생성' },
  'tokens.colLastUsed': { 'zh-CN': '最近使用', 'zh-TW': '最近使用', en: 'Last Used', ja: '最終使用', ko: '최종 사용' },
  'tokens.notUsed': { 'zh-CN': '未使用', 'zh-TW': '未使用', en: 'Never used', ja: '未使用', ko: '미사용' },
  'tokens.empty': { 'zh-CN': '暂无令牌', 'zh-TW': '暫無權杖', en: 'No tokens', ja: 'トークンなし', ko: '토큰 없음' },
  'tokens.emptyDesc': { 'zh-CN': '未配置时代理不鉴权，空 key 可访问', 'zh-TW': '未設定時代理不鑑權，空 key 可存取', en: 'Open access when none configured', ja: '未設定時は認証なし、空キーでアクセス可', ko: '미설정 시 인증 없음, 빈 키로 접근 가능' },
  'tokens.modalEdit': { 'zh-CN': '编辑令牌', 'zh-TW': '編輯權杖', en: 'Edit Token', ja: 'トークン編集', ko: '토큰 편집' },
  'tokens.modalCreate': { 'zh-CN': '新增令牌', 'zh-TW': '新增權杖', en: 'New Token', ja: 'トークン追加', ko: '토큰 추가' },
  'tokens.fieldName': { 'zh-CN': '名称', 'zh-TW': '名稱', en: 'Name', ja: '名前', ko: '이름' },
  'tokens.placeholderName': { 'zh-CN': '如 桌面端 / CI / 测试', 'zh-TW': '如 桌面端 / CI / 測試', en: 'e.g. Desktop / CI / Test', ja: '例: デスクトップ / CI / テスト', ko: '예: 데스크톱 / CI / 테스트' },
  'tokens.fieldToken': { 'zh-CN': 'Token（留空自动生成）', 'zh-TW': 'Token（留空自動生成）', en: 'Token (auto-generate if empty)', ja: 'Token（空欄で自動生成）', ko: 'Token (빈 칸 시 자동 생성)' },
  'tokens.placeholderToken': { 'zh-CN': '留空则自动生成', 'zh-TW': '留空則自動生成', en: 'Leave empty to auto-generate', ja: '空欄で自動生成', ko: '빈 칸 시 자동 생성' },
  'tokens.hintEdit': { 'zh-CN': '可编辑名称或启用状态；重置 Token 请删除后新建。', 'zh-TW': '可編輯名稱或啟用狀態；重置 Token 請刪除後新建。', en: 'You can edit name or enabled status; reset a token by deleting and recreating it.', ja: '名前や有効状態を編集可、Token のリセットは削除して再作成。', ko: '이름이나 활성화 상태 편집 가능, Token 재설정은 삭제 후 재생성.' },
  'tokens.hintCreate': { 'zh-CN': '令牌用于代理接口鉴权；创建后完整值仅显示一次，请立即保存。', 'zh-TW': '權杖用於代理介面鑑權；建立後完整值僅顯示一次，請立即儲存。', en: 'Tokens authenticate proxy calls; the full value is shown only once on creation.', ja: 'トークンはプロキシ呼び出しの認証に使用、作成後は一度だけ表示。', ko: '토큰은 프록시 호출 인증에 사용, 생성 후 전체 값은 한 번만 표시.' },
  'tokens.confirmDelete': { 'zh-CN': '确认删除该令牌？删除后使用此令牌的请求将无法通过。', 'zh-TW': '確認刪除該權杖？刪除後使用此權杖的請求將無法通過。', en: 'Delete this token? Requests using it will stop working.', ja: 'このトークンを削除しますか？使用中のリクエストが失敗します。', ko: '이 토큰을 삭제하시겠습니까? 이 토큰을 사용하는 요청이 실패합니다.' },
  'tokens.statTotal': { 'zh-CN': '令牌数', 'zh-TW': '權杖數', en: 'Tokens', ja: 'トークン数', ko: '토큰 수' },
  'tokens.statEnabled': { 'zh-CN': '已启用', 'zh-TW': '已啟用', en: 'Enabled', ja: '有効', ko: '활성화' },
  'tokens.statDisabled': { 'zh-CN': '已停用', 'zh-TW': '已停用', en: 'Disabled', ja: '無効', ko: '비활성화' },
  'tokens.alertName': { 'zh-CN': '请填写名称', 'zh-TW': '請填寫名稱', en: 'Please enter a name', ja: '名前を入力してください', ko: '이름을 입력하세요' },

  // ── 调用日志 Logs ──
  'logs.title': { 'zh-CN': '调用日志', 'zh-TW': '呼叫日誌', en: 'Call Logs', ja: 'コールログ', ko: '호출 로그' },
  'logs.total': { 'zh-CN': '共 {total} 条记录', 'zh-TW': '共 {total} 筆記錄', en: '{total} records', ja: '{total} 件', ko: '{total}건' },
  'logs.clear': { 'zh-CN': '清空', 'zh-TW': '清空', en: 'Clear', ja: 'クリア', ko: '비우기' },
  'logs.confirmClear': { 'zh-CN': '清空全部非收藏调用日志？收藏的记录会保留。此操作不可恢复。', 'zh-TW': '清空全部非收藏呼叫日誌？收藏的記錄會保留。此操作不可恢復。', en: 'Clear all non-starred logs? Starred records are kept. This cannot be undone.', ja: '非スターのコールログを全削除？スター付きは保持、元に戻せません。', ko: '별표 없는 호출 로그를 모두 비우시겠습니까? 별표 항목은 유지됩니다. 되돌릴 수 없습니다.' },
  'logs.globalConfig': { 'zh-CN': '全局配置', 'zh-TW': '全域設定', en: 'Global Config', ja: 'グローバル設定', ko: '전역 설정' },
  'logs.logIo': { 'zh-CN': '记录出入参', 'zh-TW': '記錄出入參', en: 'Log requests & responses', ja: 'リクエスト・レスポンスを記録', ko: '요청·응답 기록' },
  'logs.logStreamBody': { 'zh-CN': '捕获流式 body', 'zh-TW': '捕獲串流 body', en: 'Capture stream body', ja: 'ストリーム body を取得', ko: '스트림 body 캡처' },
  'logs.logCap': { 'zh-CN': '日志上限', 'zh-TW': '日誌上限', en: 'Log limit', ja: 'ログ上限', ko: '로그 한도' },
  'logs.logCapHint': { 'zh-CN': '非收藏日志达到该数量后自动清理最旧的（100–1,000,000）', 'zh-TW': '非收藏日誌達到該數量後自動清理最舊的（100–1,000,000）', en: 'Auto-trims oldest non-starred logs beyond this count (100–1,000,000)', ja: '非スターログがこの件数を超えると古いものから自動削除（100–1,000,000）', ko: '즐겨찾기 외 로그가 이 수를 넘기면 오래된 순으로 자동 정리(100–1,000,000)' },
  'logs.statTotal': { 'zh-CN': '总记录', 'zh-TW': '總記錄', en: 'Total', ja: '合計', ko: '합계' },
  'logs.statAvgLatency': { 'zh-CN': '平均耗时', 'zh-TW': '平均耗時', en: 'Avg Latency', ja: '平均レイテンシ', ko: '평균 지연' },
  'logs.statErrors': { 'zh-CN': '错误数', 'zh-TW': '錯誤數', en: 'Errors', ja: 'エラー数', ko: '오류 수' },
  'logs.statPage': { 'zh-CN': '当前页', 'zh-TW': '當前頁', en: 'Current Page', ja: '現在のページ', ko: '현재 페이지' },
  'logs.filterProtocol': { 'zh-CN': '全部协议', 'zh-TW': '全部協議', en: 'All Protocols', ja: '全プロトコル', ko: '전체 프로토콜' },
  'logs.filterStatus': { 'zh-CN': '全部状态', 'zh-TW': '全部狀態', en: 'All Status', ja: '全ステータス', ko: '전체 상태' },
  'logs.filterOk': { 'zh-CN': '成功 (<400)', 'zh-TW': '成功 (<400)', en: 'Success (<400)', ja: '成功 (<400)', ko: '성공 (<400)' },
  'logs.filterError': { 'zh-CN': '失败 (≥400)', 'zh-TW': '失敗 (≥400)', en: 'Failed (≥400)', ja: '失敗 (≥400)', ko: '실패 (≥400)' },
  'logs.filterStarred': { 'zh-CN': '仅看收藏', 'zh-TW': '僅看收藏', en: 'Starred only', ja: 'スター付きのみ', ko: '별표만' },
  'logs.clearFilters': { 'zh-CN': '清除筛选', 'zh-TW': '清除篩選', en: 'Clear Filters', ja: 'フィルタ解除', ko: '필터 해제' },
  'logs.colTime': { 'zh-CN': '时间', 'zh-TW': '時間', en: 'Time', ja: '時刻', ko: '시간' },
  'logs.colStar': { 'zh-CN': '收藏', 'zh-TW': '收藏', en: 'Starred', ja: 'スター', ko: '별표' },
  'logs.colEntry': { 'zh-CN': '入口', 'zh-TW': '入口', en: 'Entry', ja: 'エントリ', ko: '엔트리' },
  'logs.colProtocol': { 'zh-CN': '协议', 'zh-TW': '協議', en: 'Protocol', ja: 'プロトコル', ko: '프로토콜' },
  'logs.colModel': { 'zh-CN': '模型', 'zh-TW': '模型', en: 'Model', ja: 'モデル', ko: '모델' },
  'logs.colTags': { 'zh-CN': '标签', 'zh-TW': '標籤', en: 'Tags', ja: 'タグ', ko: '태그' },
  'logs.colStream': { 'zh-CN': '流式', 'zh-TW': '串流', en: 'Stream', ja: 'ストリーム', ko: '스트림' },
  'logs.colStatus': { 'zh-CN': '状态', 'zh-TW': '狀態', en: 'Status', ja: 'ステータス', ko: '상태' },
  'logs.colLatency': { 'zh-CN': '耗时', 'zh-TW': '耗時', en: 'Latency', ja: 'レイテンシ', ko: '지연' },
  'logs.colTokens': { 'zh-CN': 'Token(入/出)', 'zh-TW': 'Token(入/出)', en: 'Tokens (in/out)', ja: 'トークン (入/出)', ko: '토큰 (입/출력)' },
  'logs.empty': { 'zh-CN': '暂无日志', 'zh-TW': '暫無日誌', en: 'No logs', ja: 'ログなし', ko: '로그 없음' },
  'logs.emptyDesc': { 'zh-CN': '调用接口后日志将显示在这里', 'zh-TW': '呼叫介面後日誌將顯示在這裡', en: 'Logs appear here after calls', ja: '呼び出し後にログが表示されます', ko: '호출 후 로그가 여기 표시됩니다' },
  'logs.starOn': { 'zh-CN': '取消收藏', 'zh-TW': '取消收藏', en: 'Unstar', ja: 'スター解除', ko: '별표 해제' },
  'logs.starOff': { 'zh-CN': '收藏', 'zh-TW': '收藏', en: 'Star', ja: 'スター', ko: '별표' },
  'logs.tagsLabel': { 'zh-CN': '标签', 'zh-TW': '標籤', en: 'Tags', ja: 'タグ', ko: '태그' },
  'logs.tagsPick': { 'zh-CN': '选择标签（匹配任一）', 'zh-TW': '選擇標籤（匹配任一）', en: 'Select tags (match any)', ja: 'タグを選択（いずれか一致）', ko: '태그 선택 (하나라도 일치)' },
  'logs.tagsClear': { 'zh-CN': '清除', 'zh-TW': '清除', en: 'Clear', ja: 'クリア', ko: '해제' },
  'logs.tagsNone': { 'zh-CN': '暂无标签', 'zh-TW': '暫無標籤', en: 'No tags', ja: 'タグなし', ko: '태그 없음' },
  'logs.prev': { 'zh-CN': '上一页', 'zh-TW': '上一頁', en: 'Prev', ja: '前へ', ko: '이전' },
  'logs.next': { 'zh-CN': '下一页', 'zh-TW': '下一頁', en: 'Next', ja: '次へ', ko: '다음' },
  'logs.alertSaveFailed': { 'zh-CN': '保存失败', 'zh-TW': '儲存失敗', en: 'Save failed', ja: '保存失敗', ko: '저장 실패' },
  'logs.alertStarFailed': { 'zh-CN': '收藏失败', 'zh-TW': '收藏失敗', en: 'Star failed', ja: 'スター失敗', ko: '별표 실패' },
  'logs.placeholderEntryId': { 'zh-CN': '入口 ID', 'zh-TW': '入口 ID', en: 'Entry ID', ja: 'エントリ ID', ko: '엔트리 ID' },

  // ── 日志详情 LogDetail ──
  'detail.notFound': { 'zh-CN': '未找到', 'zh-TW': '未找到', en: 'Not found', ja: '見つかりません', ko: '찾을 수 없음' },
  'detail.back': { 'zh-CN': '返回列表', 'zh-TW': '返回列表', en: 'Back to list', ja: 'リストに戻る', ko: '목록으로' },
  'detail.title': { 'zh-CN': '日志 #{id}', 'zh-TW': '日誌 #{id}', en: 'Log #{id}', ja: 'ログ #{id}', ko: '로그 #{id}' },
  'detail.viewFormatted': { 'zh-CN': '格式化', 'zh-TW': '格式化', en: 'Formatted', ja: 'フォーマット', ko: '포맷' },
  'detail.viewRaw': { 'zh-CN': '原始', 'zh-TW': '原始', en: 'Raw', ja: '生データ', ko: '원본' },
  'detail.metaEntry': { 'zh-CN': '入口', 'zh-TW': '入口', en: 'Entry', ja: 'エントリ', ko: '엔트리' },
  'detail.metaModel': { 'zh-CN': '模型', 'zh-TW': '模型', en: 'Model', ja: 'モデル', ko: '모델' },
  'detail.metaLatency': { 'zh-CN': '耗时', 'zh-TW': '耗時', en: 'Latency', ja: 'レイテンシ', ko: '지연' },
  'detail.metaTime': { 'zh-CN': '时间', 'zh-TW': '時間', en: 'Time', ja: '時刻', ko: '시간' },
  'detail.metaReqLog': { 'zh-CN': '入参记录', 'zh-TW': '入參記錄', en: 'Request logged', ja: 'リクエスト記録', ko: '요청 기록됨' },
  'detail.metaResLog': { 'zh-CN': '出参记录', 'zh-TW': '出參記錄', en: 'Response logged', ja: 'レスポンス記録', ko: '응답 기록됨' },
  'detail.metaTokens': { en: 'Tokens', 'zh-CN': 'Token', 'zh-TW': 'Token', ja: 'トークン', ko: '토큰' },
  'detail.metaCost': { 'zh-CN': '费用', 'zh-TW': '費用', en: 'Cost', ja: 'コスト', ko: '비용' },
  'detail.metaError': { 'zh-CN': '错误', 'zh-TW': '錯誤', en: 'Error', ja: 'エラー', ko: '오류' },
  'detail.sectionRequest': { 'zh-CN': '入参 Request', 'zh-TW': '入參 Request', en: 'Request', ja: 'リクエスト', ko: '요청' },
  'detail.sectionResponse': { 'zh-CN': '出参 Response', 'zh-TW': '出參 Response', en: 'Response', ja: 'レスポンス', ko: '응답' },
  'detail.copyBody': { 'zh-CN': '复制正文', 'zh-TW': '複製正文', en: 'Copy body', ja: '本文をコピー', ko: '본문 복사' },
  'detail.copyJson': { 'zh-CN': '复制 JSON', 'zh-TW': '複製 JSON', en: 'Copy JSON', ja: 'JSON をコピー', ko: 'JSON 복사' },
  'detail.chunksTitle': { 'zh-CN': '解析的 chunk 序列 ({n} 条)', 'zh-TW': '解析的 chunk 序列 ({n} 筆)', en: 'Parsed chunks ({n})', ja: '解析済み chunk ({n} 件)', ko: '파싱된 chunk ({n}건)' },
  'detail.chunksDisabled': { 'zh-CN': '未启用流式 body 捕获', 'zh-TW': '未啟用串流 body 捕獲', en: 'Stream body capture disabled', ja: 'ストリーム body 取得無効', ko: '스트림 body 캡처 비활성화' },
  'detail.rawSse': { 'zh-CN': '原始 SSE 文本', 'zh-TW': '原始 SSE 文本', en: 'Raw SSE text', ja: '生 SSE テキスト', ko: '원본 SSE 텍스트' },
  'detail.rawStream': { 'zh-CN': '原始流式报文', 'zh-TW': '原始串流報文', en: 'Raw stream payload', ja: '生ストリームペイロード', ko: '원본 스트림 페이로드' },
  'detail.tagsLabel': { 'zh-CN': '标签', 'zh-TW': '標籤', en: 'Tags', ja: 'タグ', ko: '태그' },
  'detail.tagsPlaceholder': { 'zh-CN': '添加标签…', 'zh-TW': '新增標籤…', en: 'Add tag…', ja: 'タグを追加…', ko: '태그 추가…' },
  'detail.tagsPlaceholder2': { 'zh-CN': '输入标签后回车添加…', 'zh-TW': '輸入標籤後 Enter 新增…', en: 'Type a tag and press Enter…', ja: 'タグを入力して Enter…', ko: '태그를 입력하고 Enter…' },
  'detail.tagsSaving': { 'zh-CN': '保存中…', 'zh-TW': '儲存中…', en: 'Saving…', ja: '保存中…', ko: '저장 중…' },
  'detail.noMessages': { 'zh-CN': '无可解析的对话消息', 'zh-TW': '無可解析的對話訊息', en: 'No parseable messages', ja: '解析可能なメッセージなし', ko: '파싱 가능한 메시지 없음' },
  'detail.noText': { 'zh-CN': '未能解析出文本内容（可在「原始」视图中查看完整报文）', 'zh-TW': '未能解析出文本內容（可在「原始」視圖中查看完整報文）', en: 'No text parsed (see full payload in Raw view)', ja: 'テキストを解析できません（Raw ビューで確認）', ko: '텍스트를 파싱하지 못함 (원본 보기에서 확인)' },
  'detail.emptyCode': { 'zh-CN': '（空）', 'zh-TW': '（空）', en: '(empty)', ja: '（空）', ko: '(비어 있음)' },
  'detail.authAnthropic': { 'zh-CN': 'Anthropic: 客户端用 x-api-key 鉴权，header: x-api-key: <暴露key>', 'zh-TW': 'Anthropic: 客戶端用 x-api-key 鑑權，header: x-api-key: <暴露key>', en: 'Anthropic: clients authenticate with x-api-key header: x-api-key: <key>', ja: 'Anthropic: クライアントは x-api-key で認証、header: x-api-key: <key>', ko: 'Anthropic: 클라이언트는 x-api-key로 인증, header: x-api-key: <key>' },
  'detail.authOpenai': { 'zh-CN': 'OpenAI: 客户端用 Authorization: Bearer <暴露key>', 'zh-TW': 'OpenAI: 客戶端用 Authorization: Bearer <暴露key>', en: 'OpenAI: clients authenticate with Authorization: Bearer <key>', ja: 'OpenAI: クライアントは Authorization: Bearer <key>', ko: 'OpenAI: 클라이언트는 Authorization: Bearer <key>' },

  // ── 统计 Stats ──
  'stats.title': { 'zh-CN': '统计', 'zh-TW': '統計', en: 'Statistics', ja: '統計', ko: '통계' },
  'stats.subtitle': { 'zh-CN': '上游源 / 模型入口 的 Token 与调用量统计', 'zh-TW': '上游源 / 模型入口 的 Token 與呼叫量統計', en: 'Token & call volume stats for sources / model entries', ja: 'ソース / モデルエントリのトークン・呼び出し量統計', ko: '소스 / 모델 엔트리의 토큰 및 호출량 통계' },
  'stats.groups.day': { 'zh-CN': '按天', 'zh-TW': '按天', en: 'Daily', ja: '日別', ko: '일별' },
  'stats.groups.month': { 'zh-CN': '按月', 'zh-TW': '按月', en: 'Monthly', ja: '月別', ko: '월별' },
  'stats.groups.source': { 'zh-CN': '按上游源', 'zh-TW': '按上游源', en: 'By Source', ja: 'ソース別', ko: '소스별' },
  'stats.groups.entry': { 'zh-CN': '按入口', 'zh-TW': '按入口', en: 'By Entry', ja: 'エントリ別', ko: '엔트리별' },
  'stats.groups.model': { 'zh-CN': '按模型', 'zh-TW': '按模型', en: 'By Model', ja: 'モデル別', ko: '모델별' },
  'stats.seriesInput': { 'zh-CN': '输入(非缓存)', 'zh-TW': '輸入(非快取)', en: 'Input (uncached)', ja: '入力(非キャッシュ)', ko: '입력(캐시 미사용)' },
  'stats.seriesCached': { 'zh-CN': '输入(缓存)', 'zh-TW': '輸入(快取)', en: 'Input (cached)', ja: '入力(キャッシュ)', ko: '입력(캐시)' },
  'stats.seriesOutput': { 'zh-CN': '输出', 'zh-TW': '輸出', en: 'Output', ja: '出力', ko: '출력' },
  'stats.statInput': { 'zh-CN': '输入 Token (不含缓存)', 'zh-TW': '輸入 Token (不含快取)', en: 'Input Tokens (uncached)', ja: '入力トークン (非キャッシュ)', ko: '입력 토큰 (캐시 제외)' },
  'stats.statCached': { 'zh-CN': '输入 Token (缓存)', 'zh-TW': '輸入 Token (快取)', en: 'Input Tokens (cached)', ja: '入力トークン (キャッシュ)', ko: '입력 토큰 (캐시)' },
  'stats.statOutput': { 'zh-CN': '输出 Token', 'zh-TW': '輸出 Token', en: 'Output Tokens', ja: '出力トークン', ko: '출력 토큰' },
  'stats.statCalls': { 'zh-CN': '调用次数', 'zh-TW': '呼叫次數', en: 'Calls', ja: '呼び出し回数', ko: '호출 수' },
  'stats.statCost': { 'zh-CN': '总费用 (元)', 'zh-TW': '總費用 (元)', en: 'Total Cost (CNY)', ja: '総コスト (元)', ko: '총 비용 (위안)' },
  'stats.filterTitle': { 'zh-CN': '筛选条件', 'zh-TW': '篩選條件', en: 'Filters', ja: 'フィルタ', ko: '필터' },
  'stats.filterProtocol': { 'zh-CN': '协议', 'zh-TW': '協議', en: 'Protocol', ja: 'プロトコル', ko: '프로토콜' },
  'stats.filterAllProtocols': { 'zh-CN': '全部协议', 'zh-TW': '全部協議', en: 'All Protocols', ja: '全プロトコル', ko: '전체 프로토콜' },
  'stats.filterSource': { 'zh-CN': '上游源', 'zh-TW': '上游源', en: 'Source', ja: 'ソース', ko: '소스' },
  'stats.filterAllSources': { 'zh-CN': '全部上游源', 'zh-TW': '全部上游源', en: 'All Sources', ja: '全ソース', ko: '전체 소스' },
  'stats.filterEntry': { 'zh-CN': '入口', 'zh-TW': '入口', en: 'Entry', ja: 'エントリ', ko: '엔트리' },
  'stats.filterAllEntries': { 'zh-CN': '全部入口', 'zh-TW': '全部入口', en: 'All Entries', ja: '全エントリ', ko: '전체 엔트리' },
  'stats.filterModel': { 'zh-CN': '模型', 'zh-TW': '模型', en: 'Model', ja: 'モデル', ko: '모델' },
  'stats.filterModelPlaceholder': { 'zh-CN': '模型名', 'zh-TW': '模型名', en: 'Model name', ja: 'モデル名', ko: '모델명' },
  'stats.filterStart': { 'zh-CN': '开始日期', 'zh-TW': '開始日期', en: 'Start date', ja: '開始日', ko: '시작일' },
  'stats.filterEnd': { 'zh-CN': '结束日期', 'zh-TW': '結束日期', en: 'End date', ja: '終了日', ko: '종료일' },
  'stats.chartTrend': { 'zh-CN': 'Token 趋势', 'zh-TW': 'Token 趨勢', en: 'Token Trend', ja: 'トークン推移', ko: '토큰 추이' },
  'stats.chartCompare': { 'zh-CN': 'Token 对比', 'zh-TW': 'Token 對比', en: 'Token Comparison', ja: 'トークン比較', ko: '토큰 비교' },
  'stats.chartTrendDesc': { 'zh-CN': '按时间维度查看变化趋势', 'zh-TW': '按時間維度查看變化趨勢', en: 'View trend over time', ja: '時間ごとの推移', ko: '시간별 추이 보기' },
  'stats.chartCompareDesc': { 'zh-CN': '按分类维度对比分析', 'zh-TW': '按分類維度對比分析', en: 'Compare across categories', ja: 'カテゴリ別に比較', ko: '카테고리별 비교' },
  'stats.empty': { 'zh-CN': '暂无数据', 'zh-TW': '暫無資料', en: 'No data', ja: 'データなし', ko: '데이터 없음' },
  'stats.emptyDesc': { 'zh-CN': '调整筛选条件或先产生一些调用', 'zh-TW': '調整篩選條件或先產生一些呼叫', en: 'Adjust filters or make some calls', ja: 'フィルタを調整するか呼び出しを行ってください', ko: '필터를 조정하거나 호출을 만들어보세요' },
  'stats.tableTitle': { 'zh-CN': '详细数据', 'zh-TW': '詳細資料', en: 'Details', ja: '詳細', ko: '상세' },
  'stats.tableCount': { 'zh-CN': '{rows} 条记录', 'zh-TW': '{rows} 筆記錄', en: '{rows} records', ja: '{rows} 件', ko: '{rows}건' },
  'stats.tableGroup': { 'zh-CN': '分组', 'zh-TW': '分組', en: 'Group', ja: 'グループ', ko: '그룹' },
  'stats.tableInput': { 'zh-CN': '输入(非缓存)', 'zh-TW': '輸入(非快取)', en: 'Input (uncached)', ja: '入力(非キャッシュ)', ko: '입력(캐시 미사용)' },
  'stats.tableCached': { 'zh-CN': '输入(缓存)', 'zh-TW': '輸入(快取)', en: 'Input (cached)', ja: '入力(キャッシュ)', ko: '입력(캐시)' },
  'stats.tableOutput': { 'zh-CN': '输出', 'zh-TW': '輸出', en: 'Output', ja: '出力', ko: '출력' },
  'stats.tableCalls': { 'zh-CN': '调用次数', 'zh-TW': '呼叫次數', en: 'Calls', ja: '呼び出し回数', ko: '호출 수' },
  'stats.tableCost': { 'zh-CN': '费用 (元)', 'zh-TW': '費用 (元)', en: 'Cost (CNY)', ja: 'コスト (元)', ko: '비용 (위안)' },
  'stats.total': { 'zh-CN': '合计', 'zh-TW': '合計', en: 'Total', ja: '合計', ko: '합계' },
  'stats.stackDim1': { 'zh-CN': '上游每日用量（按上游堆叠）', 'zh-TW': '上游每日用量（按上游堆疊）', en: 'Per-source daily usage (stacked by source)', ja: 'ソース別日次使用量（ソースで積み上げ）', ko: '소스별 일일 사용량 (소스별 적재)' },
  'stats.stackDim2': { 'zh-CN': '上游·模型用量（按模型堆叠）', 'zh-TW': '上游·模型用量（按模型堆疊）', en: 'Source × model usage (stacked by model)', ja: 'ソース・モデル使用量（モデルで積み上げ）', ko: '소스·모델 사용량 (모델별 적재)' },
  'stats.stackDim3': { 'zh-CN': '入口·模型用量（按模型堆叠）', 'zh-TW': '入口·模型用量（按模型堆疊）', en: 'Entry × model usage (stacked by model)', ja: 'エントリ・モデル使用量（モデルで積み上げ）', ko: '엔트리·모델 사용량 (모델별 적재)' },
  'stats.stackDim4': { 'zh-CN': '单上游·每日模型用量', 'zh-TW': '單上游·每日模型用量', en: 'Single source · daily model usage', ja: '単一ソース・日次モデル使用量', ko: '단일 소스 · 일일 모델 사용량' },
  'stats.stackTitle': { 'zh-CN': '堆叠分析', 'zh-TW': '堆疊分析', en: 'Stack Analysis', ja: '積み上げ分析', ko: '적재 분석' },
  'stats.stackDesc': { 'zh-CN': '多维度构成分析', 'zh-TW': '多維度構成分析', en: 'Multi-dimensional composition analysis', ja: '多次元構成分析', ko: '다차원 구성 분석' },
  'stats.stackToken': { en: 'Tokens', 'zh-CN': 'Token', 'zh-TW': 'Token', ja: 'トークン', ko: '토큰' },
  'stats.stackCalls': { 'zh-CN': '调用次数', 'zh-TW': '呼叫次數', en: 'Calls', ja: '呼び出し回数', ko: '호출 수' },
  'stats.stackCost': { 'zh-CN': '费用', 'zh-TW': '費用', en: 'Cost', ja: 'コスト', ko: '비용' },
  'stats.stackPickSource': { 'zh-CN': '请选择上游', 'zh-TW': '請選擇上游', en: 'Select a source', ja: 'ソースを選択', ko: '소스를 선택' },
  'stats.stackPickSourceDesc': { 'zh-CN': '该维度需选定单个上游源', 'zh-TW': '該維度需選定單個上游源', en: 'This dimension requires a single source', ja: 'この次元は単一ソースが必要', ko: '이 차원은 단일 소스가 필요' },
  'stats.stackEmpty': { 'zh-CN': '暂无数据', 'zh-TW': '暫無資料', en: 'No data', ja: 'データなし', ko: '데이터 없음' },

  // ── 更新提示 Update ──
  'update.available': { 'zh-CN': '发现新版本 v{version}', 'zh-TW': '發現新版本 v{version}', en: 'New version v{version} available', ja: '新バージョン v{version} があります', ko: '새 버전 v{version} 사용 가능' },
  'update.downloading': { 'zh-CN': '正在下载… {percent}%', 'zh-TW': '正在下載… {percent}%', en: 'Downloading… {percent}%', ja: 'ダウンロード中… {percent}%', ko: '다운로드 중… {percent}%' },
  'update.ready': { 'zh-CN': '更新已就绪，重启以应用', 'zh-TW': '更新已就緒，重啟以應用', en: 'Update ready, restart to apply', ja: '更新準備完了、再起動して適用', ko: '업데이트 준비 완료, 재시작하여 적용' },
  'update.download': { 'zh-CN': '下载更新', 'zh-TW': '下載更新', en: 'Download', ja: 'ダウンロード', ko: '다운로드' },
  'update.install': { 'zh-CN': '立即重启', 'zh-TW': '立即重啟', en: 'Restart now', ja: '今すぐ再起動', ko: '지금 재시작' },
  'update.dismiss': { 'zh-CN': '稍后', 'zh-TW': '稍後', en: 'Later', ja: '後で', ko: '나중에' },
  'update.checking': { 'zh-CN': '检查更新中…', 'zh-TW': '檢查更新中…', en: 'Checking for updates…', ja: '更新を確認中…', ko: '업데이트 확인 중…' },
  'update.latest': { 'zh-CN': '已是最新版本', 'zh-TW': '已是最新版本', en: 'You are on the latest version', ja: '最新版です', ko: '최신 버전입니다' },
  'update.failed': { 'zh-CN': '检查更新失败', 'zh-TW': '檢查更新失敗', en: 'Update check failed', ja: '更新確認に失敗', ko: '업데이트 확인 실패' },

  // ── 语言切换器 ──
  'lang.auto': { 'zh-CN': '跟随系统', 'zh-TW': '跟隨系統', en: 'Follow system', ja: 'システムに従う', ko: '시스템 따르기' },
  'lang.label': { 'zh-CN': '语言', 'zh-TW': '語言', en: 'Language', ja: '言語', ko: '언어' },
};

function resolveEntry(entry: Entry, locale: Locale): string {
  return entry[locale] ?? entry.en ?? ((): string => {
    for (const k in entry) return entry[k as Locale]!;
    return '';
  })();
}

export function t(key: string, vars?: TVars): string {
  const entry = MESSAGES[key];
  const str = entry ? resolveEntry(entry, currentLocale) : key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

const DATE_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
};

export function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleString(DATE_LOCALE[currentLocale], { hour12: false });
  } catch {
    return s;
  }
}

export function fmtMoney(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '¥0';
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return `¥${s}`;
}
