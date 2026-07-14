type CacheClient = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode: string, expires: number) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
};

const fetch = async <T>(redis: CacheClient, key: string, fetcher: () => T, expires: number) => {
  try {
    const existing = await get<T>(redis, key);
    if (existing !== null) return existing;

    return set(redis, key, fetcher, expires);
  } catch (err: any) {
    // Fail-open cache: never break API responses because Redis is unavailable.
    console.warn(`[cache] bypassing redis for ${key}: ${err?.message || err}`);
    return await fetcher();
  }
};

const get = async <T>(redis: CacheClient, key: string): Promise<T> => {
  console.log('GET: ' + key);
  const value = await redis.get(key);
  if (value === null) return null as any;

  return JSON.parse(value);
};

const set = async <T>(redis: CacheClient, key: string, fetcher: () => T, expires: number) => {
  console.log(`SET: ${key}, EXP: ${expires}`);
  const value = await fetcher();
  await redis.set(key, JSON.stringify(value), 'EX', expires);
  return value;
};

const del = async (redis: CacheClient, key: string) => {
  await redis.del(key);
};

export default { fetch, set, get, del };
