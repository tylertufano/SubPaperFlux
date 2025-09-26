import type { Credential } from '../sdk/src/models/Credential'
import type { SiteConfigOut } from '../sdk/src/models/SiteConfigOut'

export type SiteLoginOption = {
  value: string
  label: string
  siteConfigId: string
  credentialId?: string
  type: 'pair' | 'config'
}

export function resolveCredentialSiteConfigId(credential: Credential): string | null {
  const direct =
    (credential as Credential & { siteConfigId?: string | null }).siteConfigId ??
    (credential as Credential & { site_config_id?: string | null }).site_config_id
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim()
  }
  const data = credential.data ?? {}
  const fromData =
    (data as Record<string, unknown>).site_config_id ??
    (data as Record<string, unknown>).siteConfigId ??
    (data as Record<string, unknown>).site_config ??
    null
  if (typeof fromData === 'string' && fromData.trim().length > 0) {
    return fromData.trim()
  }
  return null
}

export function buildSiteLoginOptions(
  loginCredentials: Credential[],
  siteConfigs: SiteConfigOut[],
  configOnlySuffix?: string,
): SiteLoginOption[] {
  const options: SiteLoginOption[] = []
  const siteConfigMap = new Map<string, SiteConfigOut>()
  for (const config of siteConfigs) {
    if (config?.id == null) continue
    const id = String(config.id)
    siteConfigMap.set(id, config)
  }
  const pairedConfigs = new Set<string>()
  for (const credential of loginCredentials) {
    if (!credential?.id) continue
    const siteConfigId = resolveCredentialSiteConfigId(credential)
    if (!siteConfigId) continue
    const siteConfig = siteConfigMap.get(siteConfigId)
    const credentialId = String(credential.id)
    const credentialLabel = credential.description || credentialId
    const configLabel = siteConfig?.name || siteConfigId
    const value = `${credentialId}::${siteConfigId}`
    options.push({
      value,
      label: `${credentialLabel} • ${configLabel}`,
      siteConfigId,
      credentialId,
      type: 'pair',
    })
    pairedConfigs.add(siteConfigId)
  }
  for (const config of siteConfigs) {
    if (!config?.id) continue
    const id = String(config.id)
    if (pairedConfigs.has(id)) continue
    const baseLabel = config.name || id
    const suffix = configOnlySuffix ? ` (${configOnlySuffix})` : ''
    options.push({
      value: `config:${id}`,
      label: `${baseLabel}${suffix}`,
      siteConfigId: id,
      type: 'config',
    })
  }
  options.sort((a, b) => a.label.localeCompare(b.label))
  return options
}

export function buildSiteConfigLabelMap(
  options: SiteLoginOption[],
  siteConfigs: SiteConfigOut[],
): Map<string, string> {
  const labelMap = new Map<string, string>()
  for (const option of options) {
    if (!labelMap.has(option.siteConfigId)) {
      labelMap.set(option.siteConfigId, option.label)
    }
  }
  for (const config of siteConfigs) {
    if (!config?.id) continue
    const id = String(config.id)
    if (!labelMap.has(id)) {
      labelMap.set(id, config.name || id)
    }
  }
  return labelMap
}
