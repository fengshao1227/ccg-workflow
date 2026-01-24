import type { CcgConfig, CollaborationMode, PromptEnhancerType, SupportedLang } from '../types'

export interface CliOptions {
  lang?: SupportedLang
  force?: boolean
  skipPrompt?: boolean
  skipMcp?: boolean
  frontend?: string
  backend?: string
  mode?: CollaborationMode
  workflows?: string
  installDir?: string
  promptEnhancer?: PromptEnhancerType
}

export type { CcgConfig, CollaborationMode, SupportedLang }
