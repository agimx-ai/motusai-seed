/** Upgrade only the catalog API surface. Discovery, authentication and other Cloud endpoints stay unchanged. */
export function pluginCatalogV2Url(marketUrl: string): URL {
  const url = new URL(marketUrl);
  const path = url.pathname.replace(/\/api\/v[12]\/catalog\//, '/api/v2/catalog/');
  if (path === url.pathname && !/\/api\/v2\/catalog\//.test(path)) throw new Error('插件市场未提供 v2 查询接口。');
  url.pathname = path;
  return url;
}
