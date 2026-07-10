"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseUrlResolver = void 0;
const KNOWN_DOMAINS = [
    ...(process.env.BUFFSTREAMS_BASE_URL ? [process.env.BUFFSTREAMS_BASE_URL.replace(/\/+$/, '')] : []),
    'https://ibuffstreams.app',
    'https://buffstreams.plus',
];
let cachedUrl = KNOWN_DOMAINS[0] || 'https://ibuffstreams.app';
let lastProbeMs = 0;
const PROBE_TTL_MS = 10 * 60 * 1000;
let probing = null;
async function probeDomain(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${url}/index7`, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        });
        clearTimeout(timeout);
        return res.ok || res.status === 403 || res.status === 429;
    }
    catch {
        return false;
    }
}
async function probeAll() {
    for (const domain of KNOWN_DOMAINS) {
        if (await probeDomain(domain)) {
            return domain;
        }
    }
    return KNOWN_DOMAINS[0];
}
function startProbe() {
    if (probing)
        return;
    if (Date.now() - lastProbeMs < PROBE_TTL_MS)
        return;
    probing = probeAll()
        .then((url) => {
        cachedUrl = url;
        lastProbeMs = Date.now();
        probing = null;
    })
        .catch(() => {
        probing = null;
    });
}
startProbe();
exports.BaseUrlResolver = {
    getBaseUrl() {
        return cachedUrl;
    },
    async forceProbe() {
        const url = await probeAll();
        cachedUrl = url;
        lastProbeMs = Date.now();
        probing = null;
        return url;
    },
};
