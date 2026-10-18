import { createInstance, type i18n } from 'i18next';

export type TranslationMessages = { [key: string]: string | TranslationMessages };
export type TranslationReference = { $t: string };
export type PluginTranslations = { defaultLocale: string; resources: Record<string, TranslationMessages> };

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function failure(message: string, code = 'plugin_translation_invalid'): never {
  throw Object.assign(new Error(message), { code });
}

export function canonicalPluginLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? failure('Missing translation locale.');
  } catch {
    return failure('Invalid translation locale: ' + locale);
  }
}

export function validatePluginTranslations(bundle: PluginTranslations): void {
  if (
    !bundle ||
    typeof bundle !== 'object' ||
    !bundle.resources ||
    typeof bundle.resources !== 'object' ||
    Array.isArray(bundle.resources)
  )
    failure('Invalid translation resources.');
  if (
    canonicalPluginLocale(bundle.defaultLocale) !== bundle.defaultLocale ||
    !Object.hasOwn(bundle.resources, bundle.defaultLocale)
  )
    failure('Default translation locale is missing or non-canonical.');
  const locales = Object.keys(bundle.resources);
  if (!locales.length || locales.length > 32 || JSON.stringify(bundle).length > 2 * 1024 * 1024)
    failure('Translation resource limit exceeded.');
  function check(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 20)
      failure('Translations must contain only text and nested dictionaries.');
    for (const [key, item] of Object.entries(value)) {
      if (!key || key.split('.').some((segment) => forbidden.has(segment))) failure('Invalid translation key: ' + key);
      if (typeof item !== 'string') check(item, depth + 1);
    }
  }
  for (const locale of locales) {
    if (canonicalPluginLocale(locale) !== locale)
      failure('Translation locale must use canonical BCP 47 notation: ' + locale);
    check(bundle.resources[locale], 0);
  }
}

/** BCP 47 script/region equivalents are resolved generically; i18next owns language fallback. */
export function pluginTranslationLocale(locale: string, bundle: PluginTranslations): string {
  const canonical = canonicalPluginLocale(locale);
  if (Object.hasOwn(bundle.resources, canonical)) return canonical;
  const expanded = new Intl.Locale(canonical).maximize().baseName;
  return (
    Object.keys(bundle.resources).find((candidate) => new Intl.Locale(candidate).maximize().baseName === expanded) ??
    canonical
  );
}

/** Each plugin or SDK scope gets an independent i18next instance with already-loaded JSON resources. */
export function createPluginI18n(
  bundle: PluginTranslations = { defaultLocale: 'en-US', resources: { 'en-US': {} } },
  locale = bundle.defaultLocale,
): i18n {
  validatePluginTranslations(bundle);
  const instance = createInstance();
  void instance.init({
    initAsync: false,
    lng: pluginTranslationLocale(locale, bundle),
    fallbackLng: bundle.defaultLocale,
    defaultNS: 'translation',
    ns: ['translation'],
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    resources: Object.fromEntries(
      Object.entries(bundle.resources).map(([language, translation]) => [
        language,
        { translation: structuredClone(translation) },
      ]),
    ),
  });
  if (!instance.isInitialized) failure('Translation initialization failed.');
  return instance;
}

export function isTranslationReference(value: unknown): value is TranslationReference {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    '$t' in value &&
    typeof value.$t === 'string',
  );
}

/** Traverses data only. Never imports or evaluates plugin JavaScript. */
export function mapTranslationReferences(value: unknown, translate: (key: string) => unknown): unknown {
  if (value && typeof value === 'object' && Object.hasOwn(value, '$t') && !isTranslationReference(value))
    failure('Malformed translation reference.');
  if (isTranslationReference(value)) {
    if (!value.$t.trim() || value.$t.length > 512 || value.$t.split('.').some((segment) => forbidden.has(segment)))
      failure('Invalid translation reference.');
    return translate(value.$t);
  }
  if (Array.isArray(value)) return value.map((item) => mapTranslationReferences(item, translate));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapTranslationReferences(item, translate)]),
    );
  return value;
}

function staticText(instance: i18n, key: string, defaultLocale: string): string {
  if (!instance.exists(key, { lng: defaultLocale, fallbackLng: false }))
    failure('Missing default translation: ' + key, 'plugin_translation_missing');
  const value = instance.t(key, { skipInterpolation: true });
  if (typeof value !== 'string' || !value.trim()) failure('Translation is not non-empty text: ' + key);
  return value;
}

export function resolvePluginTranslationReferences(
  value: unknown,
  bundle: PluginTranslations,
  locale: string,
): unknown {
  const instance = createPluginI18n(bundle, locale);
  return mapTranslationReferences(value, (key) => staticText(instance, key, bundle.defaultLocale));
}

/** The existing public metadata protocol uses these two labels; author resources remain standard locale JSON. */
export function resolvePluginLocalizedMetadata(value: unknown, bundle: PluginTranslations): unknown {
  const english = createPluginI18n(bundle, 'en-US'),
    chinese = createPluginI18n(bundle, 'zh-CN');
  return mapTranslationReferences(value, (key) => ({
    en_US: staticText(english, key, bundle.defaultLocale),
    zh_Hans: staticText(chinese, key, bundle.defaultLocale),
  }));
}
