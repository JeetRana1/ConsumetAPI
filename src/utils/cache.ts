import Redis from 'ioredis';

let redis: Redis | null = null;

// Initialize Redis if configured
// Redis is temporarily disabled due to connection stability issues causing crashes
/*
if (process.env.REDIS_HOST) {
  const isUpstash = process.env.REDIS_HOST.includes('upstash.io');

  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: isUpstash ? { rejectUnauthorized: false } : undefined,
    family: 4,
    connectTimeout: 5000,
    lazyConnect: true,
    maxRetriesPerRequest: null, // Avoid MaxRetriesPerRequestError
    retryStrategy: (times) => {
      if (times > 5) {
        console.warn('Redis reconnection failed 5 times. Disabling Redis for this session.');
        redis = null; // Kill redis instance to fallback to memory
        return null;
      }
      return Math.min(times * 100, 3000);
    }
  });

  redis.on('error', (err: any) => {
    if (err.code === 'ECONNRESET') return;
    console.error('Redis error:', err.message);
  });

  redis.on('connect', () => {
    console.log('✓ Redis cache connected');
  });

  redis.connect().catch((err) => {
    console.warn('Redis initial connection failed:', err.message);
    redis = null; // Fallback to memory
  });
} else {
  console.log('⚠ Redis not configured, using in-memory cache');
}
*/
console.log('⚠ Redis disabled for stability, using in-memory cache');

// In-memory cache fallback
const memoryCache = new Map<string, { data: any; expires: number }>();

export async function getCache(key: string): Promise<any | null> {
  try {
    if (redis) {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } else {
      const cached = memoryCache.get(key);
      if (cached && cached.expires > Date.now()) {
        return cached.data;
      }
      memoryCache.delete(key);
      return null;
    }
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

export async function setCache(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
  try {
    if (redis) {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } else {
      memoryCache.set(key, {
        data: value,
        expires: Date.now() + ttlSeconds * 1000
      });

      // Clean up old entries periodically
      if (memoryCache.size > 1000) {
        const now = Date.now();
        for (const [k, v] of memoryCache.entries()) {
          if (v.expires < now) memoryCache.delete(k);
        }
      }
    }
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

export async function clearCache(pattern?: string): Promise<void> {
  try {
    if (redis) {
      if (pattern) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) await redis.del(...keys);
      } else {
        await redis.flushdb();
      }
    } else {
      if (pattern) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        for (const key of memoryCache.keys()) {
          if (regex.test(key)) memoryCache.delete(key);
        }
      } else {
        memoryCache.clear();
      }
    }
  } catch (error) {
    console.error('Cache clear error:', error);
  }
}

// Backward compatibility: fetch method for old code
export async function fetch<T>(
  _redis: any, // Ignored, we use our own redis instance
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600
): Promise<T> {
  const cached = await getCache(key);
  if (cached !== null) {
    return cached as T;
  }

  const result = await fetcher();
  await setCache(key, result, ttl);
  return result;
}

// Default export for backward compatibility
export default {
  fetch,
  get: getCache,
  set: setCache,
  clear: clearCache
};

export { redis };
