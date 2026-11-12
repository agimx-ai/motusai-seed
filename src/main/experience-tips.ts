import type { ExperienceTipLike, ExperienceTipRead, ExperienceTipRemoval, ExperienceTipResult, ExperienceTipWrite } from '../shared/experience-tips';

export type ExperienceTipCloudRequest = ExperienceTipRead
  | Exclude<ExperienceTipWrite, { kind: 'account' | 'edit-context' }>
  | ({ kind: 'like' } & ExperienceTipLike)
  | ({ kind: 'remove' } & ExperienceTipRemoval);

export async function requestExperienceTips(
  cloudUrl: string,
  getAccessToken: (rejectedToken?: string) => Promise<string>,
  accountIsCurrent: () => boolean,
  request: ExperienceTipCloudRequest,
): Promise<ExperienceTipResult> {
  const base = '/api/v1/experience-tips';
  let path: string;
  switch (request.kind) {
    case 'article':
      path = '/articles/' + request.tipId;
      break;
    case 'activity-counts': {
      const params = new URLSearchParams();
      if (request.articlesSince) params.set('articles_since', request.articlesSince);
      if (request.submissionsSince) params.set('submissions_since', request.submissionsSince);
      path = '/activity-counts' + (params.size ? '?' + params.toString() : '');
      break;
    }
    case 'like':
      path = '/articles/' + request.tipId + '/like';
      break;
    case 'submit':
    case 'remove':
      path = '/submissions/' + request.tipId + '/' + request.versionId + '/' + request.kind;
      break;
    case 'articles':
    case 'my-submissions': {
      const params = new URLSearchParams();
      if (request.kind === 'articles' && request.sort === 'popular') params.set('sort', request.sort);
      if (request.before) params.set('before', request.before);
      if (request.query) params.set('query', request.query);
      path = '/' + request.kind + (params.size ? '?' + params.toString() : '');
      break;
    }
    default:
      path = '/' + request.kind;
  }

  const unauthorized: ExperienceTipResult = {
    ok: false, status: 401, code: 'experience_tip_unauthorized', message: 'Sign in to Seed to use Experience tips.',
  };
  const body = request.kind === 'like'
    ? JSON.stringify({ liked: request.liked })
    : request.kind === 'remove'
      ? JSON.stringify({ action: request.action })
      : 'body' in request ? JSON.stringify(request.body) : undefined;
  const method = request.kind === 'like' ? 'PUT' : body === undefined ? 'GET' : 'POST';
  try {
    let token = await getAccessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!accountIsCurrent()) return unauthorized;
      const response = await fetch(new URL(base + path, cloudUrl), {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        if (!accountIsCurrent()) return unauthorized;
        token = await getAccessToken(token);
        continue;
      }
      const value: unknown = await response.json().catch(() => null);
      if (!accountIsCurrent()) return unauthorized;
      if (response.ok && value !== null) return { ok: true, value };
      if (response.status === 401) return unauthorized;
      const detail = value as { code?: unknown; message?: unknown } | null;
      return {
        ok: false,
        status: response.ok ? 502 : response.status,
        code: typeof detail?.code === 'string' ? detail.code : 'experience_tips_unavailable',
        message: typeof detail?.message === 'string' ? detail.message : 'Experience tips are unavailable.',
      };
    }
  } catch {
    if (accountIsCurrent()) {
      return { ok: false, status: 502, code: 'experience_tips_unavailable', message: 'Could not connect to Seed Cloud.' };
    }
  }
  return unauthorized;
}
