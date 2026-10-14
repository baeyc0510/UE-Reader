// Per-agent model catalog with caching, CLI-version invalidation and a last-good fallback.
// Catalog entries: { id, displayName, description, isDefault }.
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@\[\]-]{0,199}$/.test(value);

export function normalizeModels(entries) {
  if (!Array.isArray(entries)) throw new Error('모델 목록의 형식을 읽을 수 없습니다.');
  const result = [], seen = new Set();
  for (const entry of entries) {
    const id = entry.model || entry.slug || entry.id;
    if (!validId(id) || entry.hidden === true || (entry.visibility && entry.visibility !== 'list') || seen.has(id)) continue;
    if (Array.isArray(entry.inputModalities) && !entry.inputModalities.includes('text')) continue;
    seen.add(id);
    result.push({ id, displayName: entry.displayName || entry.display_name || id, description: typeof entry.description === 'string' ? entry.description : '', isDefault: entry.isDefault === true });
  }
  return result;
}

/**
 * @param agent { id, label }
 * provider() lists models, versionProvider() returns the CLI version used for invalidation.
 */
export function createModelCatalog({ store, agent = { id: 'codex', label: 'Codex' }, provider, versionProvider, ttl = 600000 }) {
  const read = () => store.data.modelCatalogs?.[agent.id] || null;
  let cached = read(), inFlight = null;
  async function get(force = false) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const version = await versionProvider();
        if (!force && cached?.cliVersion === version && Date.now() - Date.parse(cached.fetchedAt) < ttl) return { ...cached, stale: false, warning: '' };
        const models = normalizeModels(await provider({ directory: store.directory }));
        if (!models.length) throw new Error(`${agent.label} 모델 목록이 비어 있습니다.`);
        cached = { models, cliVersion: version, fetchedAt: new Date().toISOString() };
        await store.update(d => { d.modelCatalogs = { ...d.modelCatalogs, [agent.id]: cached }; }).catch(() => {});
        return { ...cached, stale: false, warning: '' };
      } catch (error) {
        return { models: cached?.models || [], cliVersion: cached?.cliVersion || '', fetchedAt: cached?.fetchedAt || null, stale: true,
          warning: cached ? `최신 목록을 확인하지 못해 마지막 목록을 표시합니다. ${error.message}` : `모델 목록을 확인하지 못했습니다. ${agent.label} 기본값으로 사용할 수 있습니다. ${error.message}` };
      }
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }
  async function accepts(model) {
    return (await get()).models.some(m => m.id === model);
  }
  async function resolveModel(requestedModel) {
    if (!requestedModel) return { model: null, requestedModel: null, modelNotice: '' };
    const catalog = await get();
    if (catalog.models.some(m => m.id === requestedModel)) return { model: requestedModel, requestedModel, modelNotice: catalog.stale ? '최신 모델 목록을 확인하지 못해 마지막으로 확인한 선택 모델을 사용합니다.' : '' };
    return { model: null, requestedModel, modelNotice: catalog.stale ? `모델 목록을 확인할 수 없어 이번 요청은 ${agent.label} 기본값을 사용합니다.` : `선택한 모델 ${requestedModel}이 현재 목록에 없어 이번 요청은 ${agent.label} 기본값을 사용합니다.` };
  }
  return { get, accepts, resolveModel };
}
