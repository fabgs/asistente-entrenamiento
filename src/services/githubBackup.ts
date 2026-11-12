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

const NO_REPO = 'No encuentro el repositorio: revisa usuario, nombre y permisos del token.';

/**
 * The file in GitHub is not the copy this phone uploaded or restored last (a new phone, a reset,
 * another phone uploading): replacing it is for the user to decide. Nothing was uploaded.
 */
export class ForeignCopyError extends GithubError {
  constructor() {
    super('En GitHub hay una copia que no salió de este móvil. Restáurala o, si la buena es la de este, pulsa «Subir ahora».');
  }
}

/** The blob sha of the file, which names that exact copy; null if there is none yet. */
export async function getFileSha(target: GithubTarget, token: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const current = await request(fetchImpl, contentsUrl(target), { headers: headers(token) });
  if (current.status === 404) return null;
  if (!current.ok) throw explain(current.status, NO_REPO);
  return ((await current.json()) as { sha?: string }).sha ?? null;
}

/**
 * Creates or replaces the file; each upload becomes a commit, so GitHub keeps every version.
 * `mayReplace` sees the sha of the file there is (null if none) before anything is built or sent:
 * ForeignCopyError if it says no. Returns the sha of the new file (null if GitHub did not say).
 */
export async function putFile(
  target: GithubTarget,
  token: string,
  base64Content: () => Promise<string>,
  message: string,
  mayReplace: (currentSha: string | null) => boolean,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const sha = await getFileSha(target, token, fetchImpl);
  if (!mayReplace(sha)) throw new ForeignCopyError();

  const result = await request(fetchImpl, contentsUrl(target), {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: await base64Content(), ...(sha ? { sha } : {}) }),
  });
  if (!result.ok) throw explain(result.status, NO_REPO);
  const created = (await result.json().catch(() => null)) as { content?: { sha?: string } } | null;
  return created?.content?.sha ?? null;
}

export async function getRawFile(target: GithubTarget, token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const result = await request(fetchImpl, contentsUrl(target), {
    headers: headers(token, 'application/vnd.github.raw+json'),
  });
  if (!result.ok) throw explain(result.status, 'Aún no hay ninguna copia en ese repositorio.');
  return result.text();
}
