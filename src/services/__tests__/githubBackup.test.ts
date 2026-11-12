import { ForeignCopyError, getFileSha, getRawFile, putFile } from '../githubBackup';

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

const content = async () => 'e30=';
const always = () => true;

describe('putFile', () => {
  it('creates the file when it does not exist yet', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 404 }, { status: 201, body: { content: { sha: 'new' } } }]);
    expect(await putFile(target, 'tok', content, 'msg', always, fetchImpl)).toBe('new');

    expect(calls[0].url).toBe('https://api.github.com/repos/someone/entreno-backup/contents/copias/entreno.json');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(calls[1].init?.method).toBe('PUT');
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ message: 'msg', content: 'e30=' });
  });

  it('sends the current sha to replace an existing file', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { sha: 'abc' } },
      { status: 200, body: { content: { sha: 'def' } } },
    ]);
    expect(await putFile(target, 'tok', content, 'msg', always, fetchImpl)).toBe('def');
    expect(JSON.parse(calls[1].init?.body as string).sha).toBe('abc');
  });

  it('asks before replacing: sends nothing, and does not even build the copy, on a no', async () => {
    const seen: (string | null)[] = [];
    const built = jest.fn(content);
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { sha: 'abc' } }]);
    const refuse = (sha: string | null) => {
      seen.push(sha);
      return false;
    };
    await expect(putFile(target, 'tok', built, 'msg', refuse, fetchImpl)).rejects.toThrow(ForeignCopyError);
    expect(seen).toEqual(['abc']);
    expect(calls).toHaveLength(1);
    expect(built).not.toHaveBeenCalled();
  });

  it('asks with null when there is no file yet', async () => {
    const seen: (string | null)[] = [];
    const { fetchImpl } = fakeFetch([{ status: 404 }, { status: 201, body: {} }]);
    const accept = (sha: string | null) => {
      seen.push(sha);
      return true;
    };
    // GitHub not saying the new sha is not an error: the caller asks for it.
    expect(await putFile(target, 'tok', content, 'msg', accept, fetchImpl)).toBeNull();
    expect(seen).toEqual([null]);
  });

  it('explains common failures in Spanish', async () => {
    await expect(putFile(target, 'bad', content, 'msg', always, fakeFetch([{ status: 401 }]).fetchImpl)).rejects.toThrow(
      'token de GitHub no es válido',
    );
    await expect(
      putFile(target, 'tok', content, 'msg', always, fakeFetch([{ status: 404 }, { status: 404 }]).fetchImpl),
    ).rejects.toThrow('No encuentro el repositorio');
    const offline = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(putFile(target, 'tok', content, 'msg', always, offline)).rejects.toThrow('Sin conexión');
  });
});

describe('getFileSha', () => {
  it('names the copy there is, or null if there is none', async () => {
    expect(await getFileSha(target, 'tok', fakeFetch([{ status: 200, body: { sha: 'abc' } }]).fetchImpl)).toBe('abc');
    expect(await getFileSha(target, 'tok', fakeFetch([{ status: 404 }]).fetchImpl)).toBeNull();
    await expect(getFileSha(target, 'bad', fakeFetch([{ status: 401 }]).fetchImpl)).rejects.toThrow('token de GitHub');
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
