import { getRawFile, putFile } from '../githubBackup';

const target = { owner: 'someone', repo: 'entreno-backup', path: 'copias/entreno.json' };

function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift()!;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => String(next.body),
    } as Response;
  };
  return { calls, fetchImpl };
}

describe('putFile', () => {
  it('creates the file when it does not exist yet', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 404 }, { status: 201 }]);
    await putFile(target, 'tok', 'e30=', 'msg', fetchImpl);

    expect(calls[0].url).toBe('https://api.github.com/repos/someone/entreno-backup/contents/copias/entreno.json');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(calls[1].init?.method).toBe('PUT');
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ message: 'msg', content: 'e30=' });
  });

  it('sends the current sha to replace an existing file', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { sha: 'abc' } }, { status: 200 }]);
    await putFile(target, 'tok', 'e30=', 'msg', fetchImpl);
    expect(JSON.parse(calls[1].init?.body as string).sha).toBe('abc');
  });

  it('explains common failures in Spanish', async () => {
    await expect(putFile(target, 'bad', 'e30=', 'msg', fakeFetch([{ status: 401 }]).fetchImpl)).rejects.toThrow(
      'token de GitHub no es válido',
    );
    await expect(
      putFile(target, 'tok', 'e30=', 'msg', fakeFetch([{ status: 404 }, { status: 404 }]).fetchImpl),
    ).rejects.toThrow('No encuentro el repositorio');
    const offline = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(putFile(target, 'tok', 'e30=', 'msg', offline)).rejects.toThrow('Sin conexión');
  });
});

describe('getRawFile', () => {
  it('asks GitHub for the raw content', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: '{"app":"entreno"}' }]);
    expect(await getRawFile(target, 'tok', fetchImpl)).toBe('{"app":"entreno"}');
    expect((calls[0].init?.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw+json');
  });

  it('says when there is no backup yet', async () => {
    await expect(getRawFile(target, 'tok', fakeFetch([{ status: 404 }]).fetchImpl)).rejects.toThrow(
      'Aún no hay ninguna copia',
    );
  });
});
