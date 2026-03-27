import axios, { AxiosRequestConfig } from 'axios';

export type FetchResponse = {
  success: boolean;
  status: number;
  text: string;
};

/**
 * Custom fetcher for FlixHQ that wraps axios
 * Compatible with CoorenLabs fetcher interface
 */
export const fetcher = async (
  url: string,
  _detectCfCache: boolean = false,
  _cachePrefix: string = 'default',
  config: AxiosRequestConfig = {},
): Promise<FetchResponse | undefined> => {
  try {
    const axiosConfig: AxiosRequestConfig = {
      ...config,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...config.headers,
      },
      timeout: 30000,
    };

    const response = await axios(url, axiosConfig);

    return {
      success: response.status >= 200 && response.status < 300,
      status: response.status,
      text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    };
  } catch (error: any) {
    if (error.response) {
      return {
        success: false,
        status: error.response.status,
        text: typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data),
      };
    }
    // For network errors, return undefined
    return undefined;
  }
};
