import { Viewer } from '@bytemd/react';
import type { BytemdPlugin } from 'bytemd';
import gfm from '@bytemd/plugin-gfm';
import frontmatter from '@bytemd/plugin-frontmatter';
import highlight from '@bytemd/plugin-highlight-ssr';
import { createElement } from 'react';
import { themes, highlights } from './theme-styles.mjs';

export type Theme = string;
export const defaultMarkdownTheme = 'smartblue';
export const markdownThemeIds = Object.freeze(Object.keys(themes));
export const remarkRehype = { allowDangerousHtml: false };

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && Object.hasOwn(themes, value);
}

export function markdownSurface(dark: boolean) {
  return dark ? { paper: '#2f2f2f', ink: '#dddddd' } : { paper: '#ffffff', ink: '#252933' };
}

export function articleStyles(theme: Theme, dark: boolean): string {
  if (!isTheme(theme)) throw new Error('Unknown article theme');
  const preset = themes[theme];
  const palette = theme === 'cyanosis' && !dark ? 'github' : preset.highlight;
  return `${preset.style}\n${highlights[palette]}`;
}

function createPlugin(factory: (() => BytemdPlugin) | { default: () => BytemdPlugin }) {
  return (typeof factory === 'function' ? factory : factory.default)();
}

export function markdownPlugins(plugin: BytemdPlugin, dark: boolean): BytemdPlugin[] {
  return [
    createPlugin(gfm),
    createPlugin(frontmatter),
    createPlugin(highlight),
    plugin,
    {
      viewerEffect: ({ markdownBody }) => {
        markdownBody.classList.toggle('__dark', dark);
      },
    },
  ];
}

type MarkdownNode = {
  type: string;
  url?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

export function restrictedMarkdownMedia(images: ReadonlyMap<string, string>): BytemdPlugin {
  const approvedUrls = new Set(images.values());
  return {
    remark: (processor) => processor.use(() => (tree: unknown) => {
      walk(tree as MarkdownNode, (node) => {
        if (node.type === 'image' || node.type === 'definition') {
          const url = images.get(node.url ?? '');
          if (url) node.url = url;
        }
      });
    }),
    rehype: (processor) => processor.use(() => (tree: unknown) => {
      walk(tree as MarkdownNode, (node) => {
        if (node.tagName === 'img') {
          if (approvedUrls.has(String(node.properties?.src))) {
            node.properties = { ...node.properties, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' };
          } else {
            node.tagName = 'span';
            node.properties = {};
            node.children = [];
          }
        }
        if (node.tagName === 'a' && node.properties) delete node.properties.href;
      });
    }),
  };
}

export function MarkdownRenderer({ markdown, plugins }: { markdown: string; plugins: BytemdPlugin[] }) {
  return createElement(Viewer, { value: markdown, plugins, remarkRehype });
}
