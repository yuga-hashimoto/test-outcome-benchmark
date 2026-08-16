import { InfrastructureError } from '@tob/core';
import { createAnthropicAdapter } from './anthropic';
import { createGeminiAdapter } from './gemini';
import { createMockAdapter } from './mock';
import { createOpenAiAdapter, createOpenAiCompatibleAdapter } from './openai';
import type { AdapterContext, ModelAdapter } from './types';
import type { ModelConfiguration, ProviderId } from '@tob/core';

export interface AdapterFactoryOptions {
  /** Injected so tests never depend on the ambient environment. */
  readonly readEnv?: (name: string) => string | undefined;
  readonly mockSeed?: string;
}

/**
 * Resolves a stored configuration to a live adapter.
 *
 * The API key is read here by variable name, at call time. It is never stored
 * on the configuration, never written to the database, and never included in a
 * run snapshot.
 */
export const createAdapter = (
  config: ModelConfiguration,
  options: AdapterFactoryOptions = {},
): ModelAdapter => {
  const context: AdapterContext = {
    baseUrl: config.baseUrl,
    apiKeyEnvVar: config.apiKeyEnvVar,
    readEnv: options.readEnv ?? ((name: string) => process.env[name]),
  };

  switch (config.provider) {
    case 'mock':
      return createMockAdapter(options.mockSeed === undefined ? {} : { seed: options.mockSeed });
    case 'openai':
      return createOpenAiAdapter(context);
    case 'anthropic':
      return createAnthropicAdapter(context);
    case 'gemini':
      return createGeminiAdapter(context);
    case 'openai-compatible':
      return createOpenAiCompatibleAdapter(context);
    case 'external':
      return {
        provider: 'external',
        maxConcurrency: 1,
        complete: () => {
          throw new InfrastructureError(
            'This configuration records predictions produced outside the benchmark. Use `benchmark import-run` instead of starting a run.',
            { code: 'EXTERNAL_PROVIDER', retryable: false },
          );
        },
      };
    default: {
      const exhaustive: never = config.provider;
      throw new InfrastructureError(`Unsupported provider ${String(exhaustive)}`, {
        code: 'UNSUPPORTED_PROVIDER',
        retryable: false,
      });
    }
  }
};

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly label: string;
  readonly requiresApiKey: boolean;
  readonly requiresBaseUrl: boolean;
  readonly supportsStreaming: boolean;
  readonly defaultConcurrency: number;
}

export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    id: 'mock',
    label: 'Deterministic mock',
    requiresApiKey: false,
    requiresBaseUrl: false,
    supportsStreaming: true,
    defaultConcurrency: 32,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    supportsStreaming: true,
    defaultConcurrency: 8,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    requiresBaseUrl: false,
    supportsStreaming: true,
    defaultConcurrency: 4,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    requiresApiKey: true,
    requiresBaseUrl: false,
    /** Non-streaming in V1, so TTFT is always null for this provider. */
    supportsStreaming: false,
    defaultConcurrency: 4,
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    requiresApiKey: true,
    requiresBaseUrl: true,
    supportsStreaming: true,
    defaultConcurrency: 4,
  },
  {
    id: 'external',
    label: 'Imported from an external harness',
    requiresApiKey: false,
    requiresBaseUrl: false,
    supportsStreaming: false,
    defaultConcurrency: 1,
  },
];
