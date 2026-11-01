/** Minimal GitHub contents API client for the automatic backup (PLAN.md §9). */

export interface GithubTarget {
  owner: string;
  repo: string;
  path: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GithubError extends Error {}

function contentsUrl(t: GithubTarget): string {
  const path = t.path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `https://api.github.com/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/contents/${path}`;
}

function headers(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new GithubError('Sin conexión con GitHub.');
  }
}

function explain(status: number, missing: string): GithubError {
  if (status === 401) return new GithubError('El token de GitHub no es válido o ha caducado.');
  if (status === 403) return new GithubError('El token no tiene permiso de escritura en ese repositorio.');
  if (status === 404) return new GithubError(missing);
  return new GithubError(`GitHub respondió con un error (${status}).`);
}

/** Creates or replaces the file; each upload becomes a commit, so GitHub keeps every version. */
export async function putFile(
  target: GithubTarget,
  token: string,
  base64Content: string,
  message: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const url = contentsUrl(target);
  const current = await request(fetchImpl, url, { headers: headers(token) });
  if (!current.ok && current.status !== 404) {
    throw explain(current.status, 'No encuentro el repositorio: revisa usuario, nombre y permisos del token.');
  }
  const sha = current.ok ? ((await current.json()) as { sha?: string }).sha : undefined;

  const result = await request(fetchImpl, url, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, ...(sha ? { sha } : {}) }),
  });
  if (!result.ok) {
    throw explain(result.status, 'No encuentro el repositorio: revisa usuario, nombre y permisos del token.');
  }
}

export async function getRawFile(target: GithubTarget, token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const result = await request(fetchImpl, contentsUrl(target), {
    headers: headers(token, 'application/vnd.github.raw+json'),
  });
  if (!result.ok) throw explain(result.status, 'Aún no hay ninguna copia en ese repositorio.');
  return result.text();
}
